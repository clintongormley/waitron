export const LONG_PRESS_MS = 500;
export const DOUBLE_TAP_MS = 300;
export const SLOP_PX = 8;
export const DOUBLE_TAP_PX = 24;

/** Client px; `target` is the `composedPath()[0]` of the pointerdown. */
export interface GesturePoint {
  target: EventTarget | null;
  x: number;
  y: number;
  pointerType: string;
}

export interface GestureHandlers {
  tap?(at: GesturePoint): void;
  /** The second of two taps within DOUBLE_TAP_MS and DOUBLE_TAP_PX; sent instead of a second tap. */
  doubleTap?(at: GesturePoint): void;
  /** The press has stayed within SLOP_PX for LONG_PRESS_MS. */
  holdStart?(at: GesturePoint): void;
  /** A hold released without moving SLOP_PX. */
  longPress?(at: GesturePoint): void;
  /** A hold that then moved; dx, dy from where the press began. */
  holdDrag?(at: GesturePoint & { dx: number; dy: number }): void;
  holdDrop?(at: GesturePoint & { dx: number; dy: number }): void;
  /** A press that moved SLOP_PX or more before the hold; dx, dy since the last call (the first call: since the press). */
  pan?(by: { dx: number; dy: number }): void;
  /** Two pointers: their distance's ratio since the last call, their midpoint now (client px), and how far it moved. */
  pinch?(change: { ratio: number; x: number; y: number; dx: number; dy: number }): void;
  /** The gesture ended without its own end: a pointercancel of a pointer it uses, a second pointer
   * arriving during a hold or a hold's drag, or a pointerdown reusing a pointer id the gesture
   * still tracks. Not sent once a pinch has lost a pointer. */
  cancel?(): void;
}

type State = "idle" | "pressed" | "held" | "dragging" | "panning" | "pinching" | "spent";

interface Spot {
  x: number;
  y: number;
}

const WINDOW_EVENTS = ["pointermove", "pointerup", "pointercancel"] as const;

/**
 * Tells tap, double tap, hold, hold-and-drag, pan and pinch apart. It only listens: it never stops
 * or prevents a pointer event, because the till's idle logout restarts on a `pointerdown` reaching
 * the app's host.
 */
export class Gestures {
  readonly #host: HTMLElement;
  readonly #handlers: GestureHandlers;
  #state: State = "idle";
  readonly #pointers = new Map<number, Spot>();
  /** Pointers pressed during a pinch or once it is spent: they take no part, but keep it active. */
  readonly #extras = new Set<number>();
  #pressId!: number;
  #target!: EventTarget | null;
  #pointerType!: string;
  #start!: Spot;
  #lastPan!: Spot;
  #pinchA!: Spot;
  #pinchB!: Spot;
  #lastSpan!: number;
  #lastMidX!: number;
  #lastMidY!: number;
  #holdTimer: ReturnType<typeof setTimeout> | undefined;
  #tapTimer: ReturnType<typeof setTimeout> | undefined;
  #lastTap!: Spot;

  constructor(host: HTMLElement, handlers: GestureHandlers) {
    this.#host = host;
    this.#handlers = handlers;
    host.addEventListener("pointerdown", this.#onDown);
  }

  /** True from a pointerdown until every pointer of the gesture lifts or cancels. */
  get active(): boolean {
    return this.#state !== "idle";
  }

  disconnect(): void {
    this.#host.removeEventListener("pointerdown", this.#onDown);
    this.#end();
    this.#closeTapWindow();
  }

  readonly #onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || (e.pointerType === "mouse" && e.ctrlKey)) return;
    // A pointerup that never arrived leaves its id tracked, and a mouse always reuses id 1.
    if (this.#pointers.has(e.pointerId) || this.#extras.has(e.pointerId)) {
      if (this.#state !== "spent") this.#handlers.cancel?.();
      this.#closeTapWindow();
      this.#pointers.clear();
      this.#extras.clear();
      this.#end();
    }
    const spot = { x: e.clientX, y: e.clientY };
    if (this.#state === "idle") {
      this.#state = "pressed";
      this.#pointers.set(e.pointerId, spot);
      this.#pressId = e.pointerId;
      this.#target = e.composedPath()[0] as EventTarget;
      this.#pointerType = e.pointerType;
      this.#start = { ...spot };
      for (const type of WINDOW_EVENTS) window.addEventListener(type, this.#onWindow);
      this.#holdTimer = setTimeout(this.#onHold, LONG_PRESS_MS);
      return;
    }
    if (this.#state === "pinching" || this.#state === "spent") {
      this.#extras.add(e.pointerId);
      return;
    }
    if (this.#state === "held" || this.#state === "dragging") this.#handlers.cancel?.();
    this.#clearHold();
    this.#closeTapWindow();
    this.#pointers.set(e.pointerId, spot);
    this.#state = "pinching";
    this.#pinchA = this.#pointers.get(this.#pressId)!;
    this.#pinchB = spot;
    this.#lastSpan = this.#span();
    this.#lastMidX = (this.#pinchA.x + spot.x) / 2;
    this.#lastMidY = (this.#pinchA.y + spot.y) / 2;
  };

  readonly #onWindow = (e: Event): void => {
    const event = e as PointerEvent;
    if (this.#extras.has(event.pointerId)) {
      if (e.type !== "pointermove") {
        this.#extras.delete(event.pointerId);
        this.#endIfLifted();
      }
      return;
    }
    const spot = this.#pointers.get(event.pointerId);
    if (!spot) return;
    spot.x = event.clientX;
    spot.y = event.clientY;
    if (e.type === "pointermove") this.#onMove(spot);
    else if (e.type === "pointerup") this.#onUp(event.pointerId, spot);
    else this.#onCancel(event.pointerId);
  };

  #onMove(spot: Spot): void {
    const dx = spot.x - this.#start.x;
    const dy = spot.y - this.#start.y;
    const moved = Math.hypot(dx, dy) >= SLOP_PX;
    switch (this.#state) {
      case "pressed":
        if (!moved) return;
        this.#clearHold();
        this.#closeTapWindow();
        this.#state = "panning";
        this.#lastPan = { ...this.#start };
        this.#pan(spot);
        return;
      case "panning":
        this.#pan(spot);
        return;
      case "held":
        if (!moved) return;
        this.#state = "dragging";
        this.#drag(spot, dx, dy);
        return;
      case "dragging":
        this.#drag(spot, dx, dy);
        return;
      case "pinching": {
        const span = this.#span();
        const x = (this.#pinchA.x + this.#pinchB.x) / 2;
        const y = (this.#pinchA.y + this.#pinchB.y) / 2;
        this.#handlers.pinch?.({
          ratio: this.#lastSpan === 0 ? 1 : span / this.#lastSpan,
          x,
          y,
          dx: x - this.#lastMidX,
          dy: y - this.#lastMidY,
        });
        this.#lastSpan = span;
        this.#lastMidX = x;
        this.#lastMidY = y;
        return;
      }
    }
  }

  #onUp(pointerId: number, spot: Spot): void {
    this.#pointers.delete(pointerId);
    const point = this.#point(spot);
    switch (this.#state) {
      case "pressed":
        this.#tap(point);
        break;
      case "held":
        this.#handlers.longPress?.(point);
        break;
      case "dragging":
        this.#handlers.holdDrop?.({
          ...point,
          dx: spot.x - this.#start.x,
          dy: spot.y - this.#start.y,
        });
        break;
      case "pinching":
        this.#state = "spent";
        break;
    }
    this.#endIfLifted();
  }

  #onCancel(pointerId: number): void {
    this.#pointers.delete(pointerId);
    if (this.#state !== "spent") this.#handlers.cancel?.();
    this.#closeTapWindow();
    this.#state = "spent";
    this.#endIfLifted();
  }

  readonly #onHold = (): void => {
    this.#holdTimer = undefined;
    this.#state = "held";
    this.#handlers.holdStart?.(this.#point(this.#pointers.get(this.#pressId) as Spot));
  };

  #tap(point: GesturePoint): void {
    const double =
      this.#tapTimer !== undefined &&
      Math.hypot(point.x - this.#lastTap.x, point.y - this.#lastTap.y) <= DOUBLE_TAP_PX;
    this.#closeTapWindow();
    if (double) {
      this.#handlers.doubleTap?.(point);
      return;
    }
    this.#handlers.tap?.(point);
    this.#lastTap = { x: point.x, y: point.y };
    this.#tapTimer = setTimeout(this.#closeTapWindow, DOUBLE_TAP_MS);
  }

  #pan(spot: Spot): void {
    this.#handlers.pan?.({ dx: spot.x - this.#lastPan.x, dy: spot.y - this.#lastPan.y });
    this.#lastPan.x = spot.x;
    this.#lastPan.y = spot.y;
  }

  #drag(spot: Spot, dx: number, dy: number): void {
    this.#handlers.holdDrag?.({
      target: this.#target,
      x: spot.x,
      y: spot.y,
      pointerType: this.#pointerType,
      dx,
      dy,
    });
  }

  #point(spot: Spot): GesturePoint {
    return { target: this.#target, x: spot.x, y: spot.y, pointerType: this.#pointerType };
  }

  #span(): number {
    return Math.hypot(this.#pinchB.x - this.#pinchA.x, this.#pinchB.y - this.#pinchA.y);
  }

  #clearHold(): void {
    clearTimeout(this.#holdTimer);
    this.#holdTimer = undefined;
  }

  readonly #closeTapWindow = (): void => {
    clearTimeout(this.#tapTimer);
    this.#tapTimer = undefined;
  };

  #endIfLifted(): void {
    if (this.#pointers.size === 0 && this.#extras.size === 0) this.#end();
  }

  #end(): void {
    this.#state = "idle";
    this.#clearHold();
    for (const type of WINDOW_EVENTS) window.removeEventListener(type, this.#onWindow);
  }
}
