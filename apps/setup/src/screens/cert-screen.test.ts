import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./cert-screen.js";
import type { SetupCertScreen } from "./cert-screen.js";
import type { DeepPartial } from "../setup-app.js";
import type { ProvisionBody } from "../api/client.js";

type Emitted = { kind: "patch" | "goto"; detail: unknown };

function collect(host: HTMLElement): Emitted[] {
  const events: Emitted[] = [];
  host.addEventListener("setup-patch", (e) =>
    events.push({ kind: "patch", detail: (e as CustomEvent).detail }),
  );
  host.addEventListener("setup-goto", (e) =>
    events.push({ kind: "goto", detail: (e as CustomEvent).detail }),
  );
  return events;
}

const q = (el: SetupCertScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

async function typePassphrase(el: SetupCertScreen, value: string): Promise<void> {
  q(el, "[data-test=passphrase]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function pickKind(el: SetupCertScreen, value: string): Promise<void> {
  const select = q(el, "[data-test=certKind]") as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change"));
  await el.updateComplete;
}

async function waitForFileLoaded(el: SetupCertScreen): Promise<void> {
  for (let i = 0; i < 100; i++) {
    await el.updateComplete;
    if (q(el, "[data-test=file-status]")) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error("file-status never appeared");
}

async function chooseFile(el: SetupCertScreen, source: number[], name = "cert.pfx"): Promise<void> {
  const bytes = new Uint8Array(new ArrayBuffer(source.length));
  bytes.set(source);
  const input = q(el, "[data-test=pfx]") as HTMLInputElement;
  const file = new File([bytes], name, { type: "application/x-pkcs12" });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change"));
  await waitForFileLoaded(el);
}

/** Includes bytes from the high half of the range. */
const PFX_SOURCE = [1, 2, 3, 4, 250, 200, 0, 255];
const EXPECTED_BASE64 = btoa(String.fromCharCode(...PFX_SOURCE));

/** Fails every read via `onerror`. `readFileAsBase64` looks up the global `FileReader` at call time,
 * so swapping `globalThis.FileReader` reaches it. */
class FailingFileReader {
  error: unknown = new Error("file read failed");
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(): void {
    queueMicrotask(() => this.onerror?.());
  }
}

afterEach(cleanupWidgets);

describe("setup-cert-screen", () => {
  it("gives the certificate passphrase a stable non-login name", async () => {
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const input = q(el, "[data-test=passphrase]")!.shadowRoot!.querySelector("input")!;
    expect({ name: input.name, autocomplete: input.autocomplete }).toEqual({
      name: "certificate-passphrase",
      autocomplete: "off",
    });
  });

  it("gives every certificate field a stable name", async () => {
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    expect((q(el, "[data-test=pfx]") as HTMLInputElement).name).toBe("certificate-file");
    expect((q(el, "[data-test=certKind]") as HTMLSelectElement).name).toBe("certificate-kind");
  });

  it("lets the operator reveal and hide the certificate passphrase", async () => {
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    expect(q(el, "[data-test=passphrase]")!.getAttribute("type")).toBe("password");
    q(el, "[data-test=toggle-passphrase]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=passphrase]")!.getAttribute("type")).toBe("text");
    expect(q(el, "[data-test=toggle-passphrase]")!.getAttribute("aria-label")).toBe(
      "Hide certificate passphrase",
    );
  });

  it("reads the file to canonical base64 with NO data: prefix, and emits the cert patch", async () => {
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const events = collect(host);
    await chooseFile(el, PFX_SOURCE);
    await typePassphrase(el, "unlock-2026");
    q(el, "[data-test=next]")!.click();

    expect(events).toEqual([
      {
        kind: "patch",
        detail: {
          patch: {
            aeatCert: {
              pfxBase64: EXPECTED_BASE64,
              passphrase: "unlock-2026",
              certKind: "sello",
            },
          },
        },
      },
      { kind: "goto", detail: { screen: "fiscal-test" } },
    ]);
    const patch = (events[0].detail as { patch: DeepPartial<ProvisionBody> }).patch;
    const pfx = patch.aeatCert?.pfxBase64 ?? "";
    expect(pfx.startsWith("data:")).toBe(false);
    expect(pfx.includes(",")).toBe(false);
  });

  it("carries a changed certKind into the patch", async () => {
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const events = collect(host);
    await chooseFile(el, PFX_SOURCE);
    await typePassphrase(el, "unlock-2026");
    await pickKind(el, "representante");
    q(el, "[data-test=next]")!.click();
    const patch = (events[0].detail as { patch: DeepPartial<ProvisionBody> }).patch;
    expect(patch.aeatCert?.certKind).toBe("representante");
  });

  it("shows the chosen file name in the loaded status (never the bytes)", async () => {
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    await chooseFile(el, PFX_SOURCE, "empresa.pfx");
    const status = q(el, "[data-test=file-status]")!;
    expect(status.textContent).toContain("empresa.pfx");
    expect(status.textContent).not.toContain(EXPECTED_BASE64);
  });

  it("clears the loaded file when the picker is emptied", async () => {
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    await chooseFile(el, PFX_SOURCE);
    expect(q(el, "[data-test=file-status]")).not.toBeNull();

    const input = q(el, "[data-test=pfx]") as HTMLInputElement;
    input.files = new DataTransfer().files;
    input.dispatchEvent(new Event("change"));
    await el.updateComplete;
    expect(q(el, "[data-test=file-status]")).toBeNull();
  });

  it("blocks Next when no file is chosen, marking the file field invalid", async () => {
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const events = collect(host);
    await typePassphrase(el, "unlock-2026");
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=error]")).not.toBeNull();
    const summary = el.shadowRoot!.querySelector("wt-form-error-summary") as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await summary.updateComplete;
    expect(summary.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
    expect(q(el, ".field.file")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=pfx-field-error]")).not.toBeNull();
    expect((q(el, "[data-test=pfx]") as HTMLInputElement).getAttribute("aria-invalid")).toBe(
      "true",
    );
  });

  it("blocks Next when the passphrase is blank, marking it invalid", async () => {
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const events = collect(host);
    await chooseFile(el, PFX_SOURCE);
    await typePassphrase(el, "   "); // whitespace-only counts as blank
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=error]")).not.toBeNull();
    expect(q(el, "[data-test=passphrase]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=passphrase-field-error]")).not.toBeNull();
  });

  it("clears the banner once a file and passphrase are supplied and Next succeeds", async () => {
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const events = collect(host);
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=error]")).not.toBeNull();
    await chooseFile(el, PFX_SOURCE);
    await typePassphrase(el, "unlock-2026");
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=error]")).toBeNull();
    expect(events.some((e) => e.kind === "goto")).toBe(true);
  });

  it("seeds passphrase, certKind and the loaded status from a draft cert", async () => {
    const draft: DeepPartial<ProvisionBody> = {
      aeatCert: {
        pfxBase64: EXPECTED_BASE64,
        passphrase: "seeded-pass",
        certKind: "representante",
      },
    };
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", { draft });
    expect((q(el, "[data-test=passphrase]") as unknown as { value: string }).value).toBe(
      "seeded-pass",
    );
    expect((q(el, "[data-test=certKind]") as HTMLSelectElement).value).toBe("representante");
    expect(q(el, "[data-test=file-status]")).not.toBeNull();
  });

  it("emits the seeded cert unchanged when Next is pressed without re-choosing a file", async () => {
    const draft: DeepPartial<ProvisionBody> = {
      aeatCert: { pfxBase64: EXPECTED_BASE64, passphrase: "seeded-pass", certKind: "sello" },
    };
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", { draft });
    const events = collect(host);
    q(el, "[data-test=next]")!.click();
    const patch = (events[0].detail as { patch: DeepPartial<ProvisionBody> }).patch;
    expect(patch.aeatCert).toEqual({
      pfxBase64: EXPECTED_BASE64,
      passphrase: "seeded-pass",
      certKind: "sello",
    });
  });

  it("emits the default company-seal kind when the draft cert names none", async () => {
    const draft: DeepPartial<ProvisionBody> = {
      aeatCert: { pfxBase64: EXPECTED_BASE64, passphrase: "seeded-pass" },
    };
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", { draft });
    const events = collect(host);
    q(el, "[data-test=next]")!.click();
    const patch = (events[0].detail as { patch: DeepPartial<ProvisionBody> }).patch;
    expect(patch.aeatCert).toEqual({
      pfxBase64: EXPECTED_BASE64,
      passphrase: "seeded-pass",
      certKind: "sello",
    });
  });

  it("advances when Enter is pressed in the passphrase field", async () => {
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const events = collect(host);
    await chooseFile(el, PFX_SOURCE);
    await typePassphrase(el, "unlock-2026");
    q(el, "[data-test=passphrase]")!.shadowRoot!.querySelector("input")!.focus();
    await userEvent.keyboard("{Enter}");
    expect(events.map((event) => event.kind)).toEqual(["patch", "goto"]);
    expect(events[1]!.detail).toEqual({ screen: "fiscal-test" });
  });

  it("seeds only the fields a partial draft cert carries, leaving the rest at their defaults", async () => {
    const draft: DeepPartial<ProvisionBody> = {
      aeatCert: { certKind: "representante" }, // no pfxBase64, no passphrase
    };
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", { draft });
    expect((q(el, "[data-test=certKind]") as HTMLSelectElement).value).toBe("representante");
    expect((q(el, "[data-test=passphrase]") as unknown as { value: string }).value).toBe("");
    expect(q(el, "[data-test=file-status]")).toBeNull();
  });

  it("steps back to venue without emitting a patch", async () => {
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const events = collect(host);
    q(el, "[data-test=back]")!.click();
    expect(events).toEqual([{ kind: "goto", detail: { screen: "venue" } }]);
  });

  it("shows a read-error banner and stays blocked when the FileReader fails, without an unhandled rejection", async () => {
    const rejections: PromiseRejectionEvent[] = [];
    const onReject = (e: PromiseRejectionEvent) => rejections.push(e);
    window.addEventListener("unhandledrejection", onReject);
    const RealFileReader = globalThis.FileReader;
    globalThis.FileReader = FailingFileReader as unknown as typeof FileReader;
    try {
      const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
      const events = collect(host);
      const input = q(el, "[data-test=pfx]") as HTMLInputElement;
      const file = new File([new Uint8Array([1, 2, 3])], "cert.pfx", {
        type: "application/x-pkcs12",
      });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change"));
      // Let the microtask (onerror), the catch, and the re-render settle.
      await new Promise((r) => setTimeout(r, 0));
      await el.updateComplete;

      const banner = q(el, "[data-test=error]");
      expect(banner).not.toBeNull();
      await (banner as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
      expect(banner!.shadowRoot!.textContent).toContain("couldn't read that file");
      expect(q(el, "[data-test=file-status]")).toBeNull();

      q(el, "[data-test=next]")!.click();
      await el.updateComplete;
      expect(events).toEqual([]);
    } finally {
      globalThis.FileReader = RealFileReader;
      window.removeEventListener("unhandledrejection", onReject);
    }
    expect(rejections).toEqual([]);
  });
});

/** The guessed guide is promoted out of the list: one entry pre-opened inside a list of every entry
 * did not read as detection. */
it.each([
  ["Mozilla/5.0 (Windows NT 10.0) Chrome/130", "Windows (Chrome)"],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605", "macOS (Keychain Access)"],
  ["Mozilla/5.0 (Windows NT 10.0) Firefox/140", "Firefox"],
])("promotes %s's own steps and folds the other guides away", async (userAgent, expected) => {
  const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  try {
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const help = q(el, "[data-test=certificate-export-help]")!;
    const promoted = help.querySelector("[data-test=export-guide] h3")!;
    expect(promoted.textContent).toContain(expected);
    expect(help.querySelector("[data-test=export-guide] ol")!.children.length).toBeGreaterThan(0);
    const others = help.querySelector<HTMLDetailsElement>("[data-test=other-guides]")!;
    expect(others.open).toBe(false);
    expect(others.querySelectorAll("details")).toHaveLength(2);
    expect(others.textContent).not.toContain(expected);
  } finally {
    ua.mockRestore();
  }
});

it.each([
  ["a phone", "Mozilla/5.0 (iPhone; CPU iPhone OS) Safari/605"],
  ["a desktop it has no guide for", "Mozilla/5.0 (X11; Linux x86_64) Chrome/130"],
])("lists every guide, and says so, when the browser is on %s", async (_, userAgent) => {
  const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  try {
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const help = q(el, "[data-test=certificate-export-help]")!;
    expect(help.querySelector("[data-test=export-guide]")).toBeNull();
    expect(help.querySelector("[data-test=other-guides]")).toBeNull();
    expect([...help.querySelectorAll("details > summary")].map((s) => s.textContent)).toEqual([
      "Windows (Chrome)",
      "macOS (Keychain Access)",
      "Firefox",
    ]);
    expect(help.querySelector("details[open]")).toBeNull();
    expect(help.textContent).toContain("another computer");
  } finally {
    ua.mockRestore();
  }
});

it("uses the icon reveal control for the certificate passphrase", async () => {
  const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
  expect(q(el, "[data-test=toggle-passphrase]")!.querySelector("svg")).not.toBeNull();
});
