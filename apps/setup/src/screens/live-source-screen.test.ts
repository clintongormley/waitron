import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { SetupLiveSourceScreen } from "./live-source-screen.js";

afterEach(cleanupWidgets);

const q = (el: SetupLiveSourceScreen, sel: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(sel);

function chooseExport(el: SetupLiveSourceScreen, file: File): void {
  const input = q(el, "input[type=file]") as HTMLInputElement;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change"));
}

async function typePassphrase(el: SetupLiveSourceScreen, value: string): Promise<void> {
  q(el, "wt-input")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

/** The export's message under its field, then the passphrase's, which `wt-input` shows under itself. */
function fieldErrors(el: SetupLiveSourceScreen): string[] {
  const exportErrors = [...el.shadowRoot!.querySelectorAll("[data-test=field-error]")].map((node) =>
    node.textContent!.trim(),
  );
  const passphrase = (q(el, "wt-input") as HTMLElement & { error: string }).error;
  return [...exportErrors, ...(passphrase === "" ? [] : [passphrase])];
}

/** The message element `wt-form-actions` shows above Import, or null when there is none. */
async function bottomElement(el: SetupLiveSourceScreen): Promise<HTMLElement | null> {
  const actions = q(el, "wt-form-actions") as HTMLElement & { updateComplete: Promise<unknown> };
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector<HTMLElement>("[data-error]");
}
async function bottomOf(el: SetupLiveSourceScreen): Promise<string> {
  return (await bottomElement(el))?.textContent?.trim() ?? "";
}
const FIX_FIELDS = "Correct the highlighted fields to continue.";

const EXPORT = new File(["encrypted"], "prepared.waitron-config");

describe("SetupLiveSourceScreen", () => {
  it("offers a separate empty production path", async () => {
    const { el, host } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
    const patch = vi.fn();
    const goto = vi.fn();
    host.addEventListener("setup-patch", patch);
    host.addEventListener("setup-goto", goto);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=empty]")!.click();
    expect((patch.mock.calls[0]![0] as CustomEvent).detail.patch).toEqual({
      configurationImport: false,
    });
    expect((goto.mock.calls[0]![0] as CustomEvent).detail.screen).toBe("admin");
  });

  it("requires the export and a twelve-character passphrase", async () => {
    const { el, host } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
    const requested = vi.fn();
    host.addEventListener("configuration-requested", requested);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=import]")!.click();
    await el.updateComplete;
    expect(requested).not.toHaveBeenCalled();
    expect((await bottomElement(el))?.getAttribute("role")).toBe("alert");
    expect(fieldErrors(el)).toHaveLength(2);
    expect(el.shadowRoot!.querySelector("input[type=file]")?.getAttribute("name")).toBe(
      "configuration-export",
    );
  });

  it("requests the import with the chosen export and a twelve-character passphrase", async () => {
    const { el, host } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
    const requested = vi.fn();
    host.addEventListener("configuration-requested", requested);
    q(el, "[data-test=import]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    chooseExport(el, EXPORT);
    await typePassphrase(el, "twelve-chars");
    q(el, "[data-test=import]")!.click();
    await el.updateComplete;
    expect(requested.mock.calls.map(([event]) => (event as CustomEvent).detail.request)).toEqual([
      { artifact: EXPORT, passphrase: "twelve-chars" },
    ]);
    expect(q(el, "[data-test=import]")!.hasAttribute("disabled")).toBe(true);
    expect(await bottomOf(el)).toBe("");
  });

  it("refuses an eleven-character passphrase even with an export chosen", async () => {
    const { el, host } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
    const requested = vi.fn();
    host.addEventListener("configuration-requested", requested);
    chooseExport(el, EXPORT);
    await typePassphrase(el, "eleven-char");
    q(el, "[data-test=import]")!.click();
    await el.updateComplete;
    expect(requested).not.toHaveBeenCalled();
    expect(fieldErrors(el)).toEqual(["Enter a passphrase of at least 12 characters."]);
  });

  it("clears the export's error once a file is chosen", async () => {
    const { el } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
    q(el, "[data-test=import]")!.click();
    await el.updateComplete;
    chooseExport(el, EXPORT);
    await el.updateComplete;
    expect(fieldErrors(el)).toEqual(["Enter a passphrase of at least 12 characters."]);
    expect(q(el, "input[type=file]")!.getAttribute("aria-invalid")).toBe("false");
  });

  it("clears the passphrase error once the passphrase is edited", async () => {
    const { el } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
    q(el, "[data-test=import]")!.click();
    await el.updateComplete;
    await typePassphrase(el, "twelve-chars");
    expect(fieldErrors(el)).toEqual(["Choose a configuration export."]);
    expect(q(el, "wt-input")!.hasAttribute("invalid")).toBe(false);
  });

  it("shows a routed-back import failure as an alert", async () => {
    const { el } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {
      errorMessage: "The export could not be decrypted.",
    });
    const alert = await bottomElement(el);
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.textContent).toBe("The export could not be decrypted.");
  });

  describe("messages above Import (design-system.md, Forms)", () => {
    it("says nothing and leaves Import working before the first press", async () => {
      const { el } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
      expect(await bottomOf(el)).toBe("");
      expect(fieldErrors(el)).toEqual([]);
      expect(q(el, "wt-form-error-summary")).toBeNull();
      expect(q(el, "[data-test=import]")!.hasAttribute("disabled")).toBe(false);
    });

    it("marks both fields once each, says one sentence above Import, focuses the export, and holds Import", async () => {
      const { el } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
      q(el, "[data-test=import]")!.click();
      await el.updateComplete;
      expect(fieldErrors(el)).toEqual([
        "Choose a configuration export.",
        "Enter a passphrase of at least 12 characters.",
      ]);
      expect(el.shadowRoot!.textContent).not.toContain(
        "Enter a passphrase of at least 12 characters.",
      );
      expect(await bottomOf(el)).toBe(FIX_FIELDS);
      expect(q(el, "[data-test=import]")!.hasAttribute("disabled")).toBe(true);
      await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(q(el, "input[type=file]")));
    });

    it("marks the passphrase again when it is shortened after the press, and gives Import back once both are fixed", async () => {
      const { el } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
      q(el, "[data-test=import]")!.click();
      await el.updateComplete;
      await typePassphrase(el, "twelve-chars");
      await typePassphrase(el, "short");
      expect(fieldErrors(el)).toEqual([
        "Choose a configuration export.",
        "Enter a passphrase of at least 12 characters.",
      ]);
      chooseExport(el, EXPORT);
      await typePassphrase(el, "twelve-chars");
      expect(fieldErrors(el)).toEqual([]);
      expect(await bottomOf(el)).toBe("");
      expect(q(el, "[data-test=import]")!.hasAttribute("disabled")).toBe(false);
    });

    it("gives Import back when an import it sent is refused, and drops the refusal on the next press", async () => {
      const { el } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
      chooseExport(el, EXPORT);
      await typePassphrase(el, "twelve-chars");
      q(el, "[data-test=import]")!.click();
      await el.updateComplete;
      expect(q(el, "[data-test=import]")!.hasAttribute("disabled")).toBe(true);
      el.errorMessage =
        "The configuration export could not be opened. Check the file and passphrase.";
      await el.updateComplete;
      expect(await bottomOf(el)).toBe(
        "The configuration export could not be opened. Check the file and passphrase.",
      );
      expect(q(el, "[data-test=import]")!.hasAttribute("disabled")).toBe(false);
      await typePassphrase(el, "short");
      q(el, "[data-test=import]")!.click();
      await el.updateComplete;
      expect(await bottomOf(el)).toBe(FIX_FIELDS);
    });
  });

  it("steps back to the mode screen", async () => {
    const { el, host } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
    const goto = vi.fn();
    host.addEventListener("setup-goto", goto);
    q(el, ".actions wt-button")!.click();
    expect(goto.mock.calls.map(([event]) => (event as CustomEvent).detail.screen)).toEqual([
      "mode",
    ]);
  });

  it("lets the operator reveal and hide the export passphrase", async () => {
    const { el } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
    const passphrase = el.shadowRoot!.querySelector("wt-input")!;
    expect(passphrase.getAttribute("type")).toBe("password");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=toggle-passphrase]")!.click();
    await el.updateComplete;
    expect(passphrase.getAttribute("type")).toBe("text");
  });
});

describe("SetupLiveSourceScreen in Spanish", () => {
  afterEach(() => setLocale("en-GB"));

  it("offers both paths and explains its refusals in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
    expect(q(el, "h1")!.textContent).toBe("Lleva tu restaurante preparado a producción");
    expect(q(el, "wt-input")!.getAttribute("label")).toBe("Contraseña de exportación");
    expect(q(el, "[data-test=empty]")!.textContent).toBe("Empezar desde cero");
    q(el, "[data-test=import]")!.click();
    await el.updateComplete;
    expect(fieldErrors(el)).toEqual([
      "Elige una exportación de configuración.",
      "Introduce una contraseña de al menos 12 caracteres.",
    ]);
  });

  it("switches language live, keeping the passphrase already typed", async () => {
    const { el } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
    await typePassphrase(el, "twelve-chars");
    setLocale("es-ES");
    await el.updateComplete;
    expect(q(el, "h1")!.textContent).toBe("Lleva tu restaurante preparado a producción");
    expect((q(el, "wt-input") as HTMLElement & { value: string }).value).toBe("twelve-chars");
  });
});
