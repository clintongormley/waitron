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
  it.each(DEVICE_ORDER)("walks %s through remove, get, install, open", (device) => {
    const html = renderTrustPage({ ...base, device });
    const help = DEVICE_HELP[device];
    // Removing an old certificate comes FIRST: installing over one that is still trusted does
    // nothing visible, and the operator has no way to tell that is what happened.
    expect(html).toMatch(heading("1. Remove any old Waitron certificate"));
    expect(html).toContain(help.removal[0]);
    expect(html).toMatch(heading("2. Get the certificate"));
    expect(html).toMatch(heading(`3. ${help.heading}`));
    expect(html).toContain(help.install[0]);
    expect(html).toMatch(heading("4. Open Waitron"));
    // Removal is a numbered step now, so the box that used to hold it is gone.
    expect(html).not.toContain("Already installed a Waitron certificate?");
    expect(html).toContain("Using a different device?");
    for (const other of DEVICE_ORDER.filter((d) => d !== device))
      expect(html).toContain(DEVICE_HELP[other].summary);
  });

  it("tells the operator to reopen this page after removing the old certificate", () => {
    const html = renderTrustPage({ ...base, device: "macos" });
    expect(html).toContain("Then quit your browser completely and reopen this page.");
  });

  it("falls back to the full closed list when the headers name no device it knows", () => {
    const html = renderTrustPage(base);
    for (const device of DEVICE_ORDER) expect(html).toContain(DEVICE_HELP[device].summary);
    for (const device of DEVICE_ORDER)
      expect(html).not.toMatch(heading(`3. ${DEVICE_HELP[device].heading}`));
    expect(html).not.toContain("Using a different device?");
    // With no device to name, step 1 still exists but points at the list rather than listing twice.
    expect(html).toMatch(heading("1. Remove any old Waitron certificate"));
    expect(html).toMatch(heading("3. Install it on your device"));
  });

  it("never prints a device it was not asked for", () => {
    const html = renderTrustPage({ ...base, device: "ios" });
    expect(html).toMatch(heading(`3. ${DEVICE_HELP.ios.heading}`));
    expect(html).not.toMatch(heading(`3. ${DEVICE_HELP.macos.heading}`));
  });
});

describe("the words at the top", () => {
  it("marks the word securely, and says what the certificate is for", () => {
    const html = renderTrustPage(base);
    expect(html).toMatch(
      /<h1>Connect <span class="accent">securely<\/span> to this Waitron server<\/h1>/,
    );
    expect(html).toContain(
      "You need to install the Waitron secure certificate before entering passwords and sensitive information into this website:",
    );
    // The tax-agency aside went: nothing on this page offers a tax-agency certificate to confuse it with.
    expect(html).not.toContain("tax-agency");
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
});

it("warns that a download may need confirming before it reaches the disk", () => {
  expect(renderTrustPage(base)).toMatch(/Keep/);
});

it("shows the browser's own warning words when telling the operator to start again", () => {
  const html = renderTrustPage({ ...base, device: "windows" });
  expect(html).toContain('<span class="warning-words">“not secure”</span>');
  expect(html).toContain("start again from the beginning of this page");
});

it("drops the troubleshooting box the owner did not want", () => {
  expect(renderTrustPage(base)).not.toContain("If you cannot open this page");
});

it("shows the Waitron logo without fetching anything", () => {
  const html = renderTrustPage(base);
  expect(html).toContain('aria-label="Waitron"');
  expect(html).not.toMatch(/<(img|script|link)\b/);
});

it("shows a QR only when one was rendered, and says nothing when there is none", () => {
  const without = renderTrustPage(base);
  expect(without).not.toContain("Open this page on another device");
  expect(without).not.toMatch(/No QR code/i);
  const withQr = renderTrustPage({ ...base, qrSvg: "<svg id='qr'></svg>" });
  expect(withQr).toContain("<svg id='qr'></svg>");
  expect(withQr).toContain("Open this page on another device");
  // The caption explained what a QR is to someone already holding a phone at it.
  expect(withQr).not.toContain("This QR opens the server address.");
});

it("calls it a server, never a box", () => {
  const html = renderTrustPage(base);
  expect(html).not.toMatch(/\bbox(es)?\b/i);
  expect(html).not.toContain("numeric network address");
});

it("gives operator-certificate guidance without referring to missing instructions", () => {
  const html = renderTrustPage({ ...base, caAvailable: false });
  expect(html).not.toContain("4. Open Waitron");
  expect(html).not.toContain("The instructions above include replacement");
  expect(html).toContain("whoever installed");
  // With no certificate to install there are no device steps to open or fold away.
  expect(html).not.toContain("Using a different device?");
  expect(html).not.toContain("Remove any old Waitron certificate");
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
