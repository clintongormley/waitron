import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
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

/** The form's one message above Next, shown by `wt-form-actions`. */
async function bottomOf(el: SetupCertScreen): Promise<string> {
  const actions = q(el, "wt-form-actions") as HTMLElement & { updateComplete: Promise<unknown> };
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

const FIX_FIELDS = "Correct the highlighted fields to continue.";

async function typePassphrase(el: SetupCertScreen, value: string): Promise<void> {
  q(el, "[data-test=passphrase]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function pickKind(el: SetupCertScreen, value: string): Promise<void> {
  await chooseOption(q(el, "[data-test=certKind]")!, value);
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

  it("picks the certificate type from the shared dropdown, with its help beside the box", async () => {
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const events = collect(host);
    const kind = q(el, 'wt-combobox[name="certificate-kind"]') as
      | (HTMLElement & {
          options: { value: string; label: string }[];
          value: string;
          required: boolean;
          label: string;
          search: string;
        })
      | null;
    expect(kind).not.toBeNull();
    expect({
      label: kind!.label,
      required: kind!.required,
      search: kind!.search,
      value: kind!.value,
      options: kind!.options.map(({ value, label }) => ({ value, label: label.trim() })),
    }).toEqual({
      label: "Certificate type",
      required: true,
      search: "auto",
      value: "sello",
      options: [
        { value: "sello", label: "Company seal (sello)" },
        { value: "representante", label: "Representative (representante)" },
      ],
    });
    expect(kind!.querySelector("wt-help-tooltip[slot=help]")!.getAttribute("aria-label")).toBe(
      "Help with certificate type",
    );
    await chooseFile(el, PFX_SOURCE);
    await typePassphrase(el, "unlock-2026");
    await chooseOption(kind!, "representante");
    await el.updateComplete;
    q(el, "[data-test=next]")!.click();
    const patch = (events[0]!.detail as { patch: DeepPartial<ProvisionBody> }).patch;
    expect(patch.aeatCert?.certKind).toBe("representante");
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
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    const actions = q(el, "wt-form-actions")!;
    expect(actions.shadowRoot!.querySelector("[data-error][role=alert]")).not.toBeNull();
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
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(q(el, "[data-test=passphrase]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=passphrase]")!.getAttribute("error")).toBe(
      "Enter the certificate passphrase.",
    );
    // `wt-input` shows its `error` under itself, in its own shadow root; the screen repeats nothing.
    expect(el.shadowRoot!.textContent).not.toContain("Enter the certificate passphrase.");
  });

  it("clears the bottom message once a file and passphrase are supplied and Next succeeds", async () => {
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const events = collect(host);
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    await chooseFile(el, PFX_SOURCE);
    await typePassphrase(el, "unlock-2026");
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("");
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

  it("explains a failed read under the file field once Next is pressed, and stays blocked, without an unhandled rejection", async () => {
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

      expect(q(el, "[data-test=file-status]")).toBeNull();

      q(el, "[data-test=next]")!.click();
      await el.updateComplete;
      expect(events).toEqual([]);
      expect(q(el, "[data-test=pfx-field-error]")!.textContent).toContain(
        "couldn't read that file",
      );
    } finally {
      globalThis.FileReader = RealFileReader;
      window.removeEventListener("unhandledrejection", onReject);
    }
    expect(rejections).toEqual([]);
  });
});

describe("setup-cert-screen form errors", () => {
  const next = (el: SetupCertScreen) => q(el, "[data-test=next]")!;

  it("says nothing and leaves Next working before the first press", async () => {
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    expect(await bottomOf(el)).toBe("");
    expect(next(el).hasAttribute("disabled")).toBe(false);
    expect(q(el, "[data-test=pfx-field-error]")).toBeNull();
    expect(q(el, "[data-test=passphrase]")!.getAttribute("error")).toBe("");
  });

  it("on a failed press marks both fields, says so above Next, focuses the file field and disables Next", async () => {
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    next(el).click();
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));

    expect(q(el, "[data-test=pfx-field-error]")!.textContent?.trim()).toBe(
      "Choose the certificate file.",
    );
    expect(q(el, "[data-test=passphrase]")!.getAttribute("error")).toBe(
      "Enter the certificate passphrase.",
    );
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(el.shadowRoot!.activeElement).toBe(q(el, "[data-test=pfx]"));
    expect(next(el).hasAttribute("disabled")).toBe(true);
  });

  it("re-checks every change after a failed press, and Next works again once both are fixed", async () => {
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const events = collect(host);
    next(el).click();
    await el.updateComplete;

    await typePassphrase(el, "unlock-2026");
    expect(q(el, "[data-test=passphrase]")!.getAttribute("error")).toBe("");
    expect(next(el).hasAttribute("disabled")).toBe(true);

    await typePassphrase(el, "  ");
    expect(q(el, "[data-test=passphrase]")!.getAttribute("error")).toBe(
      "Enter the certificate passphrase.",
    );

    await typePassphrase(el, "unlock-2026");
    await chooseFile(el, PFX_SOURCE);
    expect(q(el, "[data-test=pfx-field-error]")).toBeNull();
    expect(await bottomOf(el)).toBe("");
    expect(next(el).hasAttribute("disabled")).toBe(false);
    next(el).click();
    expect(events.map(({ kind }) => kind)).toEqual(["patch", "goto"]);
  });

  /** Chooses a file with every read failing, and waits for the failure to settle. */
  async function chooseUnreadableFile(el: SetupCertScreen): Promise<void> {
    const RealFileReader = globalThis.FileReader;
    globalThis.FileReader = FailingFileReader as unknown as typeof FileReader;
    try {
      const input = q(el, "[data-test=pfx]") as HTMLInputElement;
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([1])], "cert.pfx"));
      input.files = dt.files;
      input.dispatchEvent(new Event("change"));
      await new Promise((r) => setTimeout(r, 0));
      await el.updateComplete;
    } finally {
      globalThis.FileReader = RealFileReader;
    }
  }

  it("says nothing about a failed read, and leaves Next working, before the first press", async () => {
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    await chooseUnreadableFile(el);
    expect(q(el, "[data-test=pfx-field-error]")).toBeNull();
    expect(q(el, ".field.file")!.hasAttribute("invalid")).toBe(false);
    expect(q(el, "[data-test=pfx]")!.getAttribute("aria-invalid")).toBe("false");
    expect(await bottomOf(el)).toBe("");
    expect(next(el).hasAttribute("disabled")).toBe(false);
  });

  it("drops a failed read's message once the operator chooses a file that reads", async () => {
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    await typePassphrase(el, "unlock-2026");
    await chooseUnreadableFile(el);
    next(el).click();
    await el.updateComplete;
    expect(q(el, "[data-test=pfx-field-error]")!.textContent).toContain("couldn't read that file");
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(next(el).hasAttribute("disabled")).toBe(true);

    await chooseFile(el, PFX_SOURCE);
    expect(q(el, "[data-test=pfx-field-error]")).toBeNull();
    expect(await bottomOf(el)).toBe("");
    expect(next(el).hasAttribute("disabled")).toBe(false);
  });

  it("says the bottom message in Spanish", async () => {
    setLocale("es-ES");
    try {
      const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
      next(el).click();
      await el.updateComplete;
      expect(await bottomOf(el)).toBe("Corrige los campos marcados para continuar.");
    } finally {
      setLocale("en-GB");
    }
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

describe("setup-cert-screen in Spanish", () => {
  afterEach(() => setLocale("en-GB"));

  it("shows its heading, fields, messages and export help in Spanish", async () => {
    setLocale("es-ES");
    const ua = vi
      .spyOn(navigator, "userAgent", "get")
      .mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605");
    try {
      const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
      expect(q(el, "h1")!.textContent).toBe("Certificado de la AEAT");
      expect(q(el, "[data-test=passphrase]")!.getAttribute("label")).toBe(
        "Contraseña del certificado",
      );
      const help = q(el, "[data-test=certificate-export-help]")!;
      expect(help.getAttribute("aria-label")).toBe("Exporta tu certificado de firma");
      expect(help.querySelector("[data-test=export-guide] h3")!.textContent).toBe(
        "macOS (Acceso a Llaveros)",
      );
      expect(help.querySelector("[data-test=export-guide] ol")!.textContent).toContain(
        "Acceso a Llaveros",
      );
      expect(
        (q(el, "[data-test=certKind]") as unknown as { options: { label: string }[] }).options.map(
          (option) => option.label.trim(),
        ),
      ).toEqual(["Sello electrónico", "Representante"]);
      q(el, "[data-test=next]")!.click();
      await el.updateComplete;
      expect(q(el, "[data-test=pfx-field-error]")!.textContent?.trim()).toBe(
        "Elige el archivo del certificado.",
      );
      expect(q(el, "[data-test=next]")!.textContent).toBe("Siguiente");
    } finally {
      ua.mockRestore();
    }
  });

  it("redraws in Spanish when the language is switched, keeping the typed passphrase", async () => {
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    await typePassphrase(el, "unlock-2026");
    setLocale("es-ES");
    await el.updateComplete;
    expect(q(el, "h1")!.textContent).toBe("Certificado de la AEAT");
    expect(q(el, "[data-test=certificate-export-help] h2")!.textContent).toBe(
      "Consigue el archivo de tu certificado",
    );
    expect((q(el, "[data-test=passphrase]") as unknown as { value: string }).value).toBe(
      "unlock-2026",
    );
  });
});
