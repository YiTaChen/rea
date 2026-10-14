/** Maximum admitted vendor response bytes, shared by Hopper setup adapters. */
export const HOPPER_DOWNLOAD_BYTES = 100_000_000;
const HOPPER_ORIGIN = "https://www.hopperapp.com";
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Admit only the vendor's HTTPS release API and public Hopper package paths. */
export const isHopperDownloadUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (
      value !== value.trim() ||
      url.origin !== HOPPER_ORIGIN ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== ""
    )
      return false;
    if (url.pathname === "/include/files-api.php")
      return (
        url.searchParams.size === 2 &&
        url.searchParams.get("request") === "releases" &&
        url.searchParams.get("public") === "true"
      );
    return (
      url.search === "" &&
      /^\/downloader\/public\/Hopper-[A-Za-z0-9][A-Za-z0-9.-]*\.(?:dmg|deb|rpm|pkg\.tar\.xz)$/u.test(
        url.pathname,
      )
    );
  } catch (cause: unknown) {
    void cause;
    return false;
  }
};

/** Bound observed response bytes before retaining them, including chunked bodies. */
export const downloadHopperPackage = async (
  url: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<{ readonly ok: boolean; readonly bytes: Uint8Array }> => {
  const deadline = AbortSignal.timeout(120_000);
  const signal =
    options.signal === undefined
      ? deadline
      : AbortSignal.any([options.signal, deadline]);
  const refused = { ok: false, bytes: new Uint8Array() };
  let current = url;
  let response: Response | undefined;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (!isHopperDownloadUrl(current)) return refused;
    response = await fetch(current, {
      headers: {
        accept: "application/json, application/octet-stream",
        "user-agent": "rea-installer",
        referer: `${HOPPER_ORIGIN}/download.html`,
      },
      signal,
      redirect: "manual",
    });
    if (response.redirected) {
      await response.body?.cancel();
      return refused;
    }
    if (!REDIRECT_STATUSES.has(response.status)) break;
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (location === null || redirects === MAX_REDIRECTS) return refused;
    try {
      current = new URL(location, current).href;
    } catch (cause: unknown) {
      void cause;
      return refused;
    }
  }
  if (response === undefined) return refused;
  const contentLength = response.headers.get("content-length");
  if (
    !response.ok ||
    (contentLength !== null &&
      (!/^\d+$/u.test(contentLength) ||
        Number(contentLength) > HOPPER_DOWNLOAD_BYTES))
  ) {
    await response.body?.cancel();
    return refused;
  }
  if (response.body === null) return { ok: true, bytes: new Uint8Array() };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return { ok: true, bytes: Buffer.concat(chunks, bytes) };
      if (chunk.value.byteLength > HOPPER_DOWNLOAD_BYTES - bytes) {
        await reader.cancel();
        return refused;
      }
      chunks.push(chunk.value);
      bytes += chunk.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
};
