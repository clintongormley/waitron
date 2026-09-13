/**
 * Which set of certificate-install instructions the trust help page should open, guessed from two
 * request headers. Pure: no I/O, no imports, no state.
 *
 * SECURITY BOUNDARY. The page that consumes this answer is unauthenticated. Every value below is a
 * literal chosen here, so the caller renders fixed text keyed by the answer; no part of either
 * header ever reaches the returned value, and so none of it can reach the page.
 *
 * KNOWN LIMIT, stated rather than worked around. iPadOS 13 and later request the desktop site by
 * default, and that user-agent is the ordinary Macintosh string, so a default-mode iPad answers
 * `macos`. What I checked: the two strings, and that this function returns `macos` for the Mac one
 * (`detect-device.test.ts`, the iPadOS-limit suite). What I am assuming, from
 * whatismybrowser.com's Safari guide read 2026-09-13 and not from a device in my hands: that a
 * physical iPad in its default mode sends exactly that string. No sniffing trick is attempted.
 */

export type TrustDevice =
  "macos" | "windows" | "linux" | "chromeos" | "android" | "ios" | "firefox-linux" | "unknown";

/**
 * The `sec-ch-ua-platform` client hint, which Chromium sends quoted (`"macOS"`). MDN's
 * Sec-CH-UA-Platform page lists the whole value set as "Android", "Chrome OS", "Chromium OS",
 * "iOS", "Linux", "macOS", "Windows" and "Unknown" (read 2026-09-13). "Unknown" is a value browsers
 * really send, so it must fall through to the user-agent rather than match anything here.
 * Returns null when the hint is absent, empty or not one this function knows.
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
  // Order is the whole content of this function, and each test below is written so that reordering
  // it changes an answer: an iPhone/iPad string carries "Mac OS X", a ChromeOS string carries
  // "X11", and an Android string carries "Linux". Matching macOS on "Mac OS X" as well as
  // "Macintosh" is what makes the iOS-first order do real work rather than look like it does.
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
  // Firefox on Linux needs Firefox's own certificate manager, not the Linux system steps: Mozilla's
  // "Setting up certificate authorities in Firefox" says Firefox can use the operating system's
  // store on "Windows, macOS and Android" — quoted in
  // docs/superpowers/specs/2026-09-12-box-trust-onboarding-design.md's provenance table. Linux is
  // absent from that list; the page does not say more than that, and neither does this branch.
  // `Firefox/` is the desktop/Android token — Firefox on iOS is `FxiOS/` and never reaches here.
  return system === "linux" && ua.includes("Firefox/") ? "firefox-linux" : system;
}
