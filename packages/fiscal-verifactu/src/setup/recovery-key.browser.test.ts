import { PDFDocument } from "pdf-lib";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { applyTokens, LeaveController } from "@waitron/ui";
import { LitElement, html } from "lit";
import "./first-fiscal-screen.js";
import { renderRecoveryPdf } from "../recovery-pdf.js";
import { openRecoveryPdf } from "../recovery-reader.js";
import type { RecoveryDocument } from "../recovery-document.js";

const saved: RecoveryDocument = {
  kind: "waitron-recovery-document",
  installationCodes: ["06RB"],
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
  keyName: "Caja principal",
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
async function printed() {
  const bytes = await renderRecoveryPdf(saved, "en", "Europe/Madrid");
  const task = openRecoveryPdf(bytes);
  try {
    const pdf = await task.promise;
    const text = (await (await pdf.getPage(1)).getTextContent()).items
      .map((i) => ("str" in i ? i.str : ""))
      .join(" ");
    return { value: text.match(/Key: ([0-9A-Z ]{51})/)![1]!.trim() };
  } finally {
    await task.destroy();
  }
}
it("decodes rendered grouped, lowercase and look-alike fields without changing the secret", async () => {
  const el = await mount();
  const events: Array<{ secret?: string }> = [];
  el.addEventListener("recovery-key-change", (event) => events.push((event as CustomEvent).detail));
  const fields = await printed();
  type(
    el,
    "printed-recovery-key",
    fields.value.toLowerCase().replaceAll("0", "o").replaceAll("1", "l"),
  );
  await vi.waitFor(() =>
    expect(events.at(-1)).toEqual({ secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" }),
  );
  expect(el.shadowRoot!.querySelector('[name="printed-recovery-check"]')).toBeNull();
  expect(native(el, "printed-recovery-key").type).toBe("password");
  expect(el.outerHTML).not.toContain(saved.nodeKey.secret);
  expect(el.shadowRoot!.textContent).not.toContain(saved.nodeKey.secret);
});
function upload(el: LitElement, bytes: Uint8Array<ArrayBuffer>) {
  const picker = el.shadowRoot!.querySelector<HTMLInputElement>('input[type="file"]');
  expect(picker, "recovery offers the saved-PDF picker").not.toBeNull();
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], "recovery.pdf", { type: "application/pdf" }));
  picker!.files = transfer.files;
  picker!.dispatchEvent(new Event("change"));
}
it("imports the saved key-only PDF for the matching selected backup", async () => {
  const el = await mount();
  const events: Array<{ secret?: string }> = [];
  el.addEventListener("recovery-key-change", (event) => events.push((event as CustomEvent).detail));
  upload(el, await renderRecoveryPdf(saved, "es", "Europe/Madrid"));
  await vi.waitFor(() =>
    expect(events.at(-1)).toEqual({ secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" }),
  );
  expect(el.shadowRoot!.textContent).toContain("Key loaded");
});

it.each(["taxpayer", "environment", "software", "node", "name"])(
  "refuses a PDF for another %s",
  async (fault) => {
    const el = await mount();
    const events: Array<{ secret?: string }> = [];
    el.addEventListener("recovery-key-change", (event) =>
      events.push((event as CustomEvent).detail),
    );
    const wrong = structuredClone(saved);
    if (fault === "taxpayer") wrong.scope = { ...wrong.scope, taxpayerNif: "B87654321" };
    if (fault === "environment") wrong.scope = { ...wrong.scope, environment: "preproduction" };
    if (fault === "software") wrong.scope = { ...wrong.scope, softwareId: "W2" };
    if (fault === "node") wrong.nodeKey = { ...wrong.nodeKey, nodeId: "node-2" };
    if (fault === "name") wrong.nodeKey = { ...wrong.nodeKey, name: "Earlier key" };
    upload(el, await renderRecoveryPdf(wrong, "en", "Europe/Madrid"));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("#pdf-error")!.textContent).toContain(
        "this backup's named key",
      ),
    );
    expect(events.every((event) => event.secret === undefined)).toBe(true);
  },
);
it("offers manual fields when a printed PDF has no attachment", async () => {
  const el = await mount();
  const stripped = await PDFDocument.create();
  stripped.addPage();
  upload(el, new Uint8Array(await stripped.save()));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("#pdf-error")!.textContent).toBe(
      "Enter the key from the sheet below.",
    ),
  );
  expect(native(el, "printed-recovery-key").disabled).toBe(false);
});
it("clears a decoded key immediately when the printed key changes", async () => {
  const el = await mount();
  const fields = await printed();
  const events: Array<{ secret?: string }> = [];
  el.addEventListener("recovery-key-change", (event) => events.push((event as CustomEvent).detail));
  type(el, "printed-recovery-key", fields.value);
  await vi.waitFor(() => expect(events.at(-1)?.secret).toBe(saved.nodeKey.secret));
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
  const fields = await printed();
  const events: Array<{ secret?: string }> = [];
  el.addEventListener("recovery-key-change", (event) => events.push((event as CustomEvent).detail));
  type(el, "printed-recovery-key", fields.value);
  await vi.waitFor(() => expect(events.at(-1)?.secret).toBe(saved.nodeKey.secret));
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
  const bytes = await renderRecoveryPdf(saved, "en", "Europe/Madrid");
  let release!: (bytes: ArrayBuffer) => void;
  const held = new Promise<ArrayBuffer>((resolve) => {
    release = resolve;
  });
  const file = new File([bytes], "recovery.pdf", { type: "application/pdf" });
  Object.defineProperty(file, "arrayBuffer", { value: () => held });
  const events: Array<{ secret?: string }> = [];
  el.addEventListener("recovery-key-change", (event) => events.push((event as CustomEvent).detail));
  const picker = el.shadowRoot!.querySelector<HTMLInputElement>('input[type="file"]')!;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  picker.files = transfer.files;
  const loading = vi.spyOn(el, "importFile");
  picker.dispatchEvent(new Event("change"));
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
  expect(el.shadowRoot!.querySelector("#pdf-error")!.textContent).toContain(
    "Choose a valid recovery PDF",
  );
  expect(reading).not.toHaveBeenCalled();
});
it("clears the native PDF picker when its backup selection changes", async () => {
  const el = await mount();
  const picker = el.shadowRoot!.querySelector<HTMLInputElement>('input[type="file"]')!;
  upload(el, await renderRecoveryPdf(saved, "en", "Europe/Madrid"));
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Key loaded"));
  expect(picker.files).toHaveLength(1);
  el.selection = { ...selection, keyName: "Earlier key" };
  await el.updateComplete;
  expect(picker.files).toHaveLength(0);
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
  const fields = await printed();
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
  expect(input.value.slice(5, 9)).toBe("TXFH");
  expect(input.selectionStart).toBe(7);
  expect(input.selectionEnd).toBe(7);
});

it.each([
  ["en", "Check the key from your recovery sheet."],
  ["es", "Revisa la clave de tu hoja de recuperación."],
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
