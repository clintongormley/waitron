import { PDFDocument } from "pdf-lib";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { applyTokens, LeaveController, type WtFileInput } from "@waitron/ui";
import {
  chooseFiles,
  drawnFileName,
  fileControl,
  fileError,
} from "@waitron/ui/src/test-helpers.js";
import { encodeMasterKeyCode } from "@waitron/shared";
import { LitElement, html } from "lit";
import "./first-fiscal-screen.js";
import { renderRecoveryPdf } from "../recovery-pdf.js";
import type { RecoveryDocument } from "../recovery-document.js";
import type { RecoveryKeyEntry } from "./recovery-key.js";

const masterKey = encodeMasterKeyCode(new Uint8Array(16).fill(7));
const masterKeyName = "2026-10-17 · K7QX";
const saved: RecoveryDocument = {
  kind: "waitron-recovery-document",
  version: 1,
  scope: { taxpayerNif: "B12345674", softwareId: "W1", environment: "production" },
  taxpayerName: "Olivo Restauración SL",
  venueName: "Olivo Centro",
  createdAt: "2026-10-17T12:30:00.000Z",
  nodeKey: { nodeId: "node-1", name: "Caja principal", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
};
const selection: import("@waitron/module/src/setup-contract.js").RecoveryKeySelection = {
  taxId: "B12345674",
  environment: "production",
  nodeId: "node-1",
  keyName: masterKeyName,
};
const hosts: HTMLElement[] = [];
afterEach(() => hosts.splice(0).forEach((host) => host.remove()));
async function mount() {
  const host = document.createElement("main");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = document.createElement("vf-recovery-key");
  el.selection = { ...selection };
  host.append(el);
  await el.updateComplete;
  return el;
}
function native(el: LitElement, name: string) {
  const field = el.shadowRoot?.querySelector(`[name="${name}"]`) ?? null;
  expect(field, `recovery offers the ${name} field`).not.toBeNull();
  return field!.shadowRoot!.querySelector<HTMLInputElement>("input")!;
}
function type(el: LitElement, name: string, value: string) {
  const input = native(el, name);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}
function secrets(el: LitElement): (string | undefined)[] {
  const seen: (string | undefined)[] = [];
  el.addEventListener("recovery-key-change", (event) =>
    seen.push((event as CustomEvent<{ secret?: string }>).detail.secret),
  );
  return seen;
}
function keyError(el: LitElement): string {
  return el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
    '[name="printed-recovery-key"]',
  )!.error;
}
function withSymbol(key: string, index: number, symbol: string): string {
  return key.slice(0, index) + symbol + key.slice(index + 1);
}
it("the key field takes the 28-symbol form and refuses the 41-symbol one", async () => {
  const el = await mount();
  const seen = secrets(el);
  type(el, "printed-recovery-key", masterKey.replaceAll(" ", "").toLowerCase());
  await vi.waitFor(() => expect(seen.at(-1)).toBe(masterKey));
  await vi.waitFor(() => expect(native(el, "printed-recovery-key").value).toBe(masterKey));
  expect(keyError(el)).toBe("");
  expect(el.shadowRoot!.querySelector('[name="printed-recovery-check"]')).toBeNull();
  expect(native(el, "printed-recovery-key").type).toBe("password");

  type(el, "printed-recovery-key", "06r9 t4fh m4h3 599j eemm 5d5d abtv 2rsx 6qdq we8m c");
  await vi.waitFor(() =>
    expect(keyError(el)).toBe("Check the key from your recovery pack or older sheet."),
  );
  expect(seen.at(-1)).toBeUndefined();
  expect(seen.filter((secret) => secret !== undefined)).toEqual([masterKey]);

  const changed = withSymbol(masterKey, 0, masterKey[0] === "2" ? "3" : "2");
  type(el, "printed-recovery-key", changed);
  await vi.waitFor(() => expect(keyError(el)).not.toBe(""));
  expect(seen.at(-1)).toBeUndefined();
});
it.each(["O", "0", "I", "1", "L", "o", "i", "l"])(
  "refuses %s, which is not one of the key's symbols",
  async (symbol) => {
    const el = await mount();
    const seen = secrets(el);
    type(el, "printed-recovery-key", withSymbol(masterKey, 5, symbol));
    await vi.waitFor(() => expect(keyError(el)).not.toBe(""));
    expect(native(el, "printed-recovery-key").value.slice(5, 6)).toBe(symbol.toUpperCase());
    expect(seen.every((secret) => secret === undefined)).toBe(true);
  },
);
it("accepts U, which is one of the key's symbols", async () => {
  const withU = Array.from({ length: 256 }, (_, n) =>
    encodeMasterKeyCode(new Uint8Array(16).fill(n)),
  ).find((key) => key.includes("U"))!;
  const el = await mount();
  const seen = secrets(el);
  type(el, "printed-recovery-key", withU.toLowerCase());
  await vi.waitFor(() => expect(seen.at(-1)).toBe(withU));
  expect(keyError(el)).toBe("");
});
async function upload(el: LitElement, bytes: Uint8Array<ArrayBuffer>) {
  const picker = el.shadowRoot!.querySelector("wt-file-input");
  expect(picker, "recovery offers the saved-PDF picker").not.toBeNull();
  const read = vi.spyOn(el as RecoveryKeyEntry, "importFile");
  try {
    chooseFiles(picker!, new File([bytes], "recovery.pdf", { type: "application/pdf" }));
    const pending = read.mock.results.at(-1)?.value;
    if (pending === undefined) throw new Error("The picker did not start reading its PDF");
    await pending;
    await el.updateComplete;
  } finally {
    read.mockRestore();
  }
}
it("choosing a pack PDF fills the key field from the pack's masterKey", async () => {
  const el = await mount();
  const seen = secrets(el);
  await upload(el, await recoveryPack({}));
  await vi.waitFor(() => expect(seen.at(-1)).toBe(masterKey));
  expect(el.shadowRoot!.textContent).toContain("Key loaded");
  expect(native(el, "printed-recovery-key").value).toBe("");
  expect(native(el, "printed-recovery-key").required).toBe(false);
});

// A pack carries no tax id, environment, software id or node id, so only the key name is checked.
it("refuses a pack for another master key name", async () => {
  const el = await mount();
  const seen = secrets(el);
  await upload(el, await recoveryPack({ masterKeyName: "2026-09-02 · ABCD" }));
  await vi.waitFor(() =>
    expect(fileError(el.shadowRoot!.querySelector("wt-file-input")!)?.textContent).toBe(
      "Choose the recovery PDF for this backup's named key.",
    ),
  );
  expect(seen.every((secret) => secret === undefined)).toBe(true);
  expect(el.shadowRoot!.textContent).not.toContain("Key loaded");
});
it.each([
  [
    "a PDF with no attached file",
    async () => {
      const stripped = await PDFDocument.create();
      stripped.addPage();
      return new Uint8Array(await stripped.save());
    },
  ],
  ["the fiscal module's old key PDF", () => renderRecoveryPdf(saved, "en", "Europe/Madrid")],
] as const)("refuses %s as not a recovery pack", async (_, bytes) => {
  const el = await mount();
  const seen = secrets(el);
  await upload(el, await bytes());
  await vi.waitFor(() =>
    expect(fileError(el.shadowRoot!.querySelector("wt-file-input")!)?.textContent).toBe(
      "Choose a valid recovery PDF, or enter the key below.",
    ),
  );
  expect(seen.every((secret) => secret === undefined)).toBe(true);
  expect(native(el, "printed-recovery-key").disabled).toBe(false);
});
it("clears a decoded key immediately when the printed key changes", async () => {
  const el = await mount();
  const fields = { value: masterKey };
  const events: Array<{ secret?: string }> = [];
  el.addEventListener("recovery-key-change", (event) => events.push((event as CustomEvent).detail));
  type(el, "printed-recovery-key", fields.value);
  await vi.waitFor(() => expect(events.at(-1)?.secret).toBe(masterKey));
  type(el, "printed-recovery-key", "BAD");
  expect(events.at(-1)).toEqual({});
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
        '[name="printed-recovery-key"]',
      )!.error,
    ).not.toBe(""),
  );
});
it("clears manual entry on selected-backup change and on removal", async () => {
  const el = await mount();
  const fields = { value: masterKey };
  const events: Array<{ secret?: string }> = [];
  el.addEventListener("recovery-key-change", (event) => events.push((event as CustomEvent).detail));
  type(el, "printed-recovery-key", fields.value);
  await vi.waitFor(() => expect(events.at(-1)?.secret).toBe(masterKey));
  el.selection = { ...selection, keyName: "Earlier key" };
  await el.updateComplete;
  await vi.waitFor(() => expect(native(el, "printed-recovery-key").value).toBe(""));
  expect(events.at(-1)).toEqual({});
  type(el, "printed-recovery-key", fields.value);
  await el.updateComplete;
  el.remove();
  await el.updateComplete;
  await vi.waitFor(() => expect(native(el, "printed-recovery-key").value).toBe(""));
});
it.each(["selection", "remove", "edit"])("ignores an old PDF read after %s", async (fault) => {
  const el = await mount();
  const bytes = await recoveryPack({});
  let release!: (bytes: ArrayBuffer) => void;
  const held = new Promise<ArrayBuffer>((resolve) => {
    release = resolve;
  });
  const file = new File([bytes], "recovery.pdf", { type: "application/pdf" });
  Object.defineProperty(file, "arrayBuffer", { value: () => held });
  const events: Array<{ secret?: string }> = [];
  el.addEventListener("recovery-key-change", (event) => events.push((event as CustomEvent).detail));
  const loading = vi.spyOn(el, "importFile");
  chooseFiles(el.shadowRoot!.querySelector("wt-file-input")!, file);
  const imported = loading.mock.results[0]!.value;
  if (fault === "selection") el.selection = { ...selection, keyName: "Earlier key" };
  if (fault === "remove") el.remove();
  if (fault === "edit") type(el, "printed-recovery-key", "different");
  release(bytes.buffer);
  await held;
  await el.updateComplete;
  await imported;
  expect(events.every((event) => event.secret === undefined)).toBe(true);
  expect(el.shadowRoot!.textContent).not.toContain("Key loaded");
});

it("refuses an oversized PDF before reading its bytes", async () => {
  const el = await mount();
  const file = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.pdf");
  const reading = vi.spyOn(file, "arrayBuffer");
  await el.importFile(file);
  await el.updateComplete;
  expect(fileError(el.shadowRoot!.querySelector("wt-file-input")!)?.textContent).toContain(
    "Choose a valid recovery PDF",
  );
  expect(reading).not.toHaveBeenCalled();
  const status = el.shadowRoot!.querySelector('[role="status"]')!;
  expect(status.textContent).toContain("Choose a valid recovery PDF, or enter the key below.");
  const copy = status.querySelector(".visually-hidden")!;
  const announced = copy.getBoundingClientRect();
  expect(announced.width).toBeLessThanOrEqual(1);
  expect(announced.height).toBeLessThanOrEqual(1);
  expect(getComputedStyle(copy).display).not.toBe("none");
  expect(getComputedStyle(copy).visibility).not.toBe("hidden");
});
it("clears the PDF picker when its backup selection changes", async () => {
  const el = await mount();
  const picker = el.shadowRoot!.querySelector<WtFileInput>("wt-file-input")!;
  await upload(el, await recoveryPack({}));
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Key loaded"));
  expect(picker.files).toHaveLength(1);
  expect(drawnFileName(picker)).toBe("recovery.pdf");
  el.selection = { ...selection, keyName: "Earlier key" };
  await el.updateComplete;
  expect(picker.files).toHaveLength(0);
  expect(drawnFileName(picker)).toBeNull();
});
it("draws the PDF picker in Spanish and reads the chosen file", async () => {
  const el = await mount();
  el.locale = "es";
  await el.updateComplete;
  const picker = el.shadowRoot!.querySelector<WtFileInput>("wt-file-input")!;
  expect(picker.shadowRoot!.textContent).toContain("Elegir archivo");
  expect(picker.shadowRoot!.textContent).not.toContain("Choose");
  expect(fileControl(picker).accept).toBe("application/pdf,.pdf");
  const read = vi.spyOn(el, "importFile");
  chooseFiles(picker, new File(["X".repeat(1_500)], "notes.pdf"));
  await read.mock.results[0]!.value;
  await el.updateComplete;
  expect(drawnFileName(picker)).toBe("notes.pdf");
  expect(picker.shadowRoot!.querySelector(".size")!.textContent).toBe("1,5 kB");
  expect(picker.shadowRoot!.textContent).toContain("Elegir otro archivo");
  const message = "Elige un PDF de recuperación válido, o introduce la clave abajo.";
  expect(fileError(picker)?.textContent).toBe(message);
  const control = fileControl(picker);
  expect(control.getAttribute("aria-invalid")).toBe("true");
  const described = (control.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => picker.shadowRoot!.getElementById(id)?.textContent);
  expect(described).toContain(message);
});

class KeyShell extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<vf-recovery-key .selection=${selection}></vf-recovery-key
      >${this.leave.render({ heading: "Discard?", message: "Unsaved key", keepLabel: "Keep editing", discardLabel: "Discard" })}`;
  }
}
customElements.define("recovery-key-test-shell", KeyShell);
it("tracks invalid manual entry and clears its native secret on Discard", async () => {
  const shell = document.createElement("recovery-key-test-shell") as KeyShell;
  document.body.append(shell);
  hosts.push(shell);
  await shell.updateComplete;
  const el = shell.shadowRoot!.querySelector("vf-recovery-key")!;
  await el.updateComplete;
  type(el, "printed-recovery-key", "invalid-key");
  await el.updateComplete;
  expect(shell.leave.coordinator.isDirty([el])).toBe(true);
  const pending = shell.leave.coordinator.request({
    scopes: [el],
    reason: "navigation",
    proceed() {},
  });
  await shell.updateComplete;
  shell.shadowRoot!.querySelector("wt-unsaved-changes")!.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(await pending).toBe("proceeded");
  await el.updateComplete;
  await vi.waitFor(() => expect(native(el, "printed-recovery-key").value).toBe(""));
  expect(shell.leave.coordinator.isDirty([el])).toBe(false);
});
it("tracks the first native edit immediately after the fields are reattached", async () => {
  const shell = document.createElement("recovery-key-test-shell") as KeyShell;
  document.body.append(shell);
  hosts.push(shell);
  await shell.updateComplete;
  const el = shell.shadowRoot!.querySelector("vf-recovery-key")!;
  await el.updateComplete;
  const parent = el.parentNode!;
  el.remove();
  await el.updateComplete;
  parent.appendChild(el);
  type(el, "printed-recovery-key", "new-draft");
  expect(shell.leave.coordinator.isDirty([el])).toBe(true);
});

it("groups pasted and middle-edited key text while preserving the native selection", async () => {
  const el = await mount();
  const fields = { value: masterKey };
  type(el, "printed-recovery-key", fields.value.replaceAll(" ", "").toLowerCase());
  await el.updateComplete;
  const input = native(el, "printed-recovery-key");
  expect(input.value).toBe(fields.value);
  input.focus();
  input.value = input.value.slice(0, 6) + "x" + input.value.slice(7);
  input.setSelectionRange(7, 7);
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  await el.shadowRoot!.querySelector<LitElement>("wt-input")!.updateComplete;
  expect(input.value.slice(5, 9)).toBe(`${fields.value[5]}X${fields.value.slice(7, 9)}`);
  expect(input.selectionStart).toBe(7);
  expect(input.selectionEnd).toBe(7);
});

it.each([
  ["en", "Check the key from your recovery pack or older sheet."],
  ["es", "Revisa la clave de tu paquete de recuperación o de la hoja antigua."],
] as const)("shows a malformed key refusal once beside the %s field", async (locale, error) => {
  const el = await mount();
  el.locale = locale;
  await el.updateComplete;
  type(el, "printed-recovery-key", "invalid");
  await vi.waitFor(() =>
    expect(native(el, "printed-recovery-key").getAttribute("aria-invalid")).toBe("true"),
  );
  expect(page.getByText(error, { exact: true }).elements()).toHaveLength(1);
});

it.each(["en", "es"] as const)(
  "reads a recovery PDF for backup proof in %s before the backup identity is known",
  async (locale) => {
    const el = await mount();
    el.selection = undefined;
    el.locale = locale;
    await el.updateComplete;
    const secrets: (string | undefined)[] = [];
    el.addEventListener("recovery-key-change", (event) =>
      secrets.push((event as CustomEvent<{ secret?: string }>).detail.secret),
    );
    await upload(el, await recoveryPack({}));
    expect(secrets.at(-1)).toBe(masterKey);
    expect(drawnFileName(el.shadowRoot!.querySelector("wt-file-input")!)).toBe("recovery.pdf");
    expect(
      el
        .shadowRoot!.querySelector("wt-input")!
        .shadowRoot!.querySelector<HTMLInputElement>("input")!.value,
    ).toBe("");
  },
);

async function recoveryPack(
  file: Partial<import("@waitron/recovery-pack").RecoveryPackFile>,
): Promise<Uint8Array<ArrayBuffer>> {
  const { default: monoUrl } = await import("../assets/register-noto-sans-mono.ttf?url");
  const { renderRecoveryPack } = await import("@waitron/recovery-pack");
  const fontUrl = (await import("../assets/register-noto-sans.ttf?url")).default;
  const { recoveryDocumentBytes } = await import("../recovery-document.js");
  const madeAt = "2026-10-17T12:40:00.000Z";
  return renderRecoveryPack({
    locale: "en",
    timeZone: "Europe/Madrid",
    loadFonts: async () => ({
      regular: new Uint8Array(await (await fetch(fontUrl)).arrayBuffer()),
      mono: new Uint8Array(await (await fetch(monoUrl)).arrayBuffer()),
    }),
    pack: { venueName: saved.venueName, madeAt, number: 3 },
    parts: [],
    file: {
      kind: "waitron-recovery-pack",
      version: 2,
      number: 3,
      madeAt,
      bucketCode: null,
      archiveCode: null,
      backupKey: null,
      serverKey: JSON.parse(new TextDecoder().decode(recoveryDocumentBytes(saved))),
      serverKeyName: saved.nodeKey.name,
      serverKeyHeldBy: null,
      masterKey,
      masterKeyName,
      masterKeyHeldBy: null,
      ...file,
    },
  });
}
it.each([
  [
    "en",
    1,
    "This recovery pack does not hold the master key. It is on recovery pack 1: choose that pack, or type the key from it.",
  ],
  [
    "es",
    1,
    "Este paquete de recuperación no tiene la clave maestra. Está en el paquete de recuperación 1: elige ese paquete o introduce su clave.",
  ],
  [
    "en",
    null,
    "This recovery pack does not hold the master key: choose the pack that holds it, or type the key from it.",
  ],
  [
    "es",
    null,
    "Este paquete de recuperación no tiene la clave maestra: elige el paquete que la tiene o introduce su clave.",
  ],
] as const)(
  "says where the master key is when a pack does not hold it (%s, pack %s)",
  async (locale, masterKeyHeldBy, message) => {
    const el = await mount();
    el.locale = locale;
    await el.updateComplete;
    const seen = secrets(el);
    await upload(el, await recoveryPack({ masterKey: null, masterKeyHeldBy }));
    expect(fileError(el.shadowRoot!.querySelector("wt-file-input")!)?.textContent).toBe(message);
    expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain(message);
    expect(seen.every((secret) => secret === undefined)).toBe(true);
    expect(native(el, "printed-recovery-key").disabled).toBe(false);
  },
);
