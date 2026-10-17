import { afterEach, expect, test, vi } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import "../index.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
type Field = HTMLElement & {
  updateComplete: Promise<unknown>;
  files: File[];
  multiple: boolean;
  disabled: boolean;
  error: string;
};
const photo = (name = "patatas-bravas.png") => new File(["photo"], name, { type: "image/png" });
async function setup() {
  const el = (await mount(
    '<wt-file-input name="photo" label="Photo" required hint="JPEG, PNG or WebP"></wt-file-input>',
  )) as Field;
  expect(el.shadowRoot?.querySelector("input[type=file]")).toBeInstanceOf(HTMLInputElement);
  return el;
}
const input = (el: Field) => el.shadowRoot!.querySelector<HTMLInputElement>("input")!;
function data(files: File[]) {
  const d = new DataTransfer();
  files.forEach((f) => d.items.add(f));
  return d;
}
function choose(el: Field, files: File[]) {
  input(el).files = data(files).files;
  input(el).dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}
function drag(el: Field, type: string, files: File[]) {
  const e = new DragEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    dataTransfer: data(files),
  });
  input(el).dispatchEvent(e);
  return e;
}

test("chooser emits one composed file change, consumes the native event, and permits reselection", async () => {
  const el = await setup();
  const f = photo();
  const changes = vi.fn();
  const native = vi.fn();
  host.addEventListener("wt-change", changes);
  host.addEventListener("change", native);
  choose(el, [f]);
  await el.updateComplete;
  expect(changes).toHaveBeenCalledTimes(1);
  const e = changes.mock.calls[0]![0];
  expect(e.detail).toEqual({ files: [f] });
  expect(e.bubbles).toBe(true);
  expect(e.composed).toBe(true);
  expect(native).not.toHaveBeenCalled();
  const nativeInput = vi.fn();
  host.addEventListener("input", nativeInput);
  input(el).dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  expect(nativeInput).not.toHaveBeenCalled();
  expect(input(el).value).toBe("");
  choose(el, [f]);
  expect(changes).toHaveBeenCalledTimes(2);
  input(el).dispatchEvent(new Event("cancel", { bubbles: true }));
  expect(changes).toHaveBeenCalledTimes(2);
});
test.each([false, true])(
  "drop keeps the permitted number of files (multiple=%s) and prevents navigation",
  async (multiple) => {
    const el = await setup();
    el.multiple = multiple;
    await el.updateComplete;
    const files = [photo(), photo("second.png")];
    const changed = vi.fn();
    const escaped = vi.fn();
    host.addEventListener("wt-change", changed);
    host.addEventListener("drop", escaped);
    const e = drag(el, "drop", files);
    await el.updateComplete;
    expect(e.defaultPrevented).toBe(true);
    expect(escaped).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledOnce();
    expect(changed.mock.calls[0]![0].detail.files).toEqual(multiple ? files : files.slice(0, 1));
    expect(input(el).multiple).toBe(multiple);
  },
);
test("multiple chooser keeps every selected file and empty selection clears without inventing a file", async () => {
  const el = await setup();
  el.multiple = true;
  await el.updateComplete;
  const files = [photo(), photo("second.png")];
  choose(el, files);
  await el.updateComplete;
  expect(el.files).toEqual(files);
  expect(el.shadowRoot!.textContent).toContain("second.png");
  choose(el, []);
  await el.updateComplete;
  expect(el.files).toEqual([]);
});
test("disabled fields ignore both chooser and drop without a file change", async () => {
  const el = await setup();
  const changes = vi.fn();
  el.addEventListener("wt-change", changes);
  el.disabled = true;
  await el.updateComplete;
  choose(el, [photo()]);
  drag(el, "drop", [photo()]);
  expect(input(el).disabled).toBe(true);
  expect(el.files).toEqual([]);
  expect(changes).not.toHaveBeenCalled();
});
test("nested file drags stay marked until the last leave; text drags do not mark or select", async () => {
  const el = await setup();
  const f = photo();
  drag(el, "dragenter", [f]);
  drag(el, "dragenter", [f]);
  drag(el, "dragleave", [f]);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-dragging]")).not.toBeNull();
  expect(drag(el, "dragover", [f]).defaultPrevented).toBe(true);
  drag(el, "dragleave", [f]);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-dragging]")).toBeNull();
  const text = new DataTransfer();
  text.setData("text/plain", "bread");
  input(el).dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: text }));
  input(el).dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: text }));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-dragging]")).toBeNull();
  expect(el.files).toEqual([]);
});
test("controlled replacement and disconnect release preview URLs, reconnect recreates them without events", async () => {
  const el = await setup();
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const changes = vi.fn();
  el.addEventListener("wt-change", changes);
  el.files = [photo()];
  await el.updateComplete;
  const first = el.shadowRoot!.querySelector("img")!.src;
  expect(first.startsWith("blob:")).toBe(true);
  expect(el.shadowRoot!.textContent).toContain("patatas-bravas.png");
  el.files = [photo("other.png")];
  await el.updateComplete;
  expect(revoke).toHaveBeenCalledWith(first);
  const second = el.shadowRoot!.querySelector("img")!.src;
  el.remove();
  expect(revoke).toHaveBeenCalledWith(second);
  host.append(el);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("img")!.src).not.toBe(second);
  el.files = [];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("img")).toBeNull();
  expect(changes).not.toHaveBeenCalled();
});
test("required, error, size, focus and field width paint from the field tokens", async () => {
  const el = await setup();
  host.style.setProperty("--wt-color-danger", "rgb(120, 20, 30)");
  host.style.setProperty("--wt-field-max-width", "260px");
  expect(getComputedStyle(el.shadowRoot!.querySelector("[data-required]")!).color).toBe(
    "rgb(120, 20, 30)",
  );
  expect(el.getBoundingClientRect().width).toBe(260);
  expect(input(el).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  expect(input(el).name).toBe("photo");
  expect(input(el).required).toBe(true);
  el.error = "Choose a photo.";
  await el.updateComplete;
  expect(input(el).getAttribute("aria-invalid")).toBe("true");
  expect(
    el.shadowRoot!.getElementById(input(el).getAttribute("aria-describedby")!.split(" ").at(-1)!)!
      .textContent,
  ).toBe("Choose a photo.");
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(input(el));
  host.style.setProperty("--wt-color-field-fill", "rgb(10, 20, 30)");
  expect(getComputedStyle(el.shadowRoot!.querySelector("[part=field]")!).backgroundColor).toBe(
    "rgb(10, 20, 30)",
  );
});
test("drag highlighting reads the lifted-surface token", async () => {
  const el = await setup();
  host.style.setProperty("--wt-color-surface-lifted", "rgb(12, 34, 56)");
  drag(el, "dragenter", [photo()]);
  await el.updateComplete;
  expect(getComputedStyle(el.shadowRoot!.querySelector("[part=field]")!).backgroundColor).toBe(
    "rgb(12, 34, 56)",
  );
});

test("a queued file update after disconnect allocates no preview URL", async () => {
  const el = await setup();
  const create = vi.spyOn(URL, "createObjectURL");
  el.files = [photo()];
  el.remove();
  await el.updateComplete;
  expect(create).not.toHaveBeenCalled();
});
test("file sizes keep bytes and format megabytes in the selected locale", async () => {
  const el = await setup();
  el.files = [photo()];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".size")!.textContent).toBe("5 B");
  Object.assign(el, {
    locale: "es",
    files: [new File([new Uint8Array(3_100_000)], "large.png", { type: "image/png" })],
  });
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".size")!.textContent).toBe("3,1 MB");
});

test("unnamed file controls retain an accessible chooser and show non-image sizes without a preview", async () => {
  const el = (await mount('<wt-file-input hint="Choose files"></wt-file-input>')) as Field;
  expect(input(el).getAttribute("aria-label")).toBe("Choose a file");
  expect(input(el).hasAttribute("name")).toBe(false);
  el.files = [new File([new Uint8Array(1500)], "invoice.pdf", { type: "application/pdf" })];
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toContain("invoice.pdf");
  expect(el.shadowRoot!.querySelector(".size")!.textContent).toBe("1.5 kB");
  expect(el.shadowRoot!.querySelector("img")).toBeNull();
  expect(input(el).getAttribute("aria-invalid")).toBe("false");
});
