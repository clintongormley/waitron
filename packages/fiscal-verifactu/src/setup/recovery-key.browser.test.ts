import { PDFDocument } from "pdf-lib";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { applyTokens, LeaveController } from "@waitron/ui";
import { LitElement, html } from "lit";
import "./first-fiscal-screen.js";
import { renderRecoveryPdf } from "../recovery-pdf.js";
import { openRecoveryPdf } from "../recovery-reader.js";
import type { RecoveryDocument } from "../recovery-document.js";
import type { RecoveryKeyEntry } from "./recovery-key.js";

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
async function upload(el: LitElement, bytes: Uint8Array<ArrayBuffer>) {
  const picker = el.shadowRoot!.querySelector<HTMLInputElement>('input[type="file"]');
  expect(picker, "recovery offers the saved-PDF picker").not.toBeNull();
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], "recovery.pdf", { type: "application/pdf" }));
  picker!.files = transfer.files;
  const read = vi.spyOn(el as RecoveryKeyEntry, "importFile");
  try {
    picker!.dispatchEvent(new Event("change"));
    const pending = read.mock.results.at(-1)?.value;
    if (pending === undefined) throw new Error("The picker did not start reading its PDF");
    await pending;
    await el.updateComplete;
  } finally {
    read.mockRestore();
  }
}
it("imports the saved key-only PDF for the matching selected backup", async () => {
  const el = await mount();
  const events: Array<{ secret?: string }> = [];
  el.addEventListener("recovery-key-change", (event) => events.push((event as CustomEvent).detail));
  await upload(el, await renderRecoveryPdf(saved, "es", "Europe/Madrid"));
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
    await upload(el, await renderRecoveryPdf(wrong, "en", "Europe/Madrid"));
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
  await upload(el, new Uint8Array(await stripped.save()));
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
  await upload(el, await renderRecoveryPdf(saved, "en", "Europe/Madrid"));
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
    await upload(el, await renderRecoveryPdf(saved, locale, "Europe/Madrid"));
    expect(secrets.at(-1)).toBe("AbCdEfGhIjKlMnOpQrStUvWxYz012345");
    expect(
      el.shadowRoot!.querySelector<HTMLInputElement>("input[type=file]")!.files!.item(0)!.name,
    ).toBe("recovery.pdf");
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
  const { renderRecoveryPack } = await import("@waitron/recovery-pack");
  const fontUrl = (await import("../assets/register-noto-sans.ttf?url")).default;
  const { recoveryDocumentBytes } = await import("../recovery-document.js");
  const madeAt = "2026-10-17T12:40:00.000Z";
  return renderRecoveryPack({
    locale: "en",
    timeZone: "Europe/Madrid",
    loadFont: async () => new Uint8Array(await (await fetch(fontUrl)).arrayBuffer()),
    cover: {
      legalName: saved.taxpayerName,
      taxId: saved.scope.taxpayerNif,
      venueName: saved.venueName,
      madeAt,
      madeBy: null,
      number: 3,
    },
    parts: [],
    file: {
      kind: "waitron-recovery-pack",
      version: 1,
      number: 3,
      madeAt,
      bucketCode: null,
      archiveCode: null,
      backupKey: null,
      serverKey: JSON.parse(new TextDecoder().decode(recoveryDocumentBytes(saved))),
      serverKeyName: saved.nodeKey.name,
      serverKeyHeldBy: null,
      ...file,
    },
  });
}
it("loads the server key from a recovery pack that holds it", async () => {
  const el = await mount();
  const secrets: (string | undefined)[] = [];
  el.addEventListener("recovery-key-change", (event) =>
    secrets.push((event as CustomEvent<{ secret?: string }>).detail.secret),
  );
  await upload(el, await recoveryPack({}));
  expect(secrets.at(-1)).toBe("AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  expect(el.shadowRoot!.textContent).toContain("Key loaded");
});
it.each([
  [
    "en",
    { number: 1, madeOn: "2026-09-02", received: true },
    "Caja principal",
    "This recovery pack does not hold the server key. It is on recovery pack 1, made on 2 September 2026: choose that pack, or type the key from it.",
  ],
  [
    "es",
    { number: 1, madeOn: "2026-09-02", received: true },
    "Caja principal",
    "Este paquete de recuperación no tiene la clave del servidor. Está en el paquete de recuperación 1, hecho el 2 de septiembre de 2026: elige ese paquete o introduce su clave.",
  ],
  [
    "en",
    { number: 2, madeOn: "2026-09-12", received: false },
    "Caja principal",
    "This recovery pack does not hold the server key. It is on recovery pack 2, made on 12 September 2026: choose that pack, or type the key from it. That pack never reached a browser when it was made: if you do not have it, the key cannot be read from any pack.",
  ],
  [
    "es",
    { number: 2, madeOn: "2026-09-12", received: false },
    "Caja principal",
    "Este paquete de recuperación no tiene la clave del servidor. Está en el paquete de recuperación 2, hecho el 12 de septiembre de 2026: elige ese paquete o introduce su clave. Ese paquete nunca llegó a un navegador cuando se hizo: si no lo tienes, la clave no se puede leer de ningún paquete.",
  ],
  [
    "en",
    null,
    "Caja principal",
    "This recovery pack does not hold the server key: choose the pack or sheet whose key name is Caja principal.",
  ],
  [
    "es",
    null,
    "Caja principal",
    "Este paquete de recuperación no tiene la clave del servidor: elige el paquete o la hoja cuyo nombre de clave es Caja principal.",
  ],
  [
    "en",
    null,
    null,
    "This recovery pack does not hold the server key: choose the pack or sheet that holds it, or type the key from it.",
  ],
  [
    "es",
    null,
    null,
    "Este paquete de recuperación no tiene la clave del servidor: elige el paquete o la hoja que la tiene, o introduce su clave.",
  ],
] as const)(
  "says where the key is when a pack does not hold it (%s, %o, %s)",
  async (locale, serverKeyHeldBy, serverKeyName, message) => {
    const el = await mount();
    el.locale = locale;
    await el.updateComplete;
    const secrets: (string | undefined)[] = [];
    el.addEventListener("recovery-key-change", (event) =>
      secrets.push((event as CustomEvent<{ secret?: string }>).detail.secret),
    );
    await upload(el, await recoveryPack({ serverKey: null, serverKeyHeldBy, serverKeyName }));
    expect(el.shadowRoot!.querySelector("#pdf-error")!.textContent).toBe(message);
    expect(secrets.every((secret) => secret === undefined)).toBe(true);
    expect(native(el, "printed-recovery-key").disabled).toBe(false);
  },
);
