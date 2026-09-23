import { afterEach, describe, expect, it, vi } from "vitest";
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

function fieldErrors(el: SetupLiveSourceScreen): string[] {
  return [...el.shadowRoot!.querySelectorAll("[data-test=field-error]")].map((node) =>
    node.textContent!.trim(),
  );
}

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
    const summary = el.shadowRoot!.querySelector("wt-form-error-summary") as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await summary.updateComplete;
    expect(summary.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("[data-test=field-error]")).toHaveLength(2);
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
    expect(el.shadowRoot!.querySelector("wt-form-error-summary")).not.toBeNull();
    chooseExport(el, EXPORT);
    await typePassphrase(el, "twelve-chars");
    q(el, "[data-test=import]")!.click();
    await el.updateComplete;
    expect(requested.mock.calls.map(([event]) => (event as CustomEvent).detail.request)).toEqual([
      { artifact: EXPORT, passphrase: "twelve-chars" },
    ]);
    expect(q(el, "[data-test=import]")!.hasAttribute("disabled")).toBe(true);
    expect(el.shadowRoot!.querySelector("wt-form-error-summary")).toBeNull();
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
    expect(q(el, "[role=alert]")?.textContent).toBe("The export could not be decrypted.");
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
