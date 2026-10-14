import { afterEach, describe, expect, it, vi } from "vitest";

import {
  downloadHopperPackage,
  HOPPER_DOWNLOAD_BYTES,
} from "./HopperDownload.js";

const PACKAGE =
  "https://www.hopperapp.com:443/downloader/public/Hopper-6.6.0-demo.dmg";

afterEach(() => vi.restoreAllMocks());

describe("Hopper vendor download boundary", () => {
  it.each([
    "http://www.hopperapp.com/downloader/public/Hopper-6.6.0-demo.dmg",
    "https://www.hopperapp.com.attacker.test/downloader/public/Hopper-6.6.0-demo.dmg",
    "https://attacker@www.hopperapp.com/downloader/public/Hopper-6.6.0-demo.dmg",
    "https://www.hopperapp.com:444/downloader/public/Hopper-6.6.0-demo.dmg",
    "https://www.hopperapp.com/downloader/public/%2Fattacker.dmg",
    "https://www.hopperapp.com/downloader/public/Hopper-6.6.0-demo.dmg?redirect=attacker",
    "https://www.hopperapp.com/downloader/public/Hopper-6.6.0-demo.dmg#fragment",
    "https://www.hopperapp.com/include/files-api.php?request=releases&public=true&redirect=attacker",
    "file:///tmp/Hopper-demo.dmg",
  ])("rejects an inadmissible initial URL before fetching: %s", async (url) => {
    const request = vi.spyOn(globalThis, "fetch");
    expect(await downloadHopperPackage(url)).toEqual({
      ok: false,
      bytes: new Uint8Array(),
    });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    "https://attacker.test/Hopper-demo.dmg",
    "http://www.hopperapp.com/downloader/public/Hopper-demo.dmg",
    "https://www.hopperapp.com/private/Hopper-demo.dmg",
    "https://attacker@www.hopperapp.com/downloader/public/Hopper-demo.dmg",
  ])(
    "rejects an unsafe redirect without contacting its destination: %s",
    async (location) => {
      const request = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response("redirect", { status: 302, headers: { location } }),
        );
      expect((await downloadHopperPackage(PACKAGE)).ok).toBe(false);
      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0]?.[1]?.redirect).toBe("manual");
    },
  );

  it("validates every redirect hop and follows relative vendor package paths", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: "Hopper-6.6.0-demo.deb" },
        }),
      )
      .mockResolvedValueOnce(new Response("package"));
    const result = await downloadHopperPackage(PACKAGE);
    expect(result).toEqual({ ok: true, bytes: Buffer.from("package") });
    expect(request.mock.calls[1]?.[0]).toBe(
      "https://www.hopperapp.com/downloader/public/Hopper-6.6.0-demo.deb",
    );
    expect(
      request.mock.calls.every(([, options]) => options?.redirect === "manual"),
    ).toBe(true);
  });

  it("refuses an unsafe second redirect and bounds redirect loops", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: "Hopper-6.6.0-demo.deb" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://attacker.test/package" },
        }),
      );
    expect((await downloadHopperPackage(PACKAGE)).ok).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);

    request.mockReset().mockImplementation(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "Hopper-6.6.0-demo.dmg" },
        }),
      ),
    );
    expect((await downloadHopperPackage(PACKAGE)).ok).toBe(false);
    expect(request).toHaveBeenCalledTimes(6);
  });

  it("refuses an oversized declared body before consuming it", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, {
        headers: { "content-length": String(HOPPER_DOWNLOAD_BYTES + 1) },
      }),
    );
    expect((await downloadHopperPackage(PACKAGE)).ok).toBe(false);
    expect(cancelled).toBe(true);
  });

  it("propagates cancellation and retains one deadline across redirects", async () => {
    const controller = new AbortController();
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "Hopper-6.6.0-demo.deb" },
        }),
      )
      .mockImplementation((_url, options) => {
        controller.abort();
        options?.signal?.throwIfAborted();
        return Promise.resolve(new Response("unexpected"));
      });
    await expect(
      downloadHopperPackage(PACKAGE, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(request.mock.calls[0]?.[1]?.signal).toBe(
      request.mock.calls[1]?.[1]?.signal,
    );
  });
});
