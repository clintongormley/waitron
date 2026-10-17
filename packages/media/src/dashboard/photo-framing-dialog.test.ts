import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { currentLocale, setLocale } from "@waitron/dashboard-kit";
import "./image-library.js";

let el: HTMLElementTagNameMap["media-photo-framing-dialog"];
let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  el?.remove();
  setLocale(locale);
  vi.restoreAllMocks();
});
async function mount(framing = { x: 5000, y: 5000, zoom: 100 }) {
  const c = document.createElement("canvas");
  c.width = 800;
  c.height = 400;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "red";
  ctx.fillRect(0, 0, 400, 400);
  ctx.fillStyle = "blue";
  ctx.fillRect(400, 0, 400, 400);
  el = document.createElement("media-photo-framing-dialog");
  el.source = c.toDataURL();
  el.framing = framing;
  applyTokens(el);
  document.body.append(el);
  await el.updateComplete;
  expect(el.shadowRoot?.querySelector("wt-modal")).toBeInstanceOf(HTMLElement);
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  await vi.waitFor(() =>
    expect(
      el
        .shadowRoot!.querySelector("[data-test=lists]")
        ?.shadowRoot?.querySelector("canvas")
        ?.getAttribute("data-loaded"),
    ).toBe("true"),
  );
  return el.shadowRoot!;
}
function pixel(c: HTMLCanvasElement, x: number) {
  return [...c.getContext("2d")!.getImageData(x, Math.floor(c.height / 2), 1, 1).data];
}
it("paints square and 4:3 previews from the accepted geometry, without mutating its input", async () => {
  const initial = { x: 2500, y: 5000, zoom: 100 };
  const root = await mount(initial);
  const lists = root.querySelector("[data-test=lists]")!.shadowRoot!.querySelector("canvas")!;
  const till = root.querySelector("[data-test=till]")!.shadowRoot!.querySelector("canvas")!;
  expect(pixel(lists, lists.width - 2)).toEqual([255, 0, 0, 255]);
  expect(pixel(till, till.width - 2)).toEqual([0, 0, 255, 255]);
  expect(lists.getBoundingClientRect().width / lists.getBoundingClientRect().height).toBeCloseTo(
    1,
    2,
  );
  expect(till.getBoundingClientRect().width / till.getBoundingClientRect().height).toBeCloseTo(
    4 / 3,
    2,
  );
  const frame = root.querySelector<HTMLElement>("[data-test=frame]")!;
  frame.focus();
  await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
  expect(initial).toEqual({ x: 2500, y: 5000, zoom: 100 });
  const done = vi.fn();
  el.addEventListener("done", done);
  await userEvent.click(page.elementLocator(root.querySelector("[data-test=done]")!));
  expect(done).toHaveBeenCalledTimes(1);
  const event = done.mock.calls[0]![0] as CustomEvent;
  expect(event.detail).toEqual({ framing: { x: 3500, y: 5000, zoom: 100 } });
  expect(event.bubbles).toBe(true);
  expect(event.composed).toBe(true);
});
it("arrows use 1 percent, Shift uses 10 percent, and clamp at both edges", async () => {
  const root = await mount({ x: 50, y: 9950, zoom: 100 });
  root.querySelector<HTMLElement>("[data-test=frame]")!.focus();
  await userEvent.keyboard("{ArrowLeft}{ArrowDown}{Shift>}{ArrowRight}{ArrowUp}{/Shift}");
  const done = vi.fn();
  el.addEventListener("done", done);
  root.querySelector<HTMLElement>("[data-test=done]")!.click();
  expect(done.mock.calls[0]![0].detail).toEqual({ framing: { x: 1000, y: 9000, zoom: 100 } });
});
it("continuous zoom redraws immediately, stops at 400 and Reset restores centre/100", async () => {
  const root = await mount();
  const reset = root.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=reset]")!;
  expect(reset.disabled).toBe(true);
  const slider = root.querySelector("wt-slider")!;
  await slider.updateComplete;
  expect(slider.name).toBe("photo-zoom");
  expect(slider.continuous).toBe(true);
  const input = slider.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  input.value = "400";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(reset.disabled).toBe(false);
  const frame = root.querySelector<HTMLElement>("[data-test=frame-image]")!;
  expect(frame.getAttribute("data-zoom")).toBe("400");
  input.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(input.value).toBe("400");
  reset.click();
  await el.updateComplete;
  expect(reset.disabled).toBe(true);
  const done = vi.fn();
  el.addEventListener("done", done);
  root.querySelector<HTMLElement>("[data-test=done]")!.click();
  expect(done.mock.calls[0]![0].detail).toEqual({ framing: { x: 5000, y: 5000, zoom: 100 } });
});
it.each(["pointercancel", "lostpointercapture"])(
  "%s ends drag and ignores subsequent moves",
  async (end) => {
    const root = await mount();
    const frame = root.querySelector<HTMLElement>("[data-test=frame]")!;
    // Synthetic streams qualify pointer math/cancellation; native mouse/touch capture is checked by LOOK.
    vi.spyOn(frame, "setPointerCapture").mockImplementation(() => {});
    const box = frame.getBoundingClientRect();
    frame.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 7,
        button: 0,
        clientX: box.left + 10,
        clientY: box.top + 10,
      }),
    );
    frame.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 7,
        clientX: box.left + 10 + box.width / 2,
        clientY: box.top + 10,
      }),
    );
    frame.dispatchEvent(new PointerEvent(end, { pointerId: 7 }));
    frame.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 7, clientX: -10000, clientY: -10000 }),
    );
    const done = vi.fn();
    el.addEventListener("done", done);
    root.querySelector<HTMLElement>("[data-test=done]")!.click();
    expect(done.mock.calls[0]![0].detail).toEqual({ framing: { x: 2500, y: 5000, zoom: 100 } });
  },
);
it("clamps a drag outside the image and uses the resized frame for the next movement", async () => {
  const root = await mount();
  const frame = root.querySelector<HTMLElement>("[data-test=frame]")!;
  vi.spyOn(frame, "setPointerCapture").mockImplementation(() => {});
  frame.dispatchEvent(
    new PointerEvent("pointerdown", { pointerId: 7, button: 0, clientX: 0, clientY: 0 }),
  );
  frame.dispatchEvent(
    new PointerEvent("pointermove", { pointerId: 8, clientX: 10000, clientY: 10000 }),
  );
  frame.dispatchEvent(
    new PointerEvent("pointermove", { pointerId: 7, clientX: 10000, clientY: -10000 }),
  );
  const done = vi.fn();
  el.addEventListener("done", done);
  root.querySelector<HTMLElement>("[data-test=done]")!.click();
  expect(done.mock.calls[0]![0].detail).toEqual({ framing: { x: 0, y: 10000, zoom: 100 } });
});
it("a failed source can retry and a late old image cannot paint over a replacement", async () => {
  const root = await mount();
  el.source = "data:image/png;base64,invalid";
  await el.updateComplete;
  await vi.waitFor(() => expect(root.querySelector("[role=alert]")).not.toBeNull());
  expect(root.querySelector<HTMLElementTagNameMap["wt-slider"]>("wt-slider")!.disabled).toBe(true);
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  c.getContext("2d")!.fillStyle = "lime";
  c.getContext("2d")!.fillRect(0, 0, 1, 1);
  el.source = c.toDataURL();
  await el.updateComplete;
  await vi.waitFor(() => expect(root.querySelector("[role=alert]")).toBeNull());
  await vi.waitFor(() =>
    expect(
      pixel(root.querySelector("[data-test=lists]")!.shadowRoot!.querySelector("canvas")!, 0),
    ).toEqual([0, 255, 0, 255]),
  );
});

it("a source response delivered after replacement or disconnect cannot overwrite the current crop", async () => {
  const NativeImage = Image;
  const pending: { image: HTMLImageElement; deliver: () => void }[] = [];
  vi.spyOn(window, "Image").mockImplementation(function () {
    const image = new NativeImage();
    Object.defineProperty(image, "onload", {
      set(handler: () => void) {
        pending.push({ image, deliver: handler });
      },
    });
    return image;
  });
  const preview = document.createElement("media-photo-preview");
  preview.label = "Photo";
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "red";
  ctx.fillRect(0, 0, 1, 1);
  preview.source = c.toDataURL();
  applyTokens(preview);
  document.body.append(preview);
  try {
    await preview.updateComplete;
    await vi.waitFor(() => expect(pending[0]!.image.naturalWidth).toBe(1));
    ctx.fillStyle = "blue";
    ctx.fillRect(0, 0, 1, 1);
    preview.source = c.toDataURL();
    await preview.updateComplete;
    await vi.waitFor(() => expect(pending[1]!.image.naturalWidth).toBe(1));
    pending[1]!.deliver();
    await preview.updateComplete;
    const canvas = preview.shadowRoot!.querySelector("canvas")!;
    expect(pixel(canvas, 0)).toEqual([0, 0, 255, 255]);
    pending[0]!.deliver();
    await preview.updateComplete;
    expect(pixel(canvas, 0)).toEqual([0, 0, 255, 255]);
    preview.remove();
    pending[1]!.deliver();
    document.body.append(preview);
    await preview.updateComplete;
    pending[1]!.deliver();
    await preview.updateComplete;
    expect(canvas.getAttribute("data-loaded")).toBe("false");
    pending[2]!.deliver();
    await preview.updateComplete;
    expect(pixel(canvas, 0)).toEqual([0, 0, 255, 255]);
  } finally {
    preview.remove();
  }
});

it("uses the current frame size mid-drag, ignores a second pointer and releases native capture", async () => {
  const root = await mount();
  const frame = root.querySelector<HTMLElement>("[data-test=frame]")!;
  vi.spyOn(frame, "setPointerCapture").mockImplementation(() => {});
  vi.spyOn(frame, "hasPointerCapture").mockReturnValue(true);
  const release = vi.spyOn(frame, "releasePointerCapture").mockImplementation(() => {});
  frame.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 7, button: 2 }));
  frame.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 7, button: 0 }));
  frame.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 8, button: 0 }));
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({ width: 200, height: 200 } as DOMRect);
  frame.dispatchEvent(
    new PointerEvent("pointermove", { pointerId: 8, clientX: 100, clientY: 100 }),
  );
  frame.dispatchEvent(new PointerEvent("pointermove", { pointerId: 7, clientX: 50, clientY: 0 }));
  frame.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, clientX: 50, clientY: 0 }));
  const done = vi.fn();
  el.addEventListener("done", done);
  root.querySelector<HTMLElement>("[data-test=done]")!.click();
  expect(done.mock.calls[0]![0].detail).toEqual({ framing: { x: 3750, y: 5000, zoom: 100 } });
  expect(release).toHaveBeenCalledWith(7);
});

it("a native mouse press captures its pointer before moving or releasing it", async () => {
  const root = await mount();
  const frame = root.querySelector<HTMLElement>("[data-test=frame]")!;
  const captures: boolean[] = [];
  frame.addEventListener("pointerdown", (event) =>
    captures.push(frame.hasPointerCapture(event.pointerId)),
  );
  await userEvent.click(page.elementLocator(frame));
  expect(captures).toEqual([true]);
});

it("backdrop dismisses without accepting a private change", async () => {
  const root = await mount({ x: 2500, y: 7500, zoom: 200 });
  root.querySelector<HTMLElement>("[data-test=reset]")!.click();
  const modal = root.querySelector("wt-modal")!;
  const native = modal.shadowRoot!.querySelector("dialog")!;
  const close = new Promise((resolve) => el.addEventListener("close", resolve, { once: true }));
  const done = vi.fn();
  el.addEventListener("done", done);
  native.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true, clientX: -1, clientY: -1 }),
  );
  await close;
  expect(done).not.toHaveBeenCalled();
  expect(el.framing).toEqual({ x: 2500, y: 7500, zoom: 200 });
});
