// jadx-headless plugin bootstrap launcher.
//
// Run in JDK "source-file mode" (JEP 330, JDK 11+):
//     java Launcher.java <dataDir> <version> <jarUrl> <sha256> [serverArgs...]
//
// Why this exists: the jadx-headless MCP server is a ~50 MB JVM fat jar. Rather than commit
// that binary into the plugin repo (bad for a git-based / community marketplace and for the
// automated safety review), the plugin ships as plain text and this launcher downloads the
// versioned jar once from the project's GitHub Releases into ${CLAUDE_PLUGIN_DATA} (a per-plugin
// directory that survives updates), verifies its SHA-256 against the hash pinned in .mcp.json,
// caches it, and then runs it. Subsequent starts are offline and instant.
//
// Everything this launcher prints goes to stderr: stdout is reserved for the MCP JSON-RPC stream,
// which the child jar owns via inheritIO().
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.LinkOption;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Pattern;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public class Launcher {
    private static final long MAX_JAR_BYTES = 256L * 1024 * 1024;
    private static final long DOWNLOAD_TIMEOUT_NANOS = TimeUnit.MINUTES.toNanos(10);
    private static final Pattern SHA256 = Pattern.compile("[0-9a-fA-F]{64}");
    private static final Pattern VERSION = Pattern.compile("[0-9]+(?:\\.[0-9]+){1,3}(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?");

    public static void main(String[] argv) throws Exception {
        if (argv.length < 4) {
            System.err.println("[jadx-plugin] usage: java Launcher.java <dataDir> <version> <jarUrl> <sha256> [serverArgs...]");
            System.exit(2);
        }
        Path dataDir = Paths.get(argv[0]);
        String version = argv[1];
        String url = argv[2];
        String sha = argv[3];
        String[] serverArgs = Arrays.copyOfRange(argv, 4, argv.length);

        // Validate the trust inputs before a cache lookup, network request or child process.
        if (!SHA256.matcher(sha).matches()) {
            throw new IllegalArgumentException("A real pinned 64-character SHA-256 is required; placeholders are refused");
        }
        if (!VERSION.matcher(version).matches()) {
            throw new IllegalArgumentException("Invalid release version");
        }
        URI releaseUri = URI.create(url);
        requireHttps(releaseUri);
        if (Files.isSymbolicLink(dataDir)) {
            throw new IOException("The artifact cache must not be a symbolic link");
        }
        Files.createDirectories(dataDir);
        Path jar = dataDir.resolve("jadx-headless-mcp-" + version + "-all.jar");
        if (Files.exists(jar, LinkOption.NOFOLLOW_LINKS) &&
                !Files.isRegularFile(jar, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("Cached jar must be a regular file");
        }
        if (!Files.exists(jar) || !sha256(jar).equalsIgnoreCase(sha)) {
            download(releaseUri, jar, sha);
        }
        // Verify again on every start, including an existing offline cache.
        if (!sha256(jar).equalsIgnoreCase(sha)) {
            throw new IOException("Cached jar failed its pinned SHA-256 check");
        }

        // Use the same JVM that launched this source file to run the jar (avoids relying on a
        // second `java` being resolvable, and guarantees the version we already validated).
        boolean win = System.getProperty("os.name", "").toLowerCase().contains("win");
        String javaBin = Paths.get(System.getProperty("java.home"), "bin", win ? "java.exe" : "java").toString();

        List<String> cmd = new ArrayList<>();
        cmd.add(javaBin);
        cmd.add("-jar");
        cmd.add(jar.toString());
        cmd.addAll(Arrays.asList(serverArgs));

        Process child = new ProcessBuilder(cmd).inheritIO().start();
        Runtime.getRuntime().addShutdownHook(new Thread(child::destroy));
        System.exit(child.waitFor());
    }

    private static void requireHttps(URI uri) {
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null) {
            throw new IllegalArgumentException("Release downloads require an HTTPS URL without embedded credentials");
        }
    }

    private static void download(URI uri, Path dest, String expectedSha256) throws Exception {
        requireHttps(uri);
        System.err.println("[jadx-plugin] downloading " + uri);
        HttpClient client = HttpClient.newBuilder()
                // NORMAL permits HTTPS-to-HTTPS redirects but refuses HTTPS-to-HTTP downgrade.
                .followRedirects(HttpClient.Redirect.NORMAL)
                .connectTimeout(Duration.ofSeconds(30))
                .build();
        HttpRequest req = HttpRequest.newBuilder(uri)
                .timeout(Duration.ofMinutes(10))
                .GET()
                .build();
        // Unique private temp file: never overwrite a predictable cache .tmp path.
        Path tmp = Files.createTempFile(dest.getParent(), ".jadx-download-", ".tmp");
        long deadline = System.nanoTime() + DOWNLOAD_TIMEOUT_NANOS;
        ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
        try {
            HttpResponse<InputStream> resp = client.send(req, HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream body = resp.body()) {
                requireHttps(resp.uri());
                if (resp.statusCode() != 200) {
                    throw new IOException("download failed: HTTP " + resp.statusCode() + " for " + uri);
                }
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) throw new IOException("Release download timed out");
                AtomicBoolean expired = new AtomicBoolean(false);
                // Request timeout alone only covers response headers for a streaming body.
                // Closing the response stream cancels a stalled body after the total deadline.
                timer.schedule(() -> {
                    expired.set(true);
                    try { body.close(); } catch (IOException ignored) {}
                }, remaining, TimeUnit.NANOSECONDS);
                try (OutputStream output = Files.newOutputStream(tmp)) {
                    copyBounded(body, output, MAX_JAR_BYTES);
                }
                if (expired.get()) throw new IOException("Release download timed out");
            }
            promoteVerified(tmp, dest, expectedSha256);
            System.err.println("[jadx-plugin] sha256 verified and saved " + dest);
        } finally {
            timer.shutdownNow();
            Files.deleteIfExists(tmp);
        }
    }

    private static void copyBounded(InputStream body, OutputStream output, long maxBytes) throws IOException {
        byte[] buffer = new byte[1 << 16];
        long total = 0;
        int count;
        while ((count = body.read(buffer)) != -1) {
            total += count;
            if (total > maxBytes) throw new IOException("Release download exceeds the size limit");
            output.write(buffer, 0, count);
        }
    }

    private static void promoteVerified(Path tmp, Path dest, String expectedSha256) throws Exception {
        if (!SHA256.matcher(expectedSha256).matches() || !sha256(tmp).equalsIgnoreCase(expectedSha256)) {
            throw new IOException("Downloaded jar failed its pinned SHA-256 check");
        }
        // An unverified response is never promoted into the executable cache.
        try {
            Files.move(tmp, dest, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException ex) {
            Files.move(tmp, dest, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static String sha256(Path p) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = Files.newInputStream(p)) {
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        }
        StringBuilder sb = new StringBuilder(64);
        for (byte b : md.digest()) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
