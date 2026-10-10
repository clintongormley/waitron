import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, mount } from "./test-helpers.js";
import {
  DOUBLE_TAP_MS,
  DOUBLE_TAP_PX,
  Gestures,
  LONG_PRESS_MS,
  SLOP_PX,
  type GestureHandlers,
} from "./gestures.js";

type Handlers = { [K in keyof Required<GestureHandlers>]: Mock<NonNullable<GestureHandlers[K]>> };

let hostEl: HTMLElement;
let b: HTMLButtonElement;
let handlers: Handlers;
let gestures: Gestures;

function dispatch(
  target: EventTarget,
  type: string,
  pointerId: number,
  clientX: number,
  clientY: number,
  extra: PointerEventInit = {},
): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    pointerId,
    pointerType: "touch",
    clientX,
    clientY,
    button: 0,
    ...extra,
  });
  target.dispatchEvent(event);
  return event;
}

const down = (
  id: number,
  x: number,
  y: number,
  extra?: PointerEventInit,
  target: EventTarget = b,
) => dispatch(target, "pointerdown", id, x, y, extra);
const move = (id: number, x: number, y: number) => dispatch(window, "pointermove", id, x, y);
const up = (id: number, x: number, y: number, extra?: PointerEventInit) =>
  dispatch(window, "pointerup", id, x, y, extra);
const tapAt = (x: number, y: number, id = 1) => {
  down(id, x, y);
  up(id, x, y);
};

function called(except: (keyof Handlers)[]): (keyof Handlers)[] {
  return (Object.keys(handlers) as (keyof Handlers)[]).filter(
    (k) => !except.includes(k) && handlers[k].mock.calls.length > 0,
  );
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  hostEl = await mount('<div style="width: 600px; height: 300px"><button id="b">B</button></div>');
  b = hostEl.querySelector("#b") as HTMLButtonElement;
  handlers = {
    tap: vi.fn(),
    doubleTap: vi.fn(),
    holdStart: vi.fn(),
    longPress: vi.fn(),
    holdDrag: vi.fn(),
    holdDrop: vi.fn(),
    pan: vi.fn(),
    pinch: vi.fn(),
    cancel: vi.fn(),
  };
  gestures = new Gestures(hostEl, handlers);
});

afterEach(() => {
  gestures.disconnect();
  vi.useRealTimers();
  cleanup();
});

describe("Gestures", () => {
  it("names its thresholds", () => {
    expect([LONG_PRESS_MS, DOUBLE_TAP_MS, SLOP_PX, DOUBLE_TAP_PX]).toEqual([500, 300, 8, 24]);
  });

  it("a press released in place is a tap, at once", () => {
    expect(gestures.active).toBe(false);
    down(1, 10, 10);
    expect(gestures.active).toBe(true);
    up(1, 12, 13);
    expect(handlers.tap).toHaveBeenCalledTimes(1);
    expect(handlers.tap).toHaveBeenCalledWith({ target: b, x: 12, y: 13, pointerType: "touch" });
    expect(called(["tap"])).toEqual([]);
    expect(gestures.active).toBe(false);
  });

  it("a second tap within 300 ms and 24 px is a double tap, not a tap", () => {
    tapAt(10, 10);
    vi.advanceTimersByTime(299);
    tapAt(30, 10);
    expect(handlers.tap).toHaveBeenCalledTimes(1);
    expect(handlers.doubleTap).toHaveBeenCalledTimes(1);
    expect(handlers.doubleTap).toHaveBeenCalledWith({
      target: b,
      x: 30,
      y: 10,
      pointerType: "touch",
    });
  });

  it("a double tap is measured as a distance, and 24 px counts", () => {
    tapAt(10, 10);
    tapAt(10 + 24 * Math.cos(Math.PI / 4), 10 + 24 * Math.sin(Math.PI / 4));
    expect(handlers.doubleTap).toHaveBeenCalledTimes(1);
  });

  it("a double tap closes the window, so a third tap is a tap", () => {
    tapAt(10, 10);
    tapAt(10, 10);
    tapAt(10, 10);
    expect(handlers.tap).toHaveBeenCalledTimes(2);
    expect(handlers.doubleTap).toHaveBeenCalledTimes(1);
  });

  it("two taps 300 ms apart are two taps", () => {
    tapAt(10, 10);
    vi.advanceTimersByTime(300);
    tapAt(10, 10);
    expect(handlers.tap).toHaveBeenCalledTimes(2);
    expect(handlers.doubleTap).not.toHaveBeenCalled();
  });

  it("two taps 25 px apart are two taps", () => {
    tapAt(10, 10);
    tapAt(35, 10);
    expect(handlers.tap).toHaveBeenCalledTimes(2);
    expect(handlers.doubleTap).not.toHaveBeenCalled();
  });

  it("two taps 25 px apart vertically are two taps", () => {
    tapAt(10, 10);
    tapAt(10, 35);
    expect(handlers.doubleTap).not.toHaveBeenCalled();
  });

  it("a press held 500 ms marks the hold, and its release is a long-press, not a tap", () => {
    down(1, 10, 10);
    vi.advanceTimersByTime(499);
    expect(handlers.holdStart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(handlers.holdStart).toHaveBeenCalledTimes(1);
    expect(handlers.holdStart).toHaveBeenCalledWith({
      target: b,
      x: 10,
      y: 10,
      pointerType: "touch",
    });
    up(1, 11, 12);
    expect(handlers.longPress).toHaveBeenCalledTimes(1);
    expect(handlers.longPress).toHaveBeenCalledWith({
      target: b,
      x: 11,
      y: 12,
      pointerType: "touch",
    });
    expect(handlers.tap).not.toHaveBeenCalled();
    expect(gestures.active).toBe(false);
  });

  it("the hold is placed where the pointer is when it fires", () => {
    down(1, 10, 10);
    move(1, 13, 14);
    vi.advanceTimersByTime(500);
    expect(handlers.holdStart).toHaveBeenCalledWith({
      target: b,
      x: 13,
      y: 14,
      pointerType: "touch",
    });
  });

  it("moving 7 px still holds", () => {
    down(1, 10, 10);
    move(1, 17, 10);
    vi.advanceTimersByTime(500);
    expect(handlers.holdStart).toHaveBeenCalledTimes(1);
    up(1, 17, 10);
    expect(handlers.longPress).toHaveBeenCalledTimes(1);
    expect(handlers.pan).not.toHaveBeenCalled();
  });

  it("a move within the slop before release is still a tap", () => {
    down(1, 10, 10);
    move(1, 10, 17);
    up(1, 10, 17);
    expect(handlers.tap).toHaveBeenCalledTimes(1);
  });

  it("moving 8 px before the hold pans, from where the press began", () => {
    down(1, 10, 10);
    move(1, 18, 10);
    expect(handlers.pan).toHaveBeenLastCalledWith({ dx: 8, dy: 0 });
    move(1, 40, 15);
    expect(handlers.pan).toHaveBeenLastCalledWith({ dx: 22, dy: 5 });
    expect(handlers.pan).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(handlers.holdStart).not.toHaveBeenCalled();
    up(1, 40, 15);
    expect(handlers.tap).not.toHaveBeenCalled();
    expect(handlers.longPress).not.toHaveBeenCalled();
    expect(gestures.active).toBe(false);
  });

  it("the slop is a distance", () => {
    down(1, 10, 10);
    move(1, 16, 16);
    expect(handlers.pan).toHaveBeenCalledWith({ dx: 6, dy: 6 });
  });

  it("a pan closes the double-tap window", () => {
    tapAt(10, 10);
    down(1, 10, 10);
    move(1, 30, 10);
    up(1, 30, 10);
    tapAt(10, 10);
    expect(handlers.doubleTap).not.toHaveBeenCalled();
    expect(handlers.tap).toHaveBeenCalledTimes(2);
  });

  it("a hold that moves drags, measured from the press", () => {
    down(1, 10, 10);
    vi.advanceTimersByTime(500);
    move(1, 17, 10);
    expect(handlers.holdDrag).not.toHaveBeenCalled();
    move(1, 50, 10);
    expect(handlers.holdDrag).toHaveBeenCalledWith({
      target: b,
      x: 50,
      y: 10,
      pointerType: "touch",
      dx: 40,
      dy: 0,
    });
    move(1, 12, 10);
    expect(handlers.holdDrag).toHaveBeenLastCalledWith({
      target: b,
      x: 12,
      y: 10,
      pointerType: "touch",
      dx: 2,
      dy: 0,
    });
    up(1, 60, 20);
    expect(handlers.holdDrop).toHaveBeenCalledTimes(1);
    expect(handlers.holdDrop).toHaveBeenCalledWith({
      target: b,
      x: 60,
      y: 20,
      pointerType: "touch",
      dx: 50,
      dy: 10,
    });
    expect(handlers.longPress).not.toHaveBeenCalled();
    expect(handlers.pan).not.toHaveBeenCalled();
    expect(gestures.active).toBe(false);
  });

  it("two pointers pinch about their midpoint", () => {
    down(1, 200, 150);
    down(2, 300, 150);
    move(2, 400, 150);
    expect(handlers.pinch).toHaveBeenCalledTimes(1);
    expect(handlers.pinch).toHaveBeenCalledWith({ ratio: 2, x: 300, y: 150, dx: 50, dy: 0 });
    move(1, 200, 250);
    expect(handlers.pinch).toHaveBeenLastCalledWith({
      ratio: Math.hypot(200, 100) / 200,
      x: 300,
      y: 200,
      dx: 0,
      dy: 50,
    });
    expect(handlers.cancel).not.toHaveBeenCalled();
    expect(handlers.pan).not.toHaveBeenCalled();
  });

  it("two pointers pressed at one spot pinch from a ratio of 1", () => {
    down(1, 200, 150);
    down(2, 200, 150);
    move(2, 300, 150);
    expect(handlers.pinch).toHaveBeenCalledWith({ ratio: 1, x: 250, y: 150, dx: 50, dy: 0 });
  });

  it("a pinch closes the double-tap window", () => {
    tapAt(10, 10);
    down(1, 10, 10);
    down(2, 100, 10);
    up(2, 100, 10);
    up(1, 10, 10);
    tapAt(10, 10);
    expect(handlers.doubleTap).not.toHaveBeenCalled();
    expect(handlers.tap).toHaveBeenCalledTimes(2);
  });

  it("a pan that gains a second pointer pinches", () => {
    down(1, 200, 150);
    move(1, 220, 150);
    down(2, 320, 150);
    move(2, 420, 150);
    expect(handlers.pinch).toHaveBeenCalledWith({ ratio: 2, x: 320, y: 150, dx: 50, dy: 0 });
    expect(handlers.pan).toHaveBeenCalledTimes(1);
    expect(handlers.cancel).not.toHaveBeenCalled();
  });

  it("a second pointer during a hold cancels it", () => {
    down(1, 10, 10);
    vi.advanceTimersByTime(500);
    down(2, 100, 10);
    expect(handlers.cancel).toHaveBeenCalledTimes(1);
    up(2, 100, 10);
    up(1, 10, 10);
    expect(handlers.longPress).not.toHaveBeenCalled();
    expect(handlers.tap).not.toHaveBeenCalled();
    expect(handlers.holdDrop).not.toHaveBeenCalled();
    expect(gestures.active).toBe(false);
  });

  it("a second pointer during a hold's drag cancels it", () => {
    down(1, 10, 10);
    vi.advanceTimersByTime(500);
    move(1, 40, 10);
    down(2, 100, 10);
    expect(handlers.cancel).toHaveBeenCalledTimes(1);
    up(2, 100, 10);
    up(1, 40, 10);
    expect(handlers.holdDrop).not.toHaveBeenCalled();
  });

  it("a second pointer before the hold stops the hold", () => {
    down(1, 10, 10);
    down(2, 100, 10);
    vi.advanceTimersByTime(500);
    expect(handlers.holdStart).not.toHaveBeenCalled();
    expect(handlers.cancel).not.toHaveBeenCalled();
  });

  it("after a pinch nothing happens until every pointer lifts", () => {
    down(1, 200, 150);
    down(2, 300, 150);
    move(2, 400, 150);
    up(2, 400, 150);
    expect(gestures.active).toBe(true);
    move(1, 260, 150);
    move(1, 300, 150);
    expect(handlers.pan).not.toHaveBeenCalled();
    expect(handlers.pinch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(handlers.holdStart).not.toHaveBeenCalled();
    up(1, 300, 150);
    expect(called(["pinch"])).toEqual([]);
    expect(gestures.active).toBe(false);
  });

  it("a new press while a pinch is spent is ignored", () => {
    down(1, 200, 150);
    down(2, 300, 150);
    up(2, 300, 150);
    down(3, 50, 50);
    up(1, 200, 150);
    expect(gestures.active).toBe(false);
    up(3, 50, 50);
    expect(called([])).toEqual([]);
  });

  it("a third pointer is ignored", () => {
    down(1, 200, 150);
    down(2, 300, 150);
    move(2, 400, 150);
    down(3, 500, 150);
    move(3, 550, 150);
    up(3, 550, 150);
    expect(handlers.pinch).toHaveBeenCalledTimes(1);
    expect(gestures.active).toBe(true);
  });

  it("pointercancel ends the press", () => {
    down(1, 10, 10);
    dispatch(window, "pointercancel", 1, 10, 10);
    expect(handlers.cancel).toHaveBeenCalledTimes(1);
    expect(gestures.active).toBe(false);
    up(1, 10, 10);
    vi.advanceTimersByTime(500);
    expect(called(["cancel"])).toEqual([]);
  });

  it("pointercancel ends a pinch, which then waits for the other pointer", () => {
    down(1, 200, 150);
    down(2, 300, 150);
    dispatch(window, "pointercancel", 2, 300, 150);
    expect(handlers.cancel).toHaveBeenCalledTimes(1);
    expect(gestures.active).toBe(true);
    move(1, 260, 150);
    dispatch(window, "pointercancel", 1, 260, 150);
    expect(handlers.cancel).toHaveBeenCalledTimes(1);
    expect(called(["cancel"])).toEqual([]);
    expect(gestures.active).toBe(false);
  });

  it("another pointer's cancel does not end the press", () => {
    down(1, 10, 10);
    dispatch(window, "pointercancel", 9, 10, 10);
    expect(handlers.cancel).not.toHaveBeenCalled();
    up(9, 10, 10);
    expect(handlers.tap).not.toHaveBeenCalled();
    up(1, 10, 10);
    expect(handlers.tap).toHaveBeenCalledTimes(1);
  });

  it("a cancelled press closes the double-tap window", () => {
    tapAt(10, 10);
    down(1, 10, 10);
    dispatch(window, "pointercancel", 1, 10, 10);
    tapAt(10, 10);
    expect(handlers.doubleTap).not.toHaveBeenCalled();
    expect(handlers.tap).toHaveBeenCalledTimes(2);
  });

  it("a mouse's right button starts nothing", () => {
    down(1, 10, 10, { pointerType: "mouse", button: 2 });
    expect(gestures.active).toBe(false);
    up(1, 10, 10, { pointerType: "mouse", button: 2 });
    expect(handlers.tap).not.toHaveBeenCalled();
    expect(gestures.active).toBe(false);
  });

  it("a mouse press with Ctrl held starts nothing", () => {
    down(1, 10, 10, { pointerType: "mouse", ctrlKey: true });
    expect(gestures.active).toBe(false);
    up(1, 10, 10, { pointerType: "mouse", ctrlKey: true });
    expect(handlers.tap).not.toHaveBeenCalled();
  });

  it("a mouse's left button taps, and says it was a mouse", () => {
    down(1, 10, 10, { pointerType: "mouse" });
    up(1, 10, 10, { pointerType: "mouse" });
    expect(handlers.tap).toHaveBeenCalledWith({ target: b, x: 10, y: 10, pointerType: "mouse" });
  });

  it("a pen's barrel button starts nothing", () => {
    down(1, 10, 10, { pointerType: "pen", button: 2 });
    expect(gestures.active).toBe(false);
    up(1, 10, 10, { pointerType: "pen", button: 2 });
    expect(handlers.tap).not.toHaveBeenCalled();
  });

  it("Ctrl held with a touch or pen still presses", () => {
    down(1, 10, 10, { pointerType: "pen", ctrlKey: true });
    up(1, 10, 10);
    expect(handlers.tap).toHaveBeenCalledWith({ target: b, x: 10, y: 10, pointerType: "pen" });
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    down(2, 100, 100, { pointerType: "touch", ctrlKey: true });
    up(2, 100, 100);
    expect(handlers.tap).toHaveBeenLastCalledWith({
      target: b,
      x: 100,
      y: 100,
      pointerType: "touch",
    });
    expect(handlers.tap).toHaveBeenCalledTimes(2);
  });

  it("a press reusing a tracked pointer's id ends the stale gesture and starts afresh", () => {
    down(1, 10, 10, { pointerType: "mouse" });
    down(1, 50, 60, { pointerType: "mouse" });
    expect(handlers.cancel).toHaveBeenCalledTimes(1);
    expect(gestures.active).toBe(true);
    up(1, 50, 60, { pointerType: "mouse" });
    expect(handlers.tap).toHaveBeenCalledTimes(1);
    expect(handlers.tap).toHaveBeenCalledWith({ target: b, x: 50, y: 60, pointerType: "mouse" });
    expect(gestures.active).toBe(false);
  });

  it("a reused id during a pinch starts afresh, and the old second pointer is forgotten", () => {
    down(1, 200, 150);
    down(2, 300, 150);
    down(1, 10, 10);
    expect(handlers.cancel).toHaveBeenCalledTimes(1);
    move(2, 400, 150);
    expect(handlers.pinch).not.toHaveBeenCalled();
    move(1, 30, 10);
    expect(handlers.pan).toHaveBeenCalledWith({ dx: 20, dy: 0 });
  });

  it("a reused id after a pinch is spent starts afresh without a cancel", () => {
    down(1, 200, 150);
    down(2, 300, 150);
    up(2, 300, 150);
    down(1, 10, 10);
    expect(handlers.cancel).not.toHaveBeenCalled();
    up(1, 10, 10);
    expect(handlers.tap).toHaveBeenCalledTimes(1);
  });

  it("a reused id closes the double-tap window", () => {
    tapAt(10, 10);
    down(1, 10, 10);
    down(1, 10, 10);
    up(1, 10, 10);
    expect(handlers.doubleTap).not.toHaveBeenCalled();
    expect(handlers.tap).toHaveBeenCalledTimes(2);
  });

  it("a reused id clears the stale hold", () => {
    down(1, 10, 10);
    vi.advanceTimersByTime(300);
    down(1, 10, 10);
    vi.advanceTimersByTime(300);
    expect(handlers.holdStart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(handlers.holdStart).toHaveBeenCalledTimes(1);
  });

  it("never stops or prevents a press", () => {
    const heard = vi.fn();
    document.addEventListener("pointerdown", heard);
    try {
      const event = down(1, 10, 10);
      expect(heard).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(false);
      const release = up(1, 10, 10);
      expect(release.defaultPrevented).toBe(false);
    } finally {
      document.removeEventListener("pointerdown", heard);
    }
  });

  it("another pointer's moves do not move a one-finger press", () => {
    down(1, 10, 10);
    move(9, 60, 10);
    expect(handlers.pan).not.toHaveBeenCalled();
    up(1, 10, 10);
    expect(handlers.tap).toHaveBeenCalledTimes(1);
  });

  it("a press on the host itself names the host as its target", () => {
    down(1, 10, 10, {}, hostEl);
    up(1, 10, 10);
    expect(handlers.tap).toHaveBeenCalledWith({
      target: hostEl,
      x: 10,
      y: 10,
      pointerType: "touch",
    });
  });

  it("a press outside the host starts nothing", () => {
    down(1, 10, 10, {}, document.body);
    up(1, 10, 10);
    expect(handlers.tap).not.toHaveBeenCalled();
    expect(gestures.active).toBe(false);
  });

  it("no window listener outlives a gesture", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    tapAt(10, 10);
    expect(remove.mock.calls.map((c) => c[0]).sort()).toEqual([
      "pointercancel",
      "pointermove",
      "pointerup",
    ]);
    remove.mockRestore();
  });

  it("works with no handlers at all", () => {
    gestures.disconnect();
    gestures = new Gestures(hostEl, {});
    tapAt(10, 10);
    tapAt(10, 10);
    down(1, 10, 10);
    move(1, 40, 10);
    up(1, 40, 10);
    down(1, 10, 10);
    vi.advanceTimersByTime(500);
    move(1, 40, 10);
    move(1, 50, 10);
    up(1, 50, 10);
    down(1, 10, 10);
    vi.advanceTimersByTime(500);
    up(1, 10, 10);
    down(1, 10, 10);
    vi.advanceTimersByTime(500);
    down(2, 100, 10);
    move(2, 200, 10);
    dispatch(window, "pointercancel", 2, 200, 10);
    up(1, 10, 10);
    down(1, 10, 10);
    down(1, 10, 10);
    up(1, 10, 10);
    expect(gestures.active).toBe(false);
  });

  it("disconnect stops listening and clears the hold", () => {
    down(1, 10, 10);
    gestures.disconnect();
    expect(gestures.active).toBe(false);
    vi.advanceTimersByTime(500);
    expect(handlers.holdStart).not.toHaveBeenCalled();
    up(1, 10, 10);
    tapAt(10, 10);
    expect(handlers.tap).not.toHaveBeenCalled();
  });

  it("disconnect clears the double-tap window", () => {
    tapAt(10, 10);
    expect(vi.getTimerCount()).toBe(1);
    gestures.disconnect();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a double tap leaves no timer running", () => {
    tapAt(10, 10);
    tapAt(10, 10);
    expect(vi.getTimerCount()).toBe(0);
  });
});
