import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WtFileInput } from "@waitron/ui";
import { setLocale } from "../i18n/t.js";
import { chooseFiles, fileControl } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { SetupLiveSourceScreen } from "./live-source-screen.js";
import type { ConfigurationRequestDetail } from "../events.js";

afterEach(cleanupWidgets);

const q = (el: SetupLiveSourceScreen, sel: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(sel);

const exportPicker = (el: SetupLiveSourceScreen) =>
  el.shadowRoot!.querySelector<WtFileInput>("wt-file-input")!;
const exportControl = (el: SetupLiveSourceScreen) => fileControl(exportPicker(el));
const chooseExport = (el: SetupLiveSourceScreen, file: File) => chooseFiles(exportPicker(el), file);

async function typePassphrase(el: SetupLiveSourceScreen, value: string): Promise<void> {
  q(el, "wt-input")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

/** The export's message, which `wt-file-input` shows under itself, then the passphrase's, which
 * `wt-input` shows under itself. */
function fieldErrors(el: SetupLiveSourceScreen): string[] {
  const exportError = exportPicker(el).error;
  const exportErrors = exportError === "" ? [] : [exportError];
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

/** Presses Import and returns the request it sent, which a refusal of it carries back. */
async function pressImport(el: SetupLiveSourceScreen): Promise<ConfigurationRequestDetail> {
  let sent: ConfigurationRequestDetail | undefined;
  const capture = (event: Event) => {
    sent = (event as CustomEvent<{ request: ConfigurationRequestDetail }>).detail.request;
  };
  el.addEventListener("configuration-requested", capture);
  q(el, "[data-test=import]")!.click();
  el.removeEventListener("configuration-requested", capture);
  await el.updateComplete;
  return sent!;
}

describe("SetupLiveSourceScreen", () => {
  it("explains the passphrase with a hint in the empty field and no ?", async () => {
    const { el } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
    const passphrase = q(el, "wt-input[name=export-passphrase]")!;
    expect(passphrase.getAttribute("hint")).toBe("The passphrase set when exporting");
    expect(passphrase.querySelector("wt-help-tooltip")).toBeNull();
  });

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
    expect(exportControl(el).getAttribute("name")).toBe("configuration-export");
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
    await exportPicker(el).updateComplete;
    expect(exportControl(el).getAttribute("aria-invalid")).toBe("false");
  });

  it("rings a missing export in the danger colour after Import is pressed", async () => {
    const { el, host } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
    host.style.setProperty("--wt-color-danger", "rgb(4, 5, 6)");
    q(el, "[data-test=import]")!.click();
    await el.updateComplete;
    const picker = exportPicker(el);
    await picker.updateComplete;
    expect(picker.invalid).toBe(true);
    const field = picker.shadowRoot!.querySelector("[part=field]")!;
    expect(field.hasAttribute("data-invalid")).toBe(true);
    expect(getComputedStyle(field).boxShadow).toContain("rgb(4, 5, 6)");
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
      await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(q(el, "wt-file-input")));
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
      const sent = await pressImport(el);
      expect(q(el, "[data-test=import]")!.hasAttribute("disabled")).toBe(true);
      Object.assign(el, {
        errorMessage:
          "The configuration export could not be opened. Check the file and passphrase.",
        refusedRequest: sent,
      });
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

  it("explains the passphrase with a Spanish hint", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
    expect(q(el, "wt-input[name=export-passphrase]")!.getAttribute("hint")).toBe(
      "La que se usó al exportar",
    );
  });

  it("offers both paths and explains its refusals in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
    expect(q(el, "h1")!.textContent).toBe("Importar una configuración");
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
    expect(q(el, "h1")!.textContent).toBe("Importar una configuración");
    expect((q(el, "wt-input") as HTMLElement & { value: string }).value).toBe("twelve-chars");
  });
});

it("puts a refused import passphrase under Passphrase, focuses it and allows retry", async () => {
  const { el, host } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
  chooseExport(el, EXPORT);
  await typePassphrase(el, "wrong-twelve-chars");
  const sent = await pressImport(el);
  Object.assign(el, {
    errorCode: "recovery.passphrase_invalid",
    errorMessage: "This passphrase does not open the export.",
    refusedRequest: sent,
  });
  await el.updateComplete;
  const field = el.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  const native = field.shadowRoot!.querySelector("input")!;
  await expect
    .element(page.elementLocator(native))
    .toHaveAccessibleDescription(/This passphrase does not open the export[.]/);
  expect(await bottomOf(el)).toBe(FIX_FIELDS);
  await expect.poll(() => field.shadowRoot!.activeElement).toBe(native);
  expect(q(el, "[data-test=import]")!.hasAttribute("disabled")).toBe(false);
  await typePassphrase(el, "correct-passphrase");
  expect(field.error).toBe("");
  expect(await bottomOf(el)).toBe("");
  const requested = vi.fn();
  host.addEventListener("configuration-requested", requested);
  q(el, "[data-test=import]")!.click();
  expect(requested).toHaveBeenCalledOnce();
});

it("puts an unreadable export under the export field, focuses it and clears it on a new file", async () => {
  const { el } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
  chooseExport(el, EXPORT);
  await typePassphrase(el, "right-twelve-chars");
  const sent = await pressImport(el);
  const unreadable =
    "This file is not a configuration export Waitron can read. Export it again from the box you exported from, then load the new export.";
  Object.assign(el, {
    errorCode: "setup.configuration_unreadable",
    errorMessage: unreadable,
    refusedRequest: sent,
  });
  await el.updateComplete;
  expect(fieldErrors(el)).toEqual([unreadable]);
  expect(exportPicker(el).invalid).toBe(true);
  expect(await bottomOf(el)).toBe(FIX_FIELDS);
  await expect.poll(() => exportPicker(el).shadowRoot!.activeElement).toBe(exportControl(el));
  expect(q(el, "[data-test=import]")!.hasAttribute("disabled")).toBe(false);
  chooseExport(el, new File(["other"], "other.waitron-config"));
  await el.updateComplete;
  expect(fieldErrors(el)).toEqual([]);
  expect(exportPicker(el).invalid).toBe(false);
  expect(await bottomOf(el)).toBe("");
});

it("clears an unreadable export's message when Import is pressed again", async () => {
  const { el, host } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
  chooseExport(el, EXPORT);
  await typePassphrase(el, "right-twelve-chars");
  Object.assign(el, {
    errorCode: "setup.configuration_unreadable",
    errorMessage: "This file is not a configuration export Waitron can read.",
    refusedRequest: { artifact: EXPORT, passphrase: "right-twelve-chars" },
  });
  await el.updateComplete;
  expect(fieldErrors(el)).toHaveLength(1);
  const requested = vi.fn();
  host.addEventListener("configuration-requested", requested);
  q(el, "[data-test=import]")!.click();
  await el.updateComplete;
  expect(requested).toHaveBeenCalledOnce();
  expect(fieldErrors(el)).toEqual([]);
  expect(await bottomOf(el)).toBe("");
});
