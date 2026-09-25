/**
 * Which set of certificate-install instructions the trust help page should open, guessed from two
 * request headers.
 *
 * SECURITY BOUNDARY. The page that consumes this answer is unauthenticated. Every value below is a
 * literal chosen here, so no part of either header ever reaches the returned value.
 *
 * KNOWN LIMIT: iPadOS 13 and later send the desktop Macintosh user-agent by default, so a
 * default-mode iPad answers `macos`. Tested: this function returns `macos` for the Macintosh string
 * (`detect-device.test.ts`, the iPadOS-limit suite). Assumed, from whatismybrowser.com's Safari
 * guide read 2026-09-13 and not from a device: that a physical iPad in its default mode sends
 * exactly that string.
 */

export type TrustDevice =
  "macos" | "windows" | "linux" | "chromeos" | "android" | "ios" | "firefox-linux" | "unknown";

/**
 * The `sec-ch-ua-platform` client hint, which Chromium sends quoted (`"macOS"`). "Unknown" is a value
 * browsers really send, so it falls through to the user-agent. Returns null for any value not matched.
 */
function fromPlatformHint(raw: string): TrustDevice | null {
  const value = raw.trim().replace(/^"|"$/g, "").trim().toLowerCase();
  switch (value) {
    case "macos":
      return "macos";
    case "windows":
      return "windows";
    case "linux":
      return "linux";
    case "chrome os":
    case "chromium os":
      return "chromeos";
    case "android":
      return "android";
    case "ios":
      return "ios";
    default:
      return null;
  }
}

function fromUserAgent(ua: string): TrustDevice {
  // Order matters: an iPhone/iPad string carries "Mac OS X", a ChromeOS string carries "X11", and an
  // Android string carries "Linux".
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Macintosh|Mac OS X/.test(ua)) return "macos";
  if (ua.includes("CrOS")) return "chromeos";
  if (ua.includes("Android")) return "android";
  if (ua.includes("Windows")) return "windows";
  if (ua.includes("Linux") || ua.includes("X11")) return "linux";
  return "unknown";
}

export function detectTrustDevice(headers: { userAgent?: string; platform?: string }): TrustDevice {
  const ua = headers.userAgent ?? "";
  const system = fromPlatformHint(headers.platform ?? "") ?? fromUserAgent(ua);
  // Firefox on Linux needs Firefox's own certificate manager: Mozilla names only "Windows, macOS and
  // Android" as systems whose store Firefox can use (provenance in
  // docs/superpowers/specs/2026-09-12-box-trust-onboarding-design.md).
  return system === "linux" && ua.includes("Firefox/") ? "firefox-linux" : system;
}

/**
 * The same answer, taken straight from a request. This file is the one place that names the two
 * headers, so a route handler asks for a device rather than for header values. Deliberately NOT
 * Hono's `Context`: that would hand the detector the response, the cookies and the body.
 */
export function trustDeviceForRequest(req: {
  header(name: string): string | undefined;
}): TrustDevice {
  return detectTrustDevice({
    userAgent: req.header("user-agent"),
    platform: req.header("sec-ch-ua-platform"),
  });
}
