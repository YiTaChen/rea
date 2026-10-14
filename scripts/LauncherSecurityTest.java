// JDK-only regression checks. Uses inert bytes; no HTTP or server JAR execution.
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;

public class LauncherSecurityTest {
    private static int checks;
    private static Object invoke(String name, Class<?>[] types, Object... args) throws Exception {
        Method method = Launcher.class.getDeclaredMethod(name, types);
        method.setAccessible(true);
        try { return method.invoke(null, args); }
        catch (InvocationTargetException error) {
            Throwable cause = error.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw error;
        }
    }
    private static void mustFail(Checked task) throws Exception {
        try { task.run(); }
        catch (IllegalArgumentException | java.io.IOException expected) { checks++; return; }
        throw new AssertionError("Untrusted input was accepted");
    }
    private static String digest(byte[] data) throws Exception {
        StringBuilder out = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(data)) out.append(String.format("%02x", b));
        return out.toString();
    }
    public static void main(String[] args) throws Exception {
        Path dir = Files.createTempDirectory("jadx-launcher-test-");
        try {
            String hash = "0".repeat(64);
            for (String missing : new String[] {"", "placeholder", "not-a-checksum", "0".repeat(63)}) {
                mustFail(() -> Launcher.main(new String[] {dir.resolve("unused").toString(), "0.7.0", "https://example.invalid/release.jar", missing}));
            }
            for (String version : new String[] {"../../escape", "/absolute", "0.7.0/escape", ""}) {
                mustFail(() -> Launcher.main(new String[] {dir.resolve("unused").toString(), version, "https://example.invalid/release.jar", hash}));
            }
            for (String url : new String[] {"http://example.invalid/release.jar", "file:///tmp/release.jar", "https://user:password@example.invalid/release.jar"}) {
                mustFail(() -> Launcher.main(new String[] {dir.resolve("unused").toString(), "0.7.0", url, hash}));
            }
            if (Files.exists(dir.resolve("unused"))) throw new AssertionError("Invalid inputs mutated the cache");
            checks++;
            invoke("requireHttps", new Class<?>[] {URI.class}, URI.create("https://example.invalid/release.jar"));
            checks++;
            byte[] inert = "inert test bytes; never executed".getBytes(java.nio.charset.StandardCharsets.UTF_8);
            Path tmp = dir.resolve("download.tmp"), dest = dir.resolve("cached.jar");
            Files.write(tmp, inert);
            Files.writeString(dest, "previous cache");
            mustFail(() -> invoke("promoteVerified", new Class<?>[] {Path.class, Path.class, String.class}, tmp, dest, hash));
            if (!Files.readString(dest).equals("previous cache")) throw new AssertionError("Bad digest replaced existing cache");
            checks++;
            java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
            mustFail(() -> invoke("copyBounded", new Class<?>[] {java.io.InputStream.class, java.io.OutputStream.class, long.class}, new java.io.ByteArrayInputStream(inert), output, 8L));
            if (output.size() > 8) throw new AssertionError("Download exceeded the output byte cap");
            checks++;
            output.reset();
            invoke("copyBounded", new Class<?>[] {java.io.InputStream.class, java.io.OutputStream.class, long.class}, new java.io.ByteArrayInputStream(inert), output, (long) inert.length);
            if (!java.util.Arrays.equals(output.toByteArray(), inert)) throw new AssertionError("Bounded copy changed bytes");
            checks++;
            String correct = digest(inert);
            invoke("promoteVerified", new Class<?>[] {Path.class, Path.class, String.class}, tmp, dest, correct);
            if (Files.exists(tmp) || !java.util.Arrays.equals(Files.readAllBytes(dest), inert)) throw new AssertionError("Verified promotion failed");
            checks++;
            if (!invoke("sha256", new Class<?>[] {Path.class}, dest).equals(correct)) throw new AssertionError("Cache hash check failed");
            checks++;
            // A symlink cache must be refused before any network or process start.
            Path link = dir.resolve("linked-cache");
            Files.createSymbolicLink(link, dir);
            mustFail(() -> Launcher.main(new String[] {link.toString(), "0.7.0", "https://example.invalid/release.jar", hash}));
            Files.delete(link);
            Path symlinkJar = dir.resolve("jadx-headless-mcp-0.7.0-all.jar");
            Files.createSymbolicLink(symlinkJar, dest);
            mustFail(() -> Launcher.main(new String[] {dir.toString(), "0.7.0", "https://example.invalid/release.jar", hash}));
            Files.delete(symlinkJar);
            System.out.println("Launcher security checks passed: " + checks);
        } finally {
            try (java.util.stream.Stream<Path> files = Files.walk(dir)) {
                files.sorted(java.util.Comparator.reverseOrder()).forEach(path -> {
                    try { Files.deleteIfExists(path); } catch (java.io.IOException error) { throw new RuntimeException(error); }
                });
            }
        }
    }
    private interface Checked { void run() throws Exception; }
}
