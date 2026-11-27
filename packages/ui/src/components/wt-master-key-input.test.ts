import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { state } from "lit/decorators.js";
import { decodeMasterKeyCode, encodeMasterKeyCode } from "@waitron/shared";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import { LeaveController } from "../leave-controller.js";
import { setHelpMode } from "../help-mode.js";
import "./wt-help-tooltip.js";
import type {
  MasterKeyChangeDetail,
  MasterKeyInputCopy,
  RecoveryPackReading,
  WtMasterKeyInput,
} from "./wt-master-key-input.js";
import "./wt-master-key-input.js";
import { WtQrScanner } from "./wt-qr-scanner.js";
import { cameraFilming } from "../../test/qr-camera.js";
import { MASTER_KEY_FIELD_WORDS } from "@waitron/recovery-pack/src/i18n/master-key-field.js";

const KEY = "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5";
/** A second whole key, so a key that replaced another shows which one won. */
const OTHER_KEY = encodeMasterKeyCode(new Uint8Array(16).fill(7));
const KEY_NAME = "2026-11-23 · QZJV";
const LIMIT = 16;
const EN: MasterKeyInputCopy = {
  label: "Master key",
  button: "Choose the recovery pack PDF",
  visibility: {
    show: "Show key",
    hide: "Hide key",
    shown: "Key shown",
    hidden: "Key hidden",
  },
  loaded: "Key loaded",
  notPack: "This PDF is not a recovery pack.",
  damaged: "This recovery pack PDF is damaged. Type the key or scan it.",
  damagedNoScan: "This recovery pack PDF is damaged. Type the key.",
  notWhole: "Not a whole master key. Check it against the recovery pack.",
  wrongKey: (name) => `Wrong master key. Use the one dated ${name}.`,
  elsewhere: (heldBy) =>
    heldBy === null ? "Choose the pack that holds it." : `It is on pack ${heldBy}.`,
  scan: "Scan the recovery pack",
  scanning: "Hold the master key's QR code up to the camera.",
  notKeyCode: "That is not the master key's QR code.",
  cameraFailed: "The camera is not available. Type the key or choose the PDF.",
  camera: "Camera",
  stopScan: "Stop scanning",
};
const ES: MasterKeyInputCopy = MASTER_KEY_FIELD_WORDS.es;

/** A refusal as `@waitron/recovery-pack`'s reader throws it: `RecoveryPackFileError` by name, with a reason. */
function packRefusal(reason: string): Error {
  const error = new Error(`Recovery pack file refused: ${reason}`);
  error.name = "RecoveryPackFileError";
  return Object.assign(error, { reason });
}

const reading = (overrides: Partial<RecoveryPackReading> = {}): RecoveryPackReading => ({
  masterKey: KEY,
  masterKeyName: KEY_NAME,
  masterKeyHeldBy: null,
  ...overrides,
});

let filming: { stop: () => void } | undefined;

afterEach(() => {
  cleanup();
  filming?.stop();
  filming = undefined;
  vi.restoreAllMocks();
});

async function field(extra: Partial<WtMasterKeyInput> = {}) {
  const el = (await mount("<wt-master-key-input></wt-master-key-input>")) as WtMasterKeyInput;
  const read = vi.fn<(bytes: Uint8Array) => Promise<RecoveryPackReading>>(async () => reading());
  const loader = vi.fn(async () => read);
  Object.assign(el, {
    copy: EN,
    keyName: KEY_NAME,
    readPack: loader,
    maxPdfBytes: LIMIT,
    ...extra,
  });
  await el.updateComplete;
  const seen: MasterKeyChangeDetail[] = [];
  el.addEventListener("wt-change", (event) =>
    seen.push((event as CustomEvent<MasterKeyChangeDetail>).detail),
  );
  return { el, seen, loader, read };
}

const inner = (el: WtMasterKeyInput) => el.shadowRoot!.querySelector("wt-input")!;
const native = (el: WtMasterKeyInput) => inner(el).shadowRoot!.querySelector("input")!;
const fileControl = (el: WtMasterKeyInput) =>
  el.shadowRoot!.querySelector<HTMLInputElement>('input[type="file"]')!;
const message = (el: WtMasterKeyInput) =>
  inner(el).shadowRoot!.querySelector("[data-error]")?.textContent?.trim();

async function type(el: WtMasterKeyInput, text: string): Promise<void> {
  const input = native(el);
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  await inner(el).updateComplete;
}

async function choose(el: WtMasterKeyInput, file = new File(["%PDF-1.7"], "pack.pdf")) {
  const control = fileControl(el);
  const transfer = new DataTransfer();
  transfer.items.add(file);
  control.files = transfer.files;
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

async function settled(el: WtMasterKeyInput, line: string | undefined): Promise<void> {
  await vi.waitFor(async () => {
    await el.updateComplete;
    await inner(el).updateComplete;
    expect(message(el)).toBe(line);
  });
}

test.each([
  ["printed", KEY],
  ["without dashes or spaces", KEY.replaceAll(" ", "")],
  ["with dashes", KEY.replaceAll(" ", "-")],
  ["in lower case", KEY.toLowerCase()],
])("the field accepts the printed key %s", async (_form, text) => {
  expect(encodeMasterKeyCode(decodeMasterKeyCode(KEY))).toBe(KEY);
  const { el, seen } = await field();
  await type(el, text);
  expect(seen.at(-1)).toEqual({ masterKey: KEY });
  expect(native(el).value).toBe(KEY);
  expect(message(el)).toBeUndefined();
});

test("upper-cases ASCII letters only, so a letter that upper-cases into a symbol is not whole", async () => {
  const withS = Array.from({ length: 256 }, (_, i) =>
    encodeMasterKeyCode(new Uint8Array(16).fill(i)),
  ).find((key) => key.includes("S"))!;
  const { el, seen } = await field();
  await type(el, withS.replace("S", "s"));
  expect(seen.at(-1)).toEqual({ masterKey: withS });
  await type(el, withS.replace("S", "ſ"));
  expect(seen.at(-1)).toStrictEqual({});
  expect(message(el)).toBe(EN.notWhole);
});

test("a wrong check symbol gets the not-whole line and no key", async () => {
  const { el, seen } = await field();
  const last = KEY.at(-1) === "5" ? "6" : "5";
  await type(el, KEY.slice(0, -1) + last);
  expect(seen.at(-1)).toStrictEqual({});
  expect(message(el)).toBe(EN.notWhole);
  expect(native(el).getAttribute("aria-invalid")).toBe("true");
});

test("more than 28 symbols is not whole either", async () => {
  const { el, seen } = await field();
  await type(el, `${KEY}2`);
  expect(seen.at(-1)).toStrictEqual({});
  expect(message(el)).toBe(EN.notWhole);
});

test("a short key shows nothing until the host sets attempted, then the not-whole line", async () => {
  const { el, seen } = await field();
  await type(el, KEY.slice(0, 10));
  expect(seen.at(-1)).toStrictEqual({});
  expect(message(el)).toBeUndefined();
  el.attempted = true;
  await settled(el, EN.notWhole);
  el.attempted = false;
  await settled(el, undefined);
});

test("an empty field shows the host's own line, even once attempted", async () => {
  const { el } = await field({ attempted: true, error: "Enter the selected backup’s master key." });
  await settled(el, "Enter the selected backup’s master key.");
  await type(el, KEY.slice(0, 4));
  expect(message(el)).toBe(EN.notWhole);
});

test("keeps the caret where it was while it regroups the key", async () => {
  const { el } = await field();
  await type(el, KEY.replaceAll(" ", "").toLowerCase());
  const input = native(el);
  expect(input.value).toBe(KEY);
  input.focus();
  input.value = input.value.slice(0, 6) + "x" + input.value.slice(7);
  input.setSelectionRange(7, 7);
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  await inner(el).updateComplete;
  expect(input.value.slice(5, 9)).toBe(`${KEY[5]}X${KEY.slice(7, 9)}`);
  expect(input.selectionStart).toBe(7);
  expect(input.selectionEnd).toBe(7);
});

test("choosing a pack PDF fills the field from the attached file", async () => {
  const { el, seen, read } = await field();
  const bytes = new TextEncoder().encode("%PDF-1.7 pack");
  await choose(el, new File([bytes], "pack.pdf"));
  await vi.waitFor(() => expect(seen.at(-1)).toEqual({ masterKey: KEY }));
  expect(read).toHaveBeenCalledWith(bytes);
  await el.updateComplete;
  expect(native(el).value).toBe(KEY);
  expect(message(el)).toBeUndefined();
});

test("the button opens the hidden PDF chooser, which takes PDFs only", async () => {
  const { el } = await field();
  const control = fileControl(el);
  expect(control.hidden).toBe(true);
  expect(control.accept).toBe("application/pdf,.pdf");
  const opened = vi.spyOn(control, "click").mockImplementation(() => {});
  const clicks = vi.fn();
  host.addEventListener("click", clicks);
  const button = el.shadowRoot!.querySelector("wt-button.choose")!;
  expect(button.textContent?.trim()).toBe(EN.button);
  await userEvent.click(button);
  expect(opened).toHaveBeenCalledOnce();
  expect(clicks).not.toHaveBeenCalled();
});

test("the reader is loaded only when a PDF is chosen", async () => {
  const { el, loader } = await field();
  await type(el, KEY);
  expect(loader).not.toHaveBeenCalled();
  await choose(el);
  await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
});

test("a choice that holds no file reads nothing", async () => {
  const { el, loader } = await field();
  fileControl(el).dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
  expect(loader).not.toHaveBeenCalled();
});

test("a choice that holds no file leaves a typed key, its line and pdfRead alone", async () => {
  const { el, seen } = await field();
  await type(el, KEY);
  const sent = seen.length;
  fileControl(el).dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
  await inner(el).updateComplete;
  expect(el.pdfRead).toBeNull();
  expect(seen).toHaveLength(sent);
  expect(native(el).value).toBe(KEY);
  expect(message(el)).toBeUndefined();
});

test("a PDF larger than maxPdfBytes is refused as not a pack without being read", async () => {
  const { el, seen, loader, read } = await field();
  await type(el, KEY);
  const file = new File([new Uint8Array(LIMIT + 1)], "big.pdf");
  const bytes = vi.spyOn(file, "arrayBuffer");
  await choose(el, file);
  await el.pdfRead;
  expect(message(el)).toBe(EN.notPack);
  expect(bytes).not.toHaveBeenCalled();
  expect(loader).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(seen.at(-1)).toStrictEqual({});
  expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain(EN.notPack);
});

test("a PDF of exactly maxPdfBytes is read", async () => {
  const { el, seen, read } = await field();
  await choose(el, new File([new Uint8Array(LIMIT)], "pack.pdf"));
  await el.pdfRead;
  expect(read).toHaveBeenCalledWith(new Uint8Array(LIMIT));
  expect(seen.at(-1)).toEqual({ masterKey: KEY });
});

test("until maxPdfBytes is set every PDF is refused as not a pack, unread", async () => {
  const { el, loader } = await field({ maxPdfBytes: undefined });
  const file = new File(["%PDF-1.7"], "pack.pdf");
  const bytes = vi.spyOn(file, "arrayBuffer");
  await choose(el, file);
  await el.pdfRead;
  expect(message(el)).toBe(EN.notPack);
  expect(bytes).not.toHaveBeenCalled();
  expect(loader).not.toHaveBeenCalled();
});

test.each(["not_a_pack", "size"])("a PDF that is not a pack says so (%s)", async (reason) => {
  const { el, seen } = await field();
  await type(el, KEY);
  el.readPack = async () => async () => Promise.reject(packRefusal(reason));
  await choose(el);
  await settled(el, EN.notPack);
  expect(seen.at(-1)).toStrictEqual({});
  expect(native(el).value).toBe("");
  expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain(EN.notPack);
});

test.each([
  ["a damaged digest", () => packRefusal("digest")],
  ["any other error", () => new Error("broken")],
  [
    "a refusal's reason without its name",
    () => Object.assign(new Error("x"), { reason: "not_a_pack" }),
  ],
])("a damaged pack says so: %s", async (_case, failure) => {
  const { el, seen } = await field();
  el.readPack = async () => async () => Promise.reject(failure());
  await choose(el);
  await settled(el, EN.damaged);
  expect(seen.at(-1)).toStrictEqual({});
});

test("a loader that fails is a damaged pack too", async () => {
  const { el } = await field({ readPack: () => Promise.reject(new Error("chunk failed")) });
  await choose(el);
  await settled(el, EN.damaged);
});

test("a damaged pack does not offer scanning on a browser with no getUserMedia", async () => {
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
    value: undefined,
    configurable: true,
  });
  try {
    const { el } = await field();
    el.readPack = async () => async () => Promise.reject(new Error("broken"));
    await choose(el);
    await settled(el, EN.damagedNoScan);
    expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain(
      EN.damagedNoScan,
    );
  } finally {
    delete (navigator.mediaDevices as { getUserMedia?: unknown }).getUserMedia;
  }
  expect(typeof navigator.mediaDevices.getUserMedia).toBe("function");
});

test("a pack whose key does not decode is damaged", async () => {
  const { el, seen } = await field();
  el.readPack = async () => async () => reading({ masterKey: "NOT A KEY" });
  await choose(el);
  await settled(el, EN.damaged);
  expect(seen.at(-1)).toStrictEqual({});
});

test.each([
  [2, "It is on pack 2."],
  [null, "Choose the pack that holds it."],
])("a pack without the master key says where it is (held by %s)", async (heldBy, line) => {
  const { el, seen } = await field();
  el.readPack = async () => async () =>
    reading({ masterKey: null, masterKeyName: null, masterKeyHeldBy: heldBy });
  await choose(el);
  await settled(el, line);
  expect(seen.at(-1)).toStrictEqual({});
});

test("a pack for another key gets the wrong-key line, and typing again clears it", async () => {
  const { el, seen } = await field();
  el.readPack = async () => async () => reading({ masterKeyName: "2026-01-02 · AAAA" });
  await choose(el);
  await settled(el, EN.wrongKey(KEY_NAME));
  expect(seen.at(-1)).toStrictEqual({});
  expect(native(el).value).toBe("");
  await type(el, KEY.slice(0, 4));
  expect(message(el)).toBeUndefined();
});

test("with no expected key, any pack's key is taken", async () => {
  const { el, seen } = await field({ keyName: undefined });
  el.readPack = async () => async () => reading({ masterKeyName: "2026-01-02 · AAAA" });
  await choose(el);
  await vi.waitFor(() => expect(seen.at(-1)).toEqual({ masterKey: KEY }));
});

test("a read that finishes after the person typed again is dropped", async () => {
  let finish!: (value: RecoveryPackReading) => void;
  const { el, seen } = await field();
  el.readPack = async () => () => new Promise((resolve) => (finish = resolve));
  await choose(el);
  await vi.waitFor(() => expect(finish).toBeDefined());
  await type(el, KEY.slice(0, 4));
  finish(reading());
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(seen.at(-1)).toStrictEqual({});
  expect(native(el).value).toBe(KEY.slice(0, 4));
});

test("a refusal that arrives after the field was cleared is dropped", async () => {
  let fail!: (error: unknown) => void;
  const { el } = await field();
  el.readPack = async () => () => new Promise((_resolve, reject) => (fail = reject));
  await choose(el);
  await vi.waitFor(() => expect(fail).toBeDefined());
  el.clear();
  fail(packRefusal("not_a_pack"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await inner(el).updateComplete;
  expect(message(el)).toBeUndefined();
});

test("a new expected key clears what was typed", async () => {
  const { el, seen } = await field();
  await type(el, KEY);
  el.keyName = "2026-01-02 · AAAA";
  await el.updateComplete;
  expect(native(el).value).toBe("");
  expect(seen.at(-1)).toStrictEqual({});
});

test.each([
  ["EN", EN],
  ["ES", ES],
])("label Master key, no placeholder, required marked (%s)", async (_locale, copy) => {
  const { el } = await field({ copy, required: true, name: "backup-key" });
  const input = native(el);
  expect(inner(el).label).toBe(copy.label);
  expect(inner(el).required).toBe(true);
  expect(input.required).toBe(true);
  expect(input.name).toBe("backup-key");
  expect(input.type).toBe("password");
  expect(input.autocomplete).toBe("off");
  expect(input.placeholder).toBe("");
  expect(el.hasAttribute("required")).toBe(true);
  expect(el.shadowRoot!.querySelector("wt-button.choose")!.textContent?.trim()).toBe(copy.button);
});

test("disabled reaches the field and its button", async () => {
  const { el } = await field({ disabled: true });
  expect(el.hasAttribute("disabled")).toBe(true);
  expect(inner(el).disabled).toBe(true);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("wt-button.choose")!.disabled,
  ).toBe(true);
  expect(fileControl(el).disabled).toBe(true);
});

test("draws nothing until it has its words", async () => {
  const { el } = await field({ copy: undefined });
  expect(el.shadowRoot!.childElementCount).toBe(0);
});

test("one edit sends the host exactly one wt-change, from the field, bubbling and composed", async () => {
  const el = (await mountInShadowRoot(
    "<wt-master-key-input></wt-master-key-input>",
  )) as WtMasterKeyInput;
  Object.assign(el, { copy: EN, keyName: KEY_NAME });
  await el.updateComplete;
  const changes: Event[] = [];
  const origins: EventTarget[] = [];
  const change = (event: Event) => {
    changes.push(event);
    origins.push(event.composedPath()[0]!);
  };
  document.addEventListener("wt-change", change);
  try {
    await type(el, KEY);
  } finally {
    document.removeEventListener("wt-change", change);
  }
  expect(origins).toStrictEqual([el]);
  expect(changes[0]).toMatchObject({ bubbles: true, composed: true, detail: { masterKey: KEY } });
});

/** True while the page would ask before closing, as it does once a scope reports a change. */
function closingAsks(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

class KeyShell extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<wt-master-key-input .copy=${EN}></wt-master-key-input
      >${this.leave.render({ heading: "Discard?", message: "Unsaved key", keepLabel: "Keep", discardLabel: "Discard" })}`;
  }
}
customElements.define("master-key-input-test-shell", KeyShell);

class ParentedKeyShell extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<wt-master-key-input .copy=${EN} .draftParent=${this}></wt-master-key-input
      >${this.leave.render({ heading: "Discard?", message: "Unsaved key", keepLabel: "Keep", discardLabel: "Discard" })}`;
  }
}
customElements.define("master-key-input-parented-shell", ParentedKeyShell);

test("a partly typed key is a draft of the host's scope", async () => {
  const shell = (await mount(
    "<master-key-input-parented-shell></master-key-input-parented-shell>",
  )) as ParentedKeyShell;
  const el = shell.shadowRoot!.querySelector("wt-master-key-input")!;
  await el.updateComplete;
  expect(shell.leave.coordinator.isDirty([shell])).toBe(false);
  await type(el, "ABCD");
  expect(shell.leave.coordinator.isDirty([shell])).toBe(true);
});

test("typing marks the draft scope changed, and clear() restores it empty", async () => {
  const shell = (await mount(
    "<master-key-input-test-shell></master-key-input-test-shell>",
  )) as KeyShell;
  const el = shell.shadowRoot!.querySelector("wt-master-key-input")!;
  await el.updateComplete;
  expect(shell.leave.coordinator.isDirty([el])).toBe(false);
  const seen: MasterKeyChangeDetail[] = [];
  el.addEventListener("wt-change", (event) =>
    seen.push((event as CustomEvent<MasterKeyChangeDetail>).detail),
  );
  await type(el, "not-a-key");
  expect(shell.leave.coordinator.isDirty([el])).toBe(true);
  expect(closingAsks()).toBe(true);
  el.clear();
  await el.updateComplete;
  await inner(el).updateComplete;
  expect(native(el).value).toBe("");
  expect(seen.at(-1)).toStrictEqual({});
  expect(shell.leave.coordinator.isDirty([el])).toBe(false);
});

test("Discard empties the field", async () => {
  const shell = (await mount(
    "<master-key-input-test-shell></master-key-input-test-shell>",
  )) as KeyShell;
  const el = shell.shadowRoot!.querySelector("wt-master-key-input")!;
  await el.updateComplete;
  await type(el, KEY);
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
  await vi.waitFor(() => expect(native(el).value).toBe(""));
  expect(shell.leave.coordinator.isDirty([el])).toBe(false);
});

test("choosing a PDF marks the draft scope changed", async () => {
  const shell = (await mount(
    "<master-key-input-test-shell></master-key-input-test-shell>",
  )) as KeyShell;
  const el = shell.shadowRoot!.querySelector("wt-master-key-input")!;
  el.readPack = async () => async () => reading();
  await el.updateComplete;
  expect(closingAsks()).toBe(false);
  await choose(el);
  expect(shell.leave.coordinator.isDirty([el])).toBe(true);
  expect(closingAsks()).toBe(true);
});

test("a field taken off the page leaves its scope and forgets its key", async () => {
  const shell = (await mount(
    "<master-key-input-test-shell></master-key-input-test-shell>",
  )) as KeyShell;
  const el = shell.shadowRoot!.querySelector("wt-master-key-input")!;
  await el.updateComplete;
  await type(el, KEY);
  const parent = el.parentNode!;
  el.remove();
  expect(shell.leave.coordinator.isDirty([el])).toBe(false);
  parent.appendChild(el);
  await el.updateComplete;
  await inner(el).updateComplete;
  expect(native(el).value).toBe("");
  await type(el, "AB");
  expect(shell.leave.coordinator.isDirty([el])).toBe(true);
});

test("paints the field, its button and its messages from tokens", async () => {
  const { el } = await field();
  host.style.setProperty("--wt-space-2", "7px");
  host.style.setProperty("--wt-tap-min", "51px");
  host.style.setProperty("--wt-color-danger", "rgb(16, 17, 18)");
  await type(el, `${KEY}2`);
  const choose = getComputedStyle(el.shadowRoot!.querySelector(".choose")!);
  expect(choose.marginTop).toBe("7px");
  expect(getComputedStyle(el.shadowRoot!.querySelector(".controls")!).columnGap).toBe("7px");
  expect(getComputedStyle(el.shadowRoot!.querySelector(".scan")!).marginTop).toBe("7px");
  expect(getComputedStyle(inner(el)).minWidth).toBe("51px");
  expect(getComputedStyle(inner(el).shadowRoot!.querySelector("[data-error]")!).color).toBe(
    "rgb(16, 17, 18)",
  );
  const status = getComputedStyle(el.shadowRoot!.querySelector('[role="status"]')!);
  expect(status.position).toBe("absolute");
  expect(status.width).toBe("1px");
});

test("a field nobody configured is named master-key and is neither required nor disabled", async () => {
  const { el } = await field();
  expect(native(el).name).toBe("master-key");
  expect(el.required).toBe(false);
  expect(native(el).required).toBe(false);
  expect(el.hasAttribute("disabled")).toBe(false);
});

test("clear() before the field is on the page empties it without a scope", () => {
  const el = document.createElement("wt-master-key-input");
  const seen: MasterKeyChangeDetail[] = [];
  el.addEventListener("wt-change", (event) =>
    seen.push((event as CustomEvent<MasterKeyChangeDetail>).detail),
  );
  el.clear();
  expect(seen).toStrictEqual([{}]);
});

test("erasing every symbol leaves the field empty", async () => {
  const { el, seen } = await field();
  await type(el, KEY);
  await type(el, "");
  expect(native(el).value).toBe("");
  expect(seen.at(-1)).toStrictEqual({});
});

test("keeps the caret after a symbol typed at the end of a group", async () => {
  const { el } = await field();
  await type(el, "ABCD EFGH");
  const input = native(el);
  input.focus();
  input.value = "ABCXD EFGH";
  input.setSelectionRange(4, 4);
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  await inner(el).updateComplete;
  expect(input.value).toBe("ABCX DEFG H");
  expect(input.selectionStart).toBe(4);
});

test("once attempted, a whole key still shows no line", async () => {
  const { el } = await field({ attempted: true });
  await type(el, KEY);
  expect(message(el)).toBeUndefined();
});

test("the hidden status says a PDF's line, never a typed key's or the host's", async () => {
  const { el } = await field({ error: "Enter the key." });
  const status = () => el.shadowRoot!.querySelector('[role="status"]')!.textContent!.trim();
  expect(status()).toBe("");
  await type(el, `${KEY}2`);
  expect(message(el)).toBe(EN.notWhole);
  expect(status()).toBe("");
  el.readPack = async () => async () => Promise.reject(packRefusal("digest"));
  await choose(el);
  await settled(el, EN.damaged);
  expect(status()).toBe(EN.damaged);
  el.readPack = async () => async () => reading({ masterKeyName: "2026-01-02 · AAAA" });
  await choose(el);
  await settled(el, EN.wrongKey(KEY_NAME));
  expect(status()).toBe(EN.wrongKey(KEY_NAME));
});

test("a field just drawn says nothing in its hidden status", async () => {
  const el = (await mount("<wt-master-key-input></wt-master-key-input>")) as WtMasterKeyInput;
  el.copy = EN;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent!.trim()).toBe("");
});

test("the hidden status says the key was loaded from a PDF, never the key, until it changes", async () => {
  const { el } = await field();
  const status = () => el.shadowRoot!.querySelector('[role="status"]')!.textContent!.trim();
  await choose(el);
  await el.pdfRead;
  expect(native(el).value).toBe(KEY);
  expect(status()).toBe(EN.loaded);
  expect(el.shadowRoot!.textContent).not.toContain(KEY);
  await type(el, "A");
  expect(status()).toBe("");
  await choose(el);
  await el.pdfRead;
  expect(status()).toBe(EN.loaded);
  el.clear();
  await el.updateComplete;
  expect(status()).toBe("");
});

test("a help-mode badge in the help slot hangs over the key field's top trailing corner", async () => {
  const el = (await mount(
    '<wt-master-key-input><wt-help-tooltip slot="help" mode="help-mode" aria-label="Help: Master key">On the recovery pack.</wt-help-tooltip></wt-master-key-input>',
  )) as WtMasterKeyInput;
  el.copy = EN;
  await el.updateComplete;
  await inner(el).updateComplete;
  const badge = el.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    "wt-help-tooltip",
  )!;
  setHelpMode(true);
  try {
    await badge.updateComplete;
    const button = badge.shadowRoot!.querySelector("button")!.getBoundingClientRect();
    const corner = inner(el).shadowRoot!.querySelector("[part=field]")!.getBoundingClientRect();
    expect(Math.abs(button.left + button.width / 2 - corner.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(button.top + button.height / 2 - corner.top)).toBeLessThanOrEqual(1);
  } finally {
    setHelpMode(false);
  }
});

test("the PDF chooser's own input event stays inside the field", async () => {
  const el = (await mountInShadowRoot(
    "<wt-master-key-input></wt-master-key-input>",
  )) as WtMasterKeyInput;
  el.copy = EN;
  await el.updateComplete;
  const inputs = vi.fn();
  document.addEventListener("input", inputs);
  try {
    fileControl(el).dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  } finally {
    document.removeEventListener("input", inputs);
  }
  expect(inputs).not.toHaveBeenCalled();
});

test("the PDF chooser's own click stays inside the field", async () => {
  const el = (await mountInShadowRoot(
    "<wt-master-key-input></wt-master-key-input>",
  )) as WtMasterKeyInput;
  el.copy = EN;
  await el.updateComplete;
  const clicks = vi.fn();
  document.addEventListener("click", clicks);
  try {
    fileControl(el).dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  } finally {
    document.removeEventListener("click", clicks);
  }
  expect(clicks).not.toHaveBeenCalled();
});

class RefusingHost extends LitElement {
  @state() refusal = "";
  override render() {
    return html`<wt-master-key-input
      .copy=${EN}
      .keyName=${KEY_NAME}
      .error=${this.refusal}
      @wt-change=${() => (this.refusal = "")}
    ></wt-master-key-input>`;
  }
}
customElements.define("master-key-input-test-refusing-host", RefusingHost);

test("a host that sets its refusal as the error and clears it on wt-change shows each refusal", async () => {
  const shell = (await mount(
    "<master-key-input-test-refusing-host></master-key-input-test-refusing-host>",
  )) as RefusingHost;
  const el = shell.shadowRoot!.querySelector("wt-master-key-input")!;
  await el.updateComplete;
  const refused = EN.wrongKey("2026-01-02 · AAAA");
  const typeKey = async (text: string) => {
    await type(el, text);
    await shell.updateComplete;
  };
  const refuse = async () => {
    shell.refusal = refused;
    await shell.updateComplete;
  };
  await typeKey(KEY);
  await refuse();
  await settled(el, refused);
  await typeKey(KEY.slice(0, 8));
  expect(message(el)).toBeUndefined();
  await typeKey(KEY);
  await refuse();
  await settled(el, refused);
});

test("pdfRead is null before any choice and settles once the PDF's line shows", async () => {
  const { el } = await field();
  expect(el.pdfRead).toBeNull();
  el.readPack = async () => async () => Promise.reject(packRefusal("not_a_pack"));
  await choose(el);
  const read = el.pdfRead;
  expect(read).toBeInstanceOf(Promise);
  expect(message(el)).toBeUndefined();
  await read;
  expect(message(el)).toBe(EN.notPack);
});

test("pdfRead settles once a chosen PDF has filled the field", async () => {
  const { el } = await field();
  await choose(el);
  await el.pdfRead;
  expect(native(el).value).toBe(KEY);
  expect(message(el)).toBeUndefined();
});

test("a second choice replaces pdfRead with its own read", async () => {
  let finish!: (value: RecoveryPackReading) => void;
  const { el } = await field();
  const answers = [
    () => new Promise<RecoveryPackReading>((resolve) => (finish = resolve)),
    async () => reading(),
  ];
  el.readPack = async () => () => answers.shift()!();
  await choose(el);
  const first = el.pdfRead;
  await vi.waitFor(() => expect(finish).toBeDefined());
  await choose(el);
  const second = el.pdfRead;
  expect(second).not.toBe(first);
  await second;
  expect(native(el).value).toBe(KEY);
  finish(reading({ masterKeyName: "2026-01-02 · AAAA" }));
  await first;
  expect(el.pdfRead).toBe(second);
  expect(message(el)).toBeUndefined();
});

test("a new key name on an empty field sends no change", async () => {
  const { el, seen } = await field();
  el.keyName = "2026-01-02 · AAAA";
  await el.updateComplete;
  expect(seen).toStrictEqual([]);
});

test("a new key name forgets a chosen PDF and tells the host", async () => {
  const { el, seen } = await field();
  await choose(el);
  await el.pdfRead;
  seen.length = 0;
  el.keyName = "2026-01-02 · AAAA";
  await el.updateComplete;
  expect(native(el).value).toBe("");
  expect(seen).toStrictEqual([{}]);
});

test("pdfRead still resolves when the host takes the words away during a read", async () => {
  let finish!: (value: RecoveryPackReading) => void;
  const { el } = await field();
  el.readPack = async () => () => new Promise((resolve) => (finish = resolve));
  await choose(el);
  const read = el.pdfRead;
  await vi.waitFor(() => expect(finish).toBeDefined());
  el.copy = undefined;
  await el.updateComplete;
  finish(reading());
  await expect(read).resolves.toBeUndefined();
});

test("a new key name after a refused PDF forgets the PDF and tells the host", async () => {
  const { el, seen } = await field();
  el.readPack = async () => async () => Promise.reject(packRefusal("not_a_pack"));
  await choose(el);
  await el.pdfRead;
  expect(message(el)).toBe(EN.notPack);
  seen.length = 0;
  el.keyName = "2026-01-02 · AAAA";
  await el.updateComplete;
  expect(seen).toStrictEqual([{}]);
  await settled(el, undefined);
});

test("the host's line shows while the field has none of its own", async () => {
  const { el } = await field({ keyName: undefined, error: "Host line" });
  expect(message(el)).toBe("Host line");
  await type(el, `${KEY}2`);
  expect(message(el)).toBe(EN.notWhole);
});

test("fill shows a key the host already holds, without telling the host, and typing goes on from it", async () => {
  const { el, seen } = await field();
  el.fill(KEY.replaceAll(" ", "").toLowerCase());
  await el.updateComplete;
  await inner(el).updateComplete;
  expect(native(el).value).toBe(KEY);
  expect(seen).toEqual([]);
  await type(el, OTHER_KEY);
  expect(seen).toEqual([{ masterKey: OTHER_KEY }]);
});

test("fill leaves the field empty for text that is not a whole key", async () => {
  const { el, seen } = await field();
  await type(el, KEY);
  el.fill("not a key");
  await el.updateComplete;
  await inner(el).updateComplete;
  expect(native(el).value).toBe("");
  expect(seen).toEqual([{ masterKey: KEY }]);
});

const visibilityButton = (name: string) => page.getByRole("button", { name, exact: true });

/** A field holding `text`, typed and then shown, with the caret after its last symbol. */
async function shownField(text: string, extra: Partial<WtMasterKeyInput> = {}) {
  const mounted = await field(extra);
  native(mounted.el).focus();
  await userEvent.keyboard(text);
  await visibilityButton(EN.visibility.show).click();
  const input = native(mounted.el);
  expect(input.type).toBe("text");
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  return { ...mounted, input };
}

async function drawn(el: WtMasterKeyInput): Promise<void> {
  await el.updateComplete;
  await inner(el).updateComplete;
}

test.each([
  ["EN", EN, "Show key", "Hide key"],
  ["ES", ES, "Mostrar clave", "Ocultar clave"],
])("the button shows and hides the key, in its own words (%s)", async (_l, copy, show, hide) => {
  const { el, seen } = await field({ copy });
  await type(el, KEY);
  seen.length = 0;
  const input = native(el);
  expect(input.type).toBe("password");
  await visibilityButton(show).click();
  expect(input.type).toBe("text");
  expect(input.value).toBe(KEY);
  const statuses = () =>
    page
      .getByRole("status")
      .elements()
      .map((status) => status.textContent!.trim());
  expect(statuses()).toContain(copy.visibility.shown);
  await visibilityButton(hide).click();
  expect(input.type).toBe("password");
  expect(input.value).toBe(KEY);
  expect(statuses()).toContain(copy.visibility.hidden);
  expect(statuses().join()).not.toContain(KEY.slice(0, 4));
  expect(seen).toStrictEqual([]);
});

test.each([
  ["EN", EN],
  ["ES", MASTER_KEY_FIELD_WORDS.es],
])("a shown key stays shown while typing regroups it (%s)", async (_locale, copy) => {
  const { el } = await field({ copy });
  const input = native(el);
  await visibilityButton(copy.visibility.show).click();
  input.focus();
  for (const [symbol, held] of [
    ["8", "8"],
    ["8", "88"],
    ["d", "88D"],
    ["p", "88DP"],
    ["7", "88DP 7"],
    ["4", "88DP 74"],
  ]) {
    await userEvent.keyboard(symbol!);
    await drawn(el);
    expect(input.value).toBe(held);
    expect(input.type).toBe("text");
    expect(input.selectionStart).toBe(held!.length);
  }
});

test("a shown key stays shown, and keeps the caret, while an edit in its middle regroups it", async () => {
  const { el, input } = await shownField("88DP74BA");
  input.setSelectionRange(2, 2);
  await userEvent.keyboard("x");
  await drawn(el);
  expect(input.value).toBe("88XD P74B A");
  expect(input.type).toBe("text");
  expect(input.selectionStart).toBe(3);
});

test("a dash the field drops leaves a shown key shown and the inner field without it", async () => {
  const { el, input } = await shownField("88DP");
  await userEvent.keyboard("-");
  await drawn(el);
  expect(input.value).toBe("88DP");
  expect(inner(el).value).toBe("88DP");
  expect(input.type).toBe("text");
});

test("a symbol typed over a selection in a shown key stays shown", async () => {
  const { el, input } = await shownField("88DP74BA");
  input.setSelectionRange(0, 6);
  await userEvent.keyboard("q");
  await drawn(el);
  expect(input.value).toBe("Q4BA");
  expect(input.type).toBe("text");
  expect(input.selectionStart).toBe(1);
});

test.each([
  ["another key", KEY.replace("88DP", "QQQQ")],
  ["the same key", KEY],
])("a key loaded from a PDF over a shown key is hidden: %s", async (_case, typed) => {
  const { el, input } = await shownField(typed.replaceAll(" ", ""));
  await choose(el);
  await el.pdfRead;
  expect(input.value).toBe(KEY);
  expect(input.type).toBe("password");
});

test("a key loaded from a PDF into an empty shown field is hidden", async () => {
  const { el } = await field();
  await visibilityButton(EN.visibility.show).click();
  expect(native(el).type).toBe("text");
  await choose(el);
  await el.pdfRead;
  expect(native(el).value).toBe(KEY);
  expect(native(el).type).toBe("password");
});

test.each<[string, (el: WtMasterKeyInput) => void]>([
  ["clear()", (el) => el.clear()],
  ["a new key name", (el) => (el.keyName = "2026-01-02 · AAAA")],
])("%s empties and hides a shown key", async (_case, change) => {
  const { el, input } = await shownField("88DP7");
  change(el);
  await drawn(el);
  expect(input.value).toBe("");
  expect(input.type).toBe("password");
});

/** An empty field its button shows. */
async function shownEmptyField(extra: Partial<WtMasterKeyInput> = {}) {
  const mounted = await field(extra);
  await visibilityButton(EN.visibility.show).click();
  expect(native(mounted.el).type).toBe("text");
  return mounted;
}

async function nextSymbolIsHidden(el: WtMasterKeyInput): Promise<void> {
  expect(native(el).type).toBe("password");
  native(el).focus();
  await userEvent.keyboard("8");
  await drawn(el);
  expect(native(el).value).toBe("8");
  expect(native(el).type).toBe("password");
}

test.each<[string, (el: WtMasterKeyInput) => void]>([
  ["clear()", (el) => el.clear()],
  ["a new key name", (el) => (el.keyName = "2026-01-02 · AAAA")],
  [
    "taking the field off the page and putting it back",
    (el) => {
      const parent = el.parentNode!;
      el.remove();
      parent.appendChild(el);
    },
  ],
])("%s hides an empty shown field, so the next key typed is hidden", async (_case, change) => {
  const { el } = await shownEmptyField();
  change(el);
  await drawn(el);
  await nextSymbolIsHidden(el);
});

test("a PDF refused for its size hides an empty shown field, so the next key typed is hidden", async () => {
  const { el } = await shownEmptyField();
  await choose(el, new File([new Uint8Array(LIMIT + 1)], "big.pdf"));
  await el.pdfRead;
  expect(message(el)).toBe(EN.notPack);
  await nextSymbolIsHidden(el);
});

test("choosing a PDF hides an empty shown field while the PDF is still being read", async () => {
  let finish!: (value: RecoveryPackReading) => void;
  const { el } = await shownEmptyField({
    readPack: async () => () => new Promise((resolve) => (finish = resolve)),
  });
  await choose(el);
  await vi.waitFor(() => expect(finish).toBeDefined());
  await drawn(el);
  expect(native(el).value).toBe("");
  expect(native(el).type).toBe("password");
  finish(reading());
  await el.pdfRead;
});

test("emptying a shown key by hand hides the next one typed", async () => {
  const { el, input } = await shownField("88DP7");
  input.select();
  await userEvent.keyboard("{Backspace}");
  await drawn(el);
  expect(input.type).toBe("password");
  await userEvent.keyboard("8");
  await drawn(el);
  expect(input.type).toBe("password");
});

test("text the field drops whole hides the field, which is then empty", async () => {
  const { el, input } = await shownField("88DP7");
  input.select();
  await userEvent.keyboard("-");
  await drawn(el);
  expect(input.value).toBe("");
  expect(input.type).toBe("password");
});

test("disabling the field hides a shown key and its button", async () => {
  const { el, input } = await shownField("88DP7");
  el.disabled = true;
  await drawn(el);
  expect(input.type).toBe("password");
  await expect.element(visibilityButton(EN.visibility.show)).toBeDisabled();
});

test("a shown key is left out of the browser's spelling check, correction and form memory", async () => {
  const { input } = await shownField("88DP7");
  expect(input.getAttribute("spellcheck")).toBe("false");
  expect(input.getAttribute("autocorrect")).toBe("off");
  expect(input.autocomplete).toBe("off");
});

function film(text: string): MediaStream {
  const camera = cameraFilming(text);
  filming = camera;
  vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(camera.stream);
  return camera.stream;
}

const buttonNamed = (el: WtMasterKeyInput, name: string) =>
  [...el.shadowRoot!.querySelectorAll("wt-button")].find(
    (button) => button.textContent?.trim() === name,
  );
const scanner = (el: WtMasterKeyInput) => el.shadowRoot!.querySelector("wt-qr-scanner");
const scannerLine = (el: WtMasterKeyInput) =>
  scanner(el)?.shadowRoot!.querySelector("[data-scanner-message]")?.textContent?.trim();
const live = (stream: MediaStream) => stream.getTracks().every((t) => t.readyState === "live");
const ended = (stream: MediaStream) => stream.getTracks().every((t) => t.readyState === "ended");
const keyInDom = (el: WtMasterKeyInput) =>
  [el.shadowRoot!, scanner(el)?.shadowRoot].some(
    (root) =>
      root?.textContent?.includes(KEY) || (root as ShadowRoot | undefined)?.innerHTML.includes(KEY),
  );

async function scan(el: WtMasterKeyInput): Promise<void> {
  await userEvent.click(buttonNamed(el, EN.scan)!);
  await el.updateComplete;
}

test("the scanner fills the field from a master key QR code in a still frame", async () => {
  expect(encodeMasterKeyCode(decodeMasterKeyCode(KEY))).toBe(KEY);
  const stream = film(KEY);
  const { el, seen } = await field();
  const leaked = vi.fn();
  host.addEventListener("wt-qr-read", leaked);
  await scan(el);
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
  expect(scannerLine(el)).toBe(EN.scanning);
  expect(scanner(el)!.label).toBe(EN.camera);

  await vi.waitFor(() => expect(seen.at(-1)).toEqual({ masterKey: KEY }), { timeout: 10_000 });
  await el.updateComplete;
  await inner(el).updateComplete;
  expect(native(el).value).toBe(KEY);
  expect(native(el).type).toBe("password");
  expect(ended(stream)).toBe(true);
  expect(scanner(el)).toBeNull();
  expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent!.trim()).toBe(EN.loaded);
  expect(keyInDom(el)).toBe(false);
  expect(leaked).not.toHaveBeenCalled();
  expect(message(el)).toBeUndefined();
});

test("a Cloud QR code is passed over and the camera keeps running", async () => {
  const stream = film("https://cloud.waitron.example/start/abc");
  const { el, seen } = await field();
  await scan(el);
  await vi.waitFor(() => expect(scannerLine(el)).toBe(EN.notKeyCode), { timeout: 10_000 });
  expect(live(stream)).toBe(true);
  expect(scanner(el)).not.toBeNull();
  host.style.setProperty("--wt-color-danger", "rgb(16, 17, 18)");
  const line = scanner(el)!.shadowRoot!.querySelector("[data-scanner-message]")!;
  expect(line.getAttribute("role")).toBe("alert");
  expect(scanner(el)!.shadowRoot!.querySelector("video")!.nextElementSibling).toBe(line);
  expect(getComputedStyle(line).color).toBe("rgb(16, 17, 18)");
  expect(native(el).value).toBe("");
  expect(seen).toEqual([]);
});

test("a QR code holding 28 symbols with a wrong check symbol is passed over", async () => {
  const last = KEY.at(-1) === "5" ? "6" : "5";
  const wrong = KEY.slice(0, -1) + last;
  const stream = film(wrong);
  const { el, seen } = await field();
  await scan(el);
  await vi.waitFor(() => expect(scannerLine(el)).toBe(EN.notKeyCode), { timeout: 10_000 });
  expect(live(stream)).toBe(true);
  expect(native(el).value).toBe("");
  expect(seen).toEqual([]);
  expect(keyInDom(el)).toBe(false);
  expect(el.shadowRoot!.innerHTML).not.toContain(wrong);
});

test("Scan the recovery pack is not shown when the browser has no getUserMedia", async () => {
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
    value: undefined,
    configurable: true,
  });
  try {
    const { el } = await field();
    expect(buttonNamed(el, EN.scan)).toBeUndefined();
    expect(buttonNamed(el, EN.button)).toBeDefined();
  } finally {
    delete (navigator.mediaDevices as { getUserMedia?: unknown }).getUserMedia;
  }
  expect(typeof navigator.mediaDevices.getUserMedia).toBe("function");
});

test("Scan the recovery pack is shown beside the PDF button when the browser can film", async () => {
  const { el } = await field();
  const buttons = [...el.shadowRoot!.querySelectorAll("wt-button")].map((b) =>
    b.textContent?.trim(),
  );
  expect(buttons).toEqual([EN.scan, EN.button]);
});

test("the camera stops when the field leaves the page", async () => {
  const stream = film("hello");
  const { el } = await field();
  await scan(el);
  await expect.poll(() => live(stream)).toBe(true);
  el.remove();
  expect(ended(stream)).toBe(true);
  host.appendChild(el);
  await el.updateComplete;
  expect(scanner(el)).toBeNull();
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
});

test("Stop scanning hides the camera and ends its tracks", async () => {
  const stream = film("hello");
  const { el } = await field();
  await scan(el);
  await expect.poll(() => live(stream)).toBe(true);
  expect(buttonNamed(el, EN.scan)).toBeUndefined();
  await userEvent.click(buttonNamed(el, EN.stopScan)!);
  await el.updateComplete;
  expect(ended(stream)).toBe(true);
  expect(scanner(el)).toBeNull();
  expect(buttonNamed(el, EN.scan)).toBeDefined();
});

test("a refused camera shows the camera-failed line, and Scan tries again", async () => {
  vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
    new DOMException("Permission denied", "NotAllowedError"),
  );
  const { el } = await field();
  const leaked = vi.fn();
  host.addEventListener("wt-qr-unavailable", leaked);
  await scan(el);
  const failed = () =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-camera-failed]")?.textContent?.trim();
  await vi.waitFor(() => expect(failed()).toBe(EN.cameraFailed));
  expect(scanner(el)).toBeNull();
  expect(leaked).not.toHaveBeenCalled();
  expect(announced(el)).toBe(EN.cameraFailed);
  await scan(el);
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
  await type(el, "AB");
  await vi.waitFor(() => expect(failed()).toBeUndefined());
});

test("disabling the field while it scans stops the camera", async () => {
  const stream = film("hello");
  const { el } = await field();
  await scan(el);
  await expect.poll(() => live(stream)).toBe(true);
  el.disabled = true;
  await el.updateComplete;
  expect(ended(stream)).toBe(true);
  expect(scanner(el)).toBeNull();
  expect(buttonNamed(el, EN.scan)!.disabled).toBe(true);
});

test("a scanned key replaces a PDF still being read", async () => {
  film(KEY);
  let answer!: (reading: RecoveryPackReading) => void;
  const { el, seen } = await field({
    readPack: async () => () => new Promise((resolve) => (answer = resolve)),
  });
  await choose(el);
  await scan(el);
  await vi.waitFor(() => expect(seen.at(-1)).toEqual({ masterKey: KEY }), { timeout: 10_000 });
  const count = seen.length;
  answer(reading({ masterKey: OTHER_KEY }));
  await el.pdfRead;
  await el.updateComplete;
  expect(seen).toHaveLength(count);
  expect(message(el)).toBeUndefined();
  expect(native(el).value).toBe(KEY);
  expect(announced(el)).toBe(EN.loaded);
});

test("a PDF that fills the field while it scans stops the camera, so no later code replaces it", async () => {
  const stream = film("https://cloud.waitron.example/start/abc");
  let answer!: (reading: RecoveryPackReading) => void;
  const { el, seen } = await field({
    readPack: async () => () => new Promise((resolve) => (answer = resolve)),
  });
  await choose(el);
  await scan(el);
  await vi.waitFor(() => expect(scannerLine(el)).toBe(EN.notKeyCode), { timeout: 10_000 });

  answer(reading({ masterKey: OTHER_KEY }));
  await el.pdfRead;
  await el.updateComplete;

  expect(seen.at(-1)).toEqual({ masterKey: OTHER_KEY });
  expect(native(el).value).toBe(OTHER_KEY);
  expect(ended(stream)).toBe(true);
  expect(scanner(el)).toBeNull();
  expect(buttonNamed(el, EN.scan)).toBeDefined();
  expect(announced(el)).toBe(EN.loaded);
});

test("the scan control and its lines in Spanish", async () => {
  // The words themselves are pinned in `@waitron/recovery-pack`'s master-key-field test.
  for (const word of [ES.scan, ES.scanning, ES.notKeyCode, ES.stopScan, ES.camera])
    expect(Object.values(EN)).not.toContain(word);
  const stream = film("https://cloud.waitron.example/start/abc");
  const { el } = await field({ copy: ES });
  await userEvent.click(buttonNamed(el, ES.scan)!);
  await el.updateComplete;
  expect(scannerLine(el)).toBe(ES.scanning);
  expect(scanner(el)!.label).toBe(ES.camera);
  expect(buttonNamed(el, ES.stopScan)).toBeDefined();
  await vi.waitFor(() => expect(scannerLine(el)).toBe(ES.notKeyCode), { timeout: 10_000 });
  expect(live(stream)).toBe(true);
});

function deepActive(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

const scanControl = (el: WtMasterKeyInput) =>
  el.shadowRoot!.querySelector("wt-button.scan")!.shadowRoot!.querySelector("button")!;

test("focus stays on the scan button when Scan, Stop scanning and a read key change it", async () => {
  film(KEY);
  const { el, seen } = await field();
  const control = scanControl(el);
  control.focus();
  expect(deepActive()).toBe(control);

  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(scanner(el)).not.toBeNull();
  expect(deepActive()).toBe(control);
  expect(buttonNamed(el, EN.stopScan)?.shadowRoot!.querySelector("button")).toBe(control);

  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(scanner(el)).toBeNull();
  expect(buttonNamed(el, EN.scan)).toBeDefined();
  expect(deepActive()).toBe(control);

  // The first camera's tracks ended at Stop scanning.
  filming!.stop();
  const stream = film(KEY);
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(seen.at(-1)).toEqual({ masterKey: KEY }), { timeout: 10_000 });
  await el.updateComplete;
  expect(ended(stream)).toBe(true);
  expect(buttonNamed(el, EN.scan)).toBeDefined();
  expect(deepActive()).toBe(control);
});

const announced = (el: WtMasterKeyInput) =>
  el.shadowRoot!.querySelector(".visually-hidden[role='status']")!.textContent!.trim();

test("the camera stops when a chosen PDF fills the field, and a key seen later changes nothing", async () => {
  const stream = film(KEY);
  const { el, seen } = await field({
    readPack: async () => async () => reading({ masterKey: OTHER_KEY }),
  });
  await scan(el);
  await expect.poll(() => live(stream)).toBe(true);
  await choose(el);
  await el.pdfRead;
  await el.updateComplete;
  expect(scanner(el)).toBeNull();
  expect(ended(stream)).toBe(true);
  expect(seen.at(-1)).toEqual({ masterKey: OTHER_KEY });
  expect(native(el).value).toBe(OTHER_KEY);
  const count = seen.length;
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(seen).toHaveLength(count);
  expect(native(el).value).toBe(OTHER_KEY);
});

test.each([
  [
    "typing",
    async (el: WtMasterKeyInput) => {
      await type(el, "88DP");
    },
  ],
  [
    "clear()",
    async (el: WtMasterKeyInput) => {
      el.clear();
      await el.updateComplete;
    },
  ],
  [
    "a new key name",
    async (el: WtMasterKeyInput) => {
      el.keyName = "2026-01-02 · AAAA";
      await el.updateComplete;
    },
  ],
])("%s stops the camera", async (_how, change) => {
  const stream = film("hello");
  const { el } = await field();
  await scan(el);
  await expect.poll(() => live(stream)).toBe(true);
  await change(el);
  expect(scanner(el)).toBeNull();
  expect(ended(stream)).toBe(true);
  expect(buttonNamed(el, EN.scan)).toBeDefined();
});

test("a script click on Scan while the field is disabled asks for no camera", async () => {
  film("hello");
  const { el } = await field({ disabled: true });
  (buttonNamed(el, EN.scan) as HTMLElement).click();
  await el.updateComplete;
  expect(scanner(el)).toBeNull();
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

test("a camera that does not start is said through the field's hidden status line", async () => {
  vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
    new DOMException("Permission denied", "NotAllowedError"),
  );
  const { el } = await field();
  await scan(el);
  await vi.waitFor(() => expect(announced(el)).toBe(EN.cameraFailed));
  const visible = el.shadowRoot!.querySelector("[data-camera-failed]")!;
  expect(visible.textContent!.trim()).toBe(EN.cameraFailed);
  expect(visible.getAttribute("role")).toBeNull();
});

const failedLine = (el: WtMasterKeyInput) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-camera-failed]")?.textContent?.trim();

test("a camera whose picture will not play shows the camera-failed line and offers Scan again", async () => {
  const stream = film("hello");
  vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(
    new DOMException("The picture would not play", "NotAllowedError"),
  );
  const { el } = await field();
  await scan(el);

  await vi.waitFor(() => expect(failedLine(el)).toBe(EN.cameraFailed));
  expect(ended(stream)).toBe(true);
  expect(scanner(el)).toBeNull();
  expect(buttonNamed(el, EN.scan)).toBeDefined();
  expect(buttonNamed(el, EN.stopScan)).toBeUndefined();
});

test("a camera that stops by itself while scanning shows the camera-failed line and offers Scan again", async () => {
  const stream = film("https://cloud.waitron.example/start/abc");
  const { el } = await field();
  await scan(el);
  await vi.waitFor(() => expect(scannerLine(el)).toBe(EN.notKeyCode), { timeout: 10_000 });

  stream.getVideoTracks()[0]!.dispatchEvent(new Event("ended"));

  await vi.waitFor(() => expect(failedLine(el)).toBe(EN.cameraFailed));
  expect(ended(stream)).toBe(true);
  expect(scanner(el)).toBeNull();
  expect(buttonNamed(el, EN.scan)).toBeDefined();
  expect(announced(el)).toBe(EN.cameraFailed);
});

test("a kept key is stopped through the scanner's own stop() while it is still on the page", async () => {
  film(KEY);
  const stop = WtQrScanner.prototype.stop;
  const onPage: boolean[] = [];
  vi.spyOn(WtQrScanner.prototype, "stop").mockImplementation(function (this: WtQrScanner) {
    onPage.push(this.isConnected);
    stop.call(this);
  });
  const { el, seen } = await field();
  await scan(el);
  await vi.waitFor(() => expect(seen.at(-1)).toEqual({ masterKey: KEY }), { timeout: 10_000 });
  expect(onPage[0]).toBe(true);
});

test.each([
  ["a line separator", "\u2028", true],
  ["a paragraph separator", "\u2029", true],
  ["a space", " ", true],
  ["a no-break space", "\u00a0", false],
])("typing and scanning agree on a key split by %s", async (_name, separator, whole) => {
  const text = KEY.replaceAll(" ", "").replace(/(.{4})(?!$)/g, `$1${separator}`);
  const typed = await field();
  await type(typed.el, text);
  expect(typed.seen.at(-1)).toEqual(whole ? { masterKey: KEY } : {});
  cleanup();

  film("hello");
  const scanned = await field();
  await scan(scanned.el);
  scanner(scanned.el)!.dispatchEvent(
    new CustomEvent("wt-qr-read", { detail: { text }, bubbles: true, composed: true }),
  );
  await scanned.el.updateComplete;
  expect(scanned.seen.at(-1)).toEqual(whole ? { masterKey: KEY } : undefined);
});

test.each([EN.scan, EN.stopScan])("a click on %s stays inside the field", async (name) => {
  film("hello");
  const { el } = await field();
  if (name === EN.stopScan) await scan(el);
  const clicks = vi.fn();
  host.addEventListener("click", clicks);
  await userEvent.click(buttonNamed(el, name)!);
  expect(clicks).not.toHaveBeenCalled();
});

test("the camera and its failed line paint from tokens", async () => {
  film("hello");
  const { el } = await field();
  host.style.setProperty("--wt-space-2", "7px");
  host.style.setProperty("--wt-color-text", "rgb(40, 50, 60)");
  await scan(el);
  expect(getComputedStyle(scanner(el)!).marginTop).toBe("7px");
  scanner(el)!.dispatchEvent(
    new CustomEvent("wt-qr-unavailable", {
      detail: { reason: "failed" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  const failed = getComputedStyle(el.shadowRoot!.querySelector("[data-camera-failed]")!);
  expect(failed.marginTop).toBe("7px");
  expect(failed.marginBottom).toBe("0px");
  expect(failed.color).toBe("rgb(40, 50, 60)");
});
