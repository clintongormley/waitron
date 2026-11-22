import { afterEach, describe, expect, it, vi } from "vitest";
import "@waitron/ui/src/components/wt-dialog.js";
import type { WtDialog } from "@waitron/ui/src/components/wt-dialog.js";
import { keyboardInsets, watchKeyboardInsets, type VisibleArea } from "./keyboard-inset.js";

// Readings estimated from screenshots of the owner's Pixel tablet in landscape, 2026-11-21.
describe("keyboardInsets", () => {
  it("a keyboard covering the bottom of a full-height page", () => {
    expect(keyboardInsets(640, { height: 256, offsetTop: 0, scale: 1 })).toEqual({
      top: 0,
      bottom: 384,
    });
  });

  it("a keyboard and autofill bar with the visible area panned down", () => {
    expect(keyboardInsets(640, { height: 192, offsetTop: 87, scale: 1 })).toEqual({
      top: 87,
      bottom: 361,
    });
  });

  it("the visible area panned all the way down still hides the page above it", () => {
    expect(keyboardInsets(640, { height: 192, offsetTop: 448, scale: 1 })).toEqual({
      top: 448,
      bottom: 0,
    });
  });

  it("a visible area reading past the bottom of the page hides nothing below it", () => {
    expect(keyboardInsets(640, { height: 200, offsetTop: 450, scale: 1 })).toEqual({
      top: 450,
      bottom: 0,
    });
  });

  it("a page the browser really shrank leaves nothing to make room for", () => {
    expect(keyboardInsets(256, { height: 256, offsetTop: 0, scale: 1 })).toEqual({
      top: 0,
      bottom: 0,
    });
  });

  it("a pinch zoom is not a keyboard", () => {
    expect(keyboardInsets(640, { height: 320, offsetTop: 100, scale: 2 })).toEqual({
      top: 0,
      bottom: 0,
    });
  });

  it("a zoom just over 1% away from 1 is not a keyboard", () => {
    expect(keyboardInsets(640, { height: 256, offsetTop: 87, scale: 1.011 })).toEqual({
      top: 0,
      bottom: 0,
    });
  });

  it("rounds fractional readings to whole pixels", () => {
    expect(keyboardInsets(640.4, { height: 255.6, offsetTop: 0.4, scale: 1.001 })).toEqual({
      top: 0,
      bottom: 384,
    });
  });
});

class FakeViewport extends EventTarget implements VisibleArea {
  height = 640;
  offsetTop = 0;
  scale = 1;

  move(height: number, offsetTop: number, event: "resize" | "scroll"): void {
    this.height = height;
    this.offsetTop = offsetTop;
    this.dispatchEvent(new Event(event));
  }
}

describe("watchKeyboardInsets", () => {
  let root: HTMLElement;
  let stop: (() => void) | undefined;
  afterEach(() => {
    stop?.();
    stop = undefined;
  });

  function start(viewport: FakeViewport | undefined): void {
    root = document.createElement("div");
    stop = watchKeyboardInsets({ visualViewport: viewport, innerHeight: 640 }, root);
  }

  const inset = (): string => root.style.getPropertyValue("--wt-keyboard-inset");
  const top = (): string => root.style.getPropertyValue("--wt-keyboard-top");

  it("does nothing without a visual viewport", () => {
    start(undefined);
    expect(inset()).toBe("");
    expect(top()).toBe("");
  });

  it("sets the values at start", () => {
    const viewport = new FakeViewport();
    viewport.height = 256;
    start(viewport);
    expect(inset()).toBe("384px");
    expect(top()).toBe("");
  });

  it("follows a resize and a scroll, and removes the values when the keyboard goes", () => {
    const viewport = new FakeViewport();
    start(viewport);
    expect(inset()).toBe("");

    viewport.move(256, 0, "resize");
    expect(inset()).toBe("384px");
    expect(top()).toBe("");

    viewport.move(192, 87, "scroll");
    expect(inset()).toBe("361px");
    expect(top()).toBe("87px");

    viewport.move(640, 0, "resize");
    expect(inset()).toBe("");
    expect(top()).toBe("");
  });

  it("stops following once stopped", () => {
    const viewport = new FakeViewport();
    start(viewport);
    stop!();
    stop = undefined;
    viewport.move(256, 0, "resize");
    viewport.move(192, 87, "scroll");
    expect(inset()).toBe("");
    expect(top()).toBe("");
  });
});

describe("watchKeyboardInsets and the focused field", () => {
  let root: HTMLElement;
  let stop: (() => void) | undefined;
  afterEach(() => {
    stop?.();
    stop = undefined;
    root.remove();
    vi.restoreAllMocks();
  });

  type Scroll = [HTMLElement, boolean | ScrollIntoViewOptions | undefined];

  function start(viewport: FakeViewport, control: HTMLElement): () => Scroll[] {
    root = document.createElement("div");
    root.append(control);
    document.body.append(root);
    control.focus();
    const scrolled: Scroll[] = [];
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(function (
      this: HTMLElement,
      options?: boolean | ScrollIntoViewOptions,
    ) {
      scrolled.push([this, options]);
    });
    stop = watchKeyboardInsets({ visualViewport: viewport, innerHeight: 640 }, root);
    return () => scrolled;
  }

  const frame = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const TOP = { block: "start" };
  const AS_NEEDED = { block: "nearest" };

  it("brings a focused text input into view once, after the last change", async () => {
    const viewport = new FakeViewport();
    const input = document.createElement("input");
    const scrolled = start(viewport, input);
    viewport.move(256, 0, "resize");
    viewport.move(192, 87, "scroll");
    await frame();
    expect(scrolled()).toEqual([[input, TOP]]);
  });

  it("finds the focused field inside a shadow root", async () => {
    const viewport = new FakeViewport();
    const holder = document.createElement("div");
    const textarea = document.createElement("textarea");
    holder.attachShadow({ mode: "open" }).append(textarea);
    const scrolled = start(viewport, holder);
    textarea.focus();
    viewport.move(256, 0, "resize");
    await frame();
    expect(scrolled()).toEqual([[textarea, TOP]]);
  });

  it("leaves a focused control that takes no text where it is", async () => {
    const viewport = new FakeViewport();
    const box = document.createElement("input");
    box.type = "checkbox";
    const scrolled = start(viewport, box);
    viewport.move(256, 0, "resize");
    await frame();
    expect(scrolled()).toEqual([]);
  });

  it("does not scroll when a reading leaves the values as they were", async () => {
    const viewport = new FakeViewport();
    const input = document.createElement("input");
    const scrolled = start(viewport, input);
    viewport.move(640, 0, "scroll");
    await frame();
    expect(scrolled()).toEqual([]);
  });

  it("does not scroll when the person pans the visible area without it changing height", async () => {
    const viewport = new FakeViewport();
    const input = document.createElement("input");
    const scrolled = start(viewport, input);
    viewport.move(192, 87, "resize");
    await frame();
    expect(scrolled()).toEqual([[input, TOP]]);
    scrolled().length = 0;
    viewport.move(192, 120, "scroll");
    await frame();
    expect(scrolled()).toEqual([]);
  });

  it("leaves a page field where it is when the keyboard changes height while it stays up", async () => {
    const viewport = new FakeViewport();
    const input = document.createElement("input");
    const scrolled = start(viewport, input);
    viewport.move(256, 0, "resize");
    await frame();
    viewport.move(220, 0, "resize");
    await frame();
    expect(scrolled()).toEqual([[input, TOP]]);
  });

  it("takes a page field to the top once when the keyboard opens and changes height in one frame", async () => {
    const viewport = new FakeViewport();
    const input = document.createElement("input");
    const scrolled = start(viewport, input);
    viewport.move(256, 0, "resize");
    viewport.move(220, 0, "resize");
    await frame();
    expect(scrolled()).toEqual([[input, TOP]]);
  });

  it("does not scroll a page field when the keyboard opens and goes in one frame", async () => {
    const viewport = new FakeViewport();
    const input = document.createElement("input");
    const scrolled = start(viewport, input);
    viewport.move(256, 0, "resize");
    viewport.move(640, 0, "resize");
    await frame();
    expect(scrolled()).toEqual([]);
  });

  it("does not scroll a page field when the keyboard goes", async () => {
    const viewport = new FakeViewport();
    const input = document.createElement("input");
    const scrolled = start(viewport, input);
    viewport.move(256, 0, "resize");
    await frame();
    expect(scrolled()).toEqual([[input, TOP]]);
    scrolled().length = 0;
    viewport.move(640, 0, "resize");
    await frame();
    expect(scrolled()).toEqual([]);
  });

  it("brings a field in an open window only as far as needed, as the keyboard opens and goes", async () => {
    const viewport = new FakeViewport();
    const window = document.createElement("wt-dialog") as WtDialog;
    const input = document.createElement("input");
    window.append(input);
    const scrolled = start(viewport, window);
    window.open = true;
    await window.updateComplete;
    input.focus();
    viewport.move(256, 0, "resize");
    await frame();
    viewport.move(640, 0, "resize");
    await frame();
    expect(scrolled()).toEqual([
      [input, AS_NEEDED],
      [input, AS_NEEDED],
    ]);
  });

  it("brings a field in an open popover only as far as needed", async () => {
    const viewport = new FakeViewport();
    const popover = document.createElement("div");
    popover.popover = "manual";
    const input = document.createElement("input");
    popover.append(input);
    const scrolled = start(viewport, popover);
    popover.showPopover();
    input.focus();
    viewport.move(256, 0, "resize");
    await frame();
    expect(scrolled()).toEqual([[input, AS_NEEDED]]);
  });

  it("does not scroll after being stopped with a change waiting", async () => {
    const viewport = new FakeViewport();
    const input = document.createElement("input");
    const scrolled = start(viewport, input);
    viewport.move(256, 0, "resize");
    stop!();
    stop = undefined;
    await frame();
    expect(scrolled()).toEqual([]);
  });
});
