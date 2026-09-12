import { describe, expect, it } from "vitest";
import { CA_CONTENT_TYPE, CA_FILENAME, renderTrustPage } from "./trust-page.js";

describe("renderTrustPage", () => {
  it("renders the CA download link at the given path, reach URLs and the https link", () => {
    const html = renderTrustPage({
      reachUrls: ["https://waitron.local", "https://192.168.1.50"],
      caAvailable: true,
      caDownloadPath: "/setup-api/ca.crt",
      httpsUrl: "https://waitron.local",
    });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('href="/setup-api/ca.crt"'); // exact link, not a substring
    expect(html).toContain("https://waitron.local");
  });
  it("honours a different caDownloadPath (the landing origin uses /ca.crt)", () => {
    const html = renderTrustPage({
      reachUrls: [],
      caAvailable: true,
      caDownloadPath: "/ca.crt",
      httpsUrl: "https://waitron.local",
    });
    expect(html).toContain('href="/ca.crt"');
    expect(html).not.toContain("/setup-api/ca.crt");
  });
  it("omits the download link when no box CA is present", () => {
    const html = renderTrustPage({
      reachUrls: [],
      caAvailable: false,
      caDownloadPath: "/ca.crt",
      httpsUrl: "https://waitron.local",
    });
    expect(html).not.toContain('href="/ca.crt"');
  });
  it("exposes the CA content-type and filename", () => {
    expect(CA_CONTENT_TYPE).toBe("application/x-x509-ca-cert");
    expect(CA_FILENAME).toBe("waitron-ca.crt");
  });
});

it("covers common operating systems, browser stores and replacement certificates", () => {
  const html = renderTrustPage({
    reachUrls: [],
    caAvailable: true,
    caDownloadPath: "/ca.crt",
    httpsUrl: "https://waitron.local",
  });
  for (const name of [
    "macOS",
    "Windows",
    "Linux",
    "Android",
    "iPhone",
    "iPad",
    "Chrome",
    "Edge",
    "Firefox",
    "Safari",
  ])
    expect(html).toContain(name);
  expect(html).toContain("re-imaged");
  expect(html).toContain("fully quit");
  expect(html).toContain("old certificate");
  expect(html).toContain("HTTPS");
});

it("gives operator-certificate guidance without referring to missing instructions", () => {
  const html = renderTrustPage({
    reachUrls: [],
    caAvailable: false,
    caDownloadPath: "/ca.crt",
    httpsUrl: "https://waitron.local",
  });
  expect(html).not.toContain("3. Open Waitron");
  expect(html).not.toContain("The instructions above include replacement");
  expect(html).toContain("If this box was re-imaged");
  expect(html).toContain("whoever installed");
});

it("does not describe a plain HTTP recovery destination as secure", () => {
  const html = renderTrustPage({
    reachUrls: ["http://waitron.local"],
    caAvailable: false,
    caDownloadPath: "/ca.crt",
    httpsUrl: "http://waitron.local",
    qrSvg: "<svg></svg>",
  });
  expect(html).toContain('href="http://waitron.local">Continue to Waitron</a>');
  expect(html).not.toContain("secure site");
  expect(html).not.toContain("secure box address");
  expect(html).not.toContain("Install the certificate on that device first");
});
