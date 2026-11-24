import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { state } from "lit/decorators.js";
import { decodeMasterKeyCode, encodeMasterKeyCode } from "@waitron/shared";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import { LeaveController } from "../leave-controller.js";
import type {
  MasterKeyChangeDetail,
  MasterKeyInputCopy,
  RecoveryPackReading,
  WtMasterKeyInput,
} from "./wt-master-key-input.js";
import "./wt-master-key-input.js";
import { MASTER_KEY_FIELD_WORDS } from "@waitron/recovery-pack/src/i18n/master-key-field.js";

const KEY = "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5";
const KEY_NAME = "2026-11-23 · QZJV";
const LIMIT = 16;
const EN: MasterKeyInputCopy = {
  label: "Master key",
  button: "Choose the recovery pack PDF",
  notPack: "This PDF is not a recovery pack.",
  damaged: "This recovery pack PDF is damaged. Type the key.",
  notWhole: "Not a whole master key. Check it against the recovery pack.",
  wrongKey: (name) => `Wrong master key. Use the one dated ${name}.`,
  elsewhere: (heldBy) =>
    heldBy === null ? "Choose the pack that holds it." : `It is on pack ${heldBy}.`,
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

afterEach(() => {
  cleanup();
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
  const button = el.shadowRoot!.querySelector("wt-button")!;
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
  expect(el.shadowRoot!.querySelector("wt-button")!.textContent?.trim()).toBe(copy.button);
});

test("disabled reaches the field and its button", async () => {
  const { el } = await field({ disabled: true });
  expect(el.hasAttribute("disabled")).toBe(true);
  expect(inner(el).disabled).toBe(true);
  expect(el.shadowRoot!.querySelector("wt-button")!.disabled).toBe(true);
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
