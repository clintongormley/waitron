import { describe, expect, it } from "vitest";
import {
  CA_CONTENT_TYPE,
  CA_FILENAME,
  ownAddressFor,
  renderTrustPage,
  type TrustPageInput,
} from "./trust-page.js";
import { DEVICE_HELP, DEVICE_ORDER } from "./trust-page-devices.js";
import { DECLARATION_LINK_WORDS } from "./i18n/declaration-page.js";
import { SERVER_THEME_DEFAULTS } from "./theme-defaults.js";

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
  it.each([true, false])(
    "links the declaration at its foot (certificate available: %s)",
    (caAvailable) => {
      const html = renderTrustPage({ ...base, caAvailable });
      expect(html).toContain(
        `<p class="note"><a href="/legal/declaration" lang="es">${DECLARATION_LINK_WORDS.title}</a></p>\n</main>`,
      );
    },
  );

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
    expect(html).toMatch(heading("1. Remove any old Waitron certificate"));
    expect(html).toContain(help.removal[0]);
    expect(html).toMatch(heading("2. Get the certificate"));
    expect(html).toMatch(heading(`3. ${help.heading}`));
    expect(html).toContain(help.install[0]);
    expect(html).toMatch(heading("4. Open Waitron"));
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
    expect(html).toMatch(heading("1. Remove any old Waitron certificate"));
    expect(html).toContain("Find your device in step 3");
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
    expect(html).not.toContain("tax-agency");
  });
});

it("warns that a download may need confirming before it reaches the disk", () => {
  expect(renderTrustPage(base)).toMatch(/Keep/);
});

it("judges the page the link opens, not the one the operator is reading", () => {
  const html = renderTrustPage({ ...base, device: "windows" });
  // `deploy/waitron.sh` prints an HTTP entry point, and installing a certificate authority does not
  // make an HTTP page secure, so THIS page reads "Not secure" however well the install went.
  expect(html).toContain(
    "Open Waitron with the link below, then check the address bar of the page it opens.",
  );
  // Not a bare /reopen this page/i: every device's steps legitimately end with that phrase.
  expect(html).not.toContain("Reopen this page. If your address bar");
  expect(html).not.toContain("start again from the beginning of this page");
});

it("shows the browser's own warning words when telling the operator to start again", () => {
  const html = renderTrustPage({ ...base, device: "windows" });
  expect(html).toContain('<span class="warning-words">Not secure</span>');
  expect(html).toContain("come back here and start again from step 1.");
});

// Every hand-copied token pair in the page's stylesheet, light then dark.
const pair = (token: string): string =>
  `light-dark(${SERVER_THEME_DEFAULTS.light[token]}, ${SERVER_THEME_DEFAULTS.dark[token]})`;
it.each([
  ["--wt-color-primary", (value: string) => `background: ${value}`],
  ["--wt-color-on-primary", (value: string) => `color: ${value}`],
  ["--wt-color-primary-text", (value: string) => `a { color: ${value}; }`],
  ["--wt-color-focus", (value: string) => `outline: 3px solid ${value}`],
  ["--wt-color-text-muted", (value: string) => `.note { color: ${value};`],
  ["--wt-color-danger", (value: string) => `.accent, .warning-words { color: ${value}; }`],
])("keeps %s in step with the design tokens", (token, declaration) => {
  expect(renderTrustPage(base)).toContain(declaration(pair(token)));
});

it("drops the troubleshooting box the owner did not want", () => {
  expect(renderTrustPage(base)).not.toContain("If you cannot open or download");
});

it("shows the Waitron logo without fetching anything", () => {
  const html = renderTrustPage(base);
  expect(html).toContain('aria-label="Waitron"');
  expect(html).not.toMatch(/<(img|link)\b|<script[^>]+\bsrc=/);
});

it("shows a QR only when one was rendered, and says nothing when there is none", () => {
  const without = renderTrustPage(base);
  expect(without).not.toContain("Open this page on another device");
  expect(without).not.toMatch(/No QR code/i);
  const withQr = renderTrustPage({ ...base, qrSvg: "<svg id='qr'></svg>" });
  expect(withQr).toContain("<svg id='qr'></svg>");
  expect(withQr).toContain("Open this page on another device");
  expect(withQr).not.toContain("This QR opens the box address.");
});

it.each([
  ["plain", {}],
  ["with the spare's lead line", { ownAddress: "https://192.168.1.50" }],
])("calls it a server, never a box (%s)", (_name, extra) => {
  const html = renderTrustPage({ ...base, ...extra });
  expect(html).not.toMatch(/\bbox(es)?\b/i);
  expect(html).not.toContain("numeric network address");
});

it("gives operator-certificate guidance without referring to missing instructions", () => {
  const html = renderTrustPage({ ...base, caAvailable: false });
  expect(html).not.toContain("4. Open Waitron");
  expect(html).not.toContain("The instructions above include replacement");
  expect(html).toContain("This page cannot replace a separately installed certificate.");
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
  expect(html).not.toContain("Install the certificate on that device first");
});

it("gives a safe device alternative when certificate removal or installation is blocked", () => {
  const html = renderTrustPage({ ...base, device: "linux" });
  expect(html).toContain(
    "If you cannot identify the old Waitron entry, stop and use another venue device.",
  );
  expect(html).toContain("If installation is blocked, use a venue device that permits it.");
  expect(html).not.toMatch(/ask whoever|an administrator may have to/);
});

describe("a page opened while another box answers waitron.local", () => {
  const LEAD =
    "Adding a spare? You don't need this server's certificate: open this address " +
    '(<a href="https://192.168.1.50">https://192.168.1.50</a>) and accept your browser\'s warning once.';

  it("leads with the spare's way in, above the certificate steps, and keeps those steps", () => {
    const html = renderTrustPage({ ...base, ownAddress: "https://192.168.1.50" });
    expect(html).toContain(LEAD);
    expect(html.indexOf(LEAD)).toBeLessThan(html.indexOf("1. Remove any old Waitron certificate"));
    const plain = renderTrustPage(base);
    const stepsOf = (page: string) =>
      page.slice(page.indexOf("<section><h2>1."), page.indexOf('<section class="go">'));
    expect(stepsOf(html)).toBe(stepsOf(plain));
  });

  it("sends the button and the first link to this box's own address, keeping waitron.local after it", () => {
    const html = renderTrustPage({ ...base, ownAddress: "https://192.168.1.50" });
    expect(html).toContain('<a class="button" href="https://192.168.1.50">Continue to Waitron</a>');
    expect(html).toContain(
      '<ul><li><a href="https://192.168.1.50">https://192.168.1.50</a></li>' +
        '<li><a href="https://waitron.local">https://waitron.local</a></li></ul>',
    );
  });

  it("keeps the till's path on this box's own address", () => {
    const html = renderTrustPage({
      ...base,
      httpsUrl: "https://waitron.local:8080/till/",
      reachUrls: ["https://waitron.local:8080", "https://192.168.1.50:8080"],
      ownAddress: "https://192.168.1.50:8080",
    });
    expect(html).toContain(
      '<a class="button" href="https://192.168.1.50:8080/till/">Continue to Waitron</a>',
    );
  });

  it("escapes the address it leads with", () => {
    const html = renderTrustPage({ ...base, ownAddress: 'https://x"<y' });
    expect(html).toContain('href="https://x&quot;&lt;y"');
    expect(html).not.toContain('https://x"<y');
  });

  it("is today's page when there is no own address to offer", () => {
    const html = renderTrustPage({ ...base, ownAddress: undefined });
    expect(html).toBe(renderTrustPage(base));
    expect(html).not.toContain("Adding a spare");
  });
});

describe("ownAddressFor", () => {
  const ips = ["https://192.168.1.50:8080", "https://10.0.0.7:8080"];

  it("prefers the address the person opened the page on", () => {
    expect(ownAddressFor("other-box-answers", ips, "10.0.0.7")).toBe("https://10.0.0.7:8080");
  });

  it("falls back to the first address when the page was opened by name", () => {
    expect(ownAddressFor("other-box-answers", ips, "waitron.local")).toBe(
      "https://192.168.1.50:8080",
    );
  });

  it("offers nothing when the box has no address of its own", () => {
    expect(ownAddressFor("other-box-answers", [], "waitron.local")).toBeUndefined();
  });

  it.each(["no-other-box", "not-asked", "ask-failed", undefined] as const)(
    "offers nothing unless another box answers (%s)",
    (state) => {
      expect(ownAddressFor(state, ips, "10.0.0.7")).toBeUndefined();
    },
  );
});
