import { describe, expect, it } from "vitest";
import { detectTrustDevice, trustDeviceForRequest } from "./detect-device.js";

// Real published user-agent strings, not hand-written: a UA nobody's browser sends proves nothing
// about ordering.
const UA = {
  macosSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27 Safari/605.1.15",
  macosChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
  macosFirefox:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:155.0) Gecko/20100101 Firefox/155.0",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
  windowsFirefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0",
  linuxChrome:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:155.0) Gecko/20100101 Firefox/155.0",
  chromeosChrome:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 16; Mobile; rv:146.0) Gecko/146.0 Firefox/146.0",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/29.0 Chrome/136.0.0.0 Mobile Safari/537.36",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1",
  ipadSafari:
    "Mozilla/5.0 (iPad; CPU OS 18_7_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1",
} as const;

describe("detectTrustDevice — the sec-ch-ua-platform hint", () => {
  // MDN's documented Sec-CH-UA-Platform value set, quoted the way Chromium sends it.
  it.each([
    ['"macOS"', "macos"],
    ['"Windows"', "windows"],
    ['"Linux"', "linux"],
    ['"Chrome OS"', "chromeos"],
    ['"Chromium OS"', "chromeos"],
    ['"Android"', "android"],
    ['"iOS"', "ios"],
  ])("reads the quoted hint %s as %s", (platform, expected) => {
    expect(detectTrustDevice({ platform })).toBe(expected);
  });

  it("matches the hint case-insensitively and tolerates surrounding whitespace", () => {
    expect(detectTrustDevice({ platform: '"macos"' })).toBe("macos");
    expect(detectTrustDevice({ platform: "  WINDOWS  " })).toBe("windows");
    expect(detectTrustDevice({ platform: ' "chrome os" ' })).toBe("chromeos");
  });

  it("lets a recognised hint override a user-agent that says otherwise", () => {
    // A Windows box whose user-agent claims macOS: the hint is the answer, not the string.
    expect(detectTrustDevice({ platform: '"Windows"', userAgent: UA.macosSafari })).toBe("windows");
    expect(detectTrustDevice({ platform: '"Android"', userAgent: UA.windowsChrome })).toBe(
      "android",
    );
  });

  it("falls back to the user-agent when there is no hint", () => {
    expect(detectTrustDevice({ userAgent: UA.windowsChrome })).toBe("windows");
    expect(detectTrustDevice({ userAgent: UA.windowsEdge })).toBe("windows");
    expect(detectTrustDevice({ userAgent: UA.macosChrome })).toBe("macos");
  });
});

describe("detectTrustDevice — user-agent matching order", () => {
  it("reads an iPhone or iPad as ios even though both say 'like Mac OS X'", () => {
    // Both strings contain the literal "Mac OS X". A Macintosh-first matcher answers macos here,
    // which would show a phone owner the Keychain Access steps.
    expect(UA.iphoneSafari).toContain("Mac OS X");
    expect(UA.ipadSafari).toContain("Mac OS X");
    expect(detectTrustDevice({ userAgent: UA.iphoneSafari })).toBe("ios");
    expect(detectTrustDevice({ userAgent: UA.ipadSafari })).toBe("ios");
  });

  it("reads an Android user-agent as android even though it contains the word Linux", () => {
    expect(UA.androidChrome).toContain("Linux");
    expect(UA.androidSamsung).toContain("Linux");
    expect(detectTrustDevice({ userAgent: UA.androidChrome })).toBe("android");
    expect(detectTrustDevice({ userAgent: UA.androidSamsung })).toBe("android");
    // Firefox for Android names Android without naming Linux at all.
    expect(detectTrustDevice({ userAgent: UA.androidFirefox })).toBe("android");
  });

  it("reads a ChromeOS user-agent as chromeos, not linux", () => {
    expect(UA.chromeosChrome).toContain("CrOS");
    expect(detectTrustDevice({ userAgent: UA.chromeosChrome })).toBe("chromeos");
  });

  it("reads a desktop Linux user-agent as linux", () => {
    expect(detectTrustDevice({ userAgent: UA.linuxChrome })).toBe("linux");
  });

  it("reads macOS Safari as macos", () => {
    expect(detectTrustDevice({ userAgent: UA.macosSafari })).toBe("macos");
  });
});

describe("detectTrustDevice — Firefox on Linux is its own answer", () => {
  it("answers firefox-linux for Firefox on Linux", () => {
    expect(detectTrustDevice({ userAgent: UA.linuxFirefox })).toBe("firefox-linux");
  });

  it("answers firefox-linux even when the platform hint says Linux", () => {
    // The hint settles the operating system; it does not settle which certificate store the
    // browser reads, which is the only thing this answer exists to change.
    expect(detectTrustDevice({ platform: '"Linux"', userAgent: UA.linuxFirefox })).toBe(
      "firefox-linux",
    );
  });

  it("gives Firefox the ordinary operating-system answer everywhere else", () => {
    expect(detectTrustDevice({ userAgent: UA.macosFirefox })).toBe("macos");
    expect(detectTrustDevice({ userAgent: UA.windowsFirefox })).toBe("windows");
    expect(detectTrustDevice({ userAgent: UA.androidFirefox })).toBe("android");
  });

  it("keeps non-Firefox Linux browsers on the system answer", () => {
    expect(detectTrustDevice({ userAgent: UA.linuxChrome })).toBe("linux");
    expect(detectTrustDevice({ platform: '"Linux"', userAgent: UA.linuxChrome })).toBe("linux");
  });
});

describe("detectTrustDevice — absent, empty and unrecognised input", () => {
  it('treats the "Unknown" hint as no hint and reads the user-agent instead', () => {
    // Chromium really sends "Unknown"; it must not become the "unknown" answer while a perfectly
    // readable user-agent is sitting in the same request.
    expect(detectTrustDevice({ platform: '"Unknown"', userAgent: UA.androidChrome })).toBe(
      "android",
    );
    expect(detectTrustDevice({ platform: '"Unknown"', userAgent: UA.macosSafari })).toBe("macos");
    expect(detectTrustDevice({ platform: '"Unknown"' })).toBe("unknown");
  });

  it("returns unknown when both headers are absent, empty or whitespace", () => {
    expect(detectTrustDevice({})).toBe("unknown");
    expect(detectTrustDevice({ userAgent: "", platform: "" })).toBe("unknown");
    expect(detectTrustDevice({ userAgent: "   ", platform: "   " })).toBe("unknown");
    expect(detectTrustDevice({ platform: '""' })).toBe("unknown"); // an empty quoted hint
  });

  it("returns unknown for a user-agent it does not recognise", () => {
    expect(detectTrustDevice({ userAgent: "curl/8.7.1" })).toBe("unknown");
    expect(detectTrustDevice({ userAgent: "Mozilla/5.0 (PlayStation; PlayStation 5/9.60)" })).toBe(
      "unknown",
    );
  });

  it("never returns anything outside the union, whatever the headers say", () => {
    const allowed = new Set<string>([
      "macos",
      "windows",
      "linux",
      "chromeos",
      "android",
      "ios",
      "firefox-linux",
      "unknown",
    ]);
    const hostile = [
      "<script>alert(1)</script>",
      '"macOS"; drop table registros_facturacion',
      "Debian GNU/Linux trixie",
      " ",
      "macos",
    ];
    for (const value of [...hostile, ...Object.values(UA)]) {
      const cases = [
        { userAgent: value },
        { platform: value },
        { platform: value, userAgent: value },
      ];
      for (const headers of cases) {
        expect(allowed.has(detectTrustDevice(headers))).toBe(true);
      }
    }
  });

  it("never turns header text into an answer of its own", () => {
    // An implementation that echoed a cleaned-up header would answer "beos" or "solaris" here.
    // Every answer is a literal chosen by the code, so an unrecognised word is just unknown.
    expect(detectTrustDevice({ platform: '"BeOS"' })).toBe("unknown");
    expect(
      detectTrustDevice({ platform: '"BeOS"', userAgent: "Mozilla/5.0 (BeOS; Solaris)" }),
    ).toBe("unknown");
    expect(detectTrustDevice({ userAgent: "solaris" })).toBe("unknown");
  });
});

describe("detectTrustDevice — the iPadOS limit, pinned rather than worked around", () => {
  it("reads a default-mode iPadOS Safari user-agent as macos, because it is a Mac string", () => {
    // iPadOS 13 and later send the desktop macOS user-agent by default. This pins what the function
    // does with the string, not what device sent it.
    const ipadInDesktopMode = UA.macosSafari;
    expect(detectTrustDevice({ userAgent: ipadInDesktopMode })).toBe("macos");
    // An iPad that is NOT in desktop mode still resolves to ios, and the iOS platform hint, when a
    // Chromium-family browser sends one, still wins.
    expect(detectTrustDevice({ userAgent: UA.ipadSafari })).toBe("ios");
    expect(detectTrustDevice({ platform: '"iOS"', userAgent: ipadInDesktopMode })).toBe("ios");
  });
});

describe("trustDeviceForRequest — the two headers are named in one place", () => {
  /** The smallest shape Hono's `c.req` satisfies: one `header(name)` lookup. */
  const requestWith = (headers: Record<string, string>) => ({
    header: (name: string): string | undefined => headers[name],
  });

  it("reads the user-agent and the platform hint from a request", () => {
    expect(trustDeviceForRequest(requestWith({ "user-agent": UA.linuxFirefox }))).toBe(
      "firefox-linux",
    );
    expect(
      trustDeviceForRequest(
        requestWith({ "user-agent": UA.macosSafari, "sec-ch-ua-platform": '"Windows"' }),
      ),
    ).toBe("windows");
  });

  it("asks for those two headers and no others", () => {
    // Pins that THIS function reads only the two headers; it says nothing about the route handlers,
    // which could still read a cookie themselves.
    const asked: string[] = [];
    trustDeviceForRequest({
      header: (name: string) => {
        asked.push(name);
        return undefined;
      },
    });
    expect(asked.sort()).toEqual(["sec-ch-ua-platform", "user-agent"]);
  });

  it("answers unknown when the request carries neither header", () => {
    expect(trustDeviceForRequest(requestWith({}))).toBe("unknown");
  });
});
