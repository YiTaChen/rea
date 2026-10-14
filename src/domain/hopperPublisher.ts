/**
 * Apple publisher identity pinned for the official Hopper macOS bundle. The
 * team identifier was captured from `Hopper-6.6.0-demo.dmg` at
 * `https://www.hopperapp.com:443/downloader/public/Hopper-6.6.0-demo.dmg`
 * (34846271 bytes, SHA-256
 * 4e678442f4afe283566c34fa359f025b0e754065787caa0cae52fd7faf2f0a7b) with
 * `codesign -dvvv`, which reported
 * `Authority=Developer ID Application: Cryptic Apps (2AMA2753NF)`.
 */
export const HOPPER_PUBLISHER = Object.freeze({
  bundleIdentifier: "com.cryptic-apps.hopper-web-4",
  teamIdentifier: "2AMA2753NF",
});
