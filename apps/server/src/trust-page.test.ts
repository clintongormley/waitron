import { describe, expect, it } from "vitest";
import {
  CA_CONTENT_TYPE,
  CA_FILENAME,
  renderTrustPage,
  type TrustPageInput,
} from "./trust-page.js";
import { DEVICE_HELP, DEVICE_ORDER } from "./trust-page-devices.js";

const base: TrustPageInput = {
  reachUrls: ["https://waitron.local", "https://192.168.1.50"],
  caAvailable: true,
  caDownloadPath: "/ca.crt",
  httpsUrl: "https://waitron.local",
  device: "unknown",
};

/** An open section's heading, allowing the step number the page prefixes to it. */
const heading = (text: string): RegExp =>
  new RegExp(`<h2>[^<]*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</h2>`);

describe("renderTrustPage", () => {
  it("renders the CA download link at the given path, reach URLs and the https link", () => {
    const html = renderTrustPage({ ...base, caDownloadPath: "/setup-api/ca.crt" });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('href="/setup-api/ca.crt"');
    expect(html).toContain("https://waitron.local");
  });

  it("honours a different caDownloadPath (the landing origin uses /ca.crt)", () => {
    const html = renderTrustPage(base);
    expect(html).toContain('href="/ca.crt"');
    expect(html).not.toContain("/setup-api/ca.crt");
  });

  it("omits the download link when no server CA is present", () => {
    const html = renderTrustPage({ ...base, caAvailable: false });
    expect(html).not.toContain('href="/ca.crt"');
  });

  it("exposes the CA content-type and filename", () => {
    expect(CA_CONTENT_TYPE).toBe("application/x-x509-ca-cert");
    expect(CA_FILENAME).toBe("waitron-ca.crt");
  });
});

describe("the guessed device", () => {
  it.each(DEVICE_ORDER)("opens %s's own steps and folds the rest away", (device) => {
    const html = renderTrustPage({ ...base, device });
    const help = DEVICE_HELP[device];
    // The guessed device's heading is a real heading, not a disclosure the operator must find.
    expect(html).toMatch(heading(help.heading));
    expect(html).toContain(help.install[0]);
    // Every other device is still reachable, behind one closed disclosure.
    expect(html).toContain("Using a different device?");
    for (const other of DEVICE_ORDER.filter((d) => d !== device))
      expect(html).toContain(DEVICE_HELP[other].summary);
  });

  it("falls back to the full closed list when the headers name no device it knows", () => {
    const html = renderTrustPage(base);
    for (const device of DEVICE_ORDER) expect(html).toContain(DEVICE_HELP[device].summary);
    // Nothing is pre-opened, so no device gets a heading of its own.
    for (const device of DEVICE_ORDER)
      expect(html).not.toMatch(heading(DEVICE_HELP[device].heading));
    expect(html).not.toContain("Using a different device?");
  });

  it("never prints a device it was not asked for", () => {
    const html = renderTrustPage({ ...base, device: "ios" });
    expect(html).toContain(DEVICE_HELP.ios.heading);
    expect(html).not.toMatch(heading(DEVICE_HELP.macos.heading));
  });
});

it("covers common operating systems, browser stores and replacement certificates", () => {
  const html = renderTrustPage(base);
  for (const name of [
    "macOS",
    "Windows",
    "Linux",
    "ChromeOS",
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
  expect(html).toContain("HTTPS");
});

it("warns that a download may need confirming before it reaches the disk", () => {
  expect(renderTrustPage(base)).toMatch(/Keep/);
});

it("offers each device its own way to clear a certificate it already holds", () => {
  const html = renderTrustPage({ ...base, device: "windows" });
  expect(html).toContain("Already installed a Waitron certificate?");
  expect(html).toContain(DEVICE_HELP.windows.removal[0]);
});

it("shows the Waitron logo without fetching anything", () => {
  const html = renderTrustPage(base);
  expect(html).toContain('aria-label="Waitron"');
  expect(html).not.toMatch(/<(img|script|link)\b/);
});

it("shows a QR only when one was rendered, and says nothing when there is none", () => {
  const without = renderTrustPage(base);
  expect(without).not.toContain("Open on another device");
  expect(without).not.toMatch(/No QR code/i);
  const withQr = renderTrustPage({ ...base, qrSvg: "<svg id='qr'></svg>" });
  expect(withQr).toContain("<svg id='qr'></svg>");
  expect(withQr).toContain("Open on another device");
});

it("calls it a server with an IP address, not a box with a numeric network address", () => {
  const html = renderTrustPage(base);
  expect(html).not.toMatch(/\bbox(es)?\b/i);
  expect(html).toContain("IP address");
  expect(html).not.toContain("numeric network address");
});

it("gives operator-certificate guidance without referring to missing instructions", () => {
  const html = renderTrustPage({ ...base, caAvailable: false });
  expect(html).not.toContain("3. Open Waitron");
  expect(html).not.toContain("The instructions above include replacement");
  expect(html).toContain("whoever installed");
  // With no certificate to install there are no device steps to open or fold away.
  expect(html).not.toContain("Using a different device?");
  expect(html).not.toContain("Already installed a Waitron certificate?");
});

it("does not describe a plain HTTP recovery destination as secure", () => {
  const html = renderTrustPage({
    ...base,
    reachUrls: ["http://waitron.local"],
    caAvailable: false,
    httpsUrl: "http://waitron.local",
    qrSvg: "<svg></svg>",
  });
  expect(html).toContain('href="http://waitron.local">Continue to Waitron</a>');
  expect(html).not.toContain("secure site");
  expect(html).not.toContain("secure server address");
  expect(html).not.toContain("Install the certificate on that device first");
});
