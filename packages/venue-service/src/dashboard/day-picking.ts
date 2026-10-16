import type { ReactiveController, ReactiveControllerHost } from "lit";
import { capturePointer, DRAG_THRESHOLD_PX, releasePointer } from "@waitron/dashboard-kit";
import type { LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";

/** A run of days, `from` <= `to`. */
export interface DayRun {
  from: LocalDate;
  to: LocalDate;
}

export interface DayPickerOptions {
  /** The button for a date, for focus and for finding the day under a pointer; null when the grid
   *  does not draw it. The button, or an element around it, carries the date as `data-date`. */
  button(date: LocalDate): HTMLElement | null;
  /** Every drawn date, in order, for hit-testing a pointer's position. */
  dates(): readonly LocalDate[];
  /** False: a click and Space still choose; nothing picks a run and nothing opens. */
  canPick(): boolean;
  /** A touch drag picks a run at once, with no long press. Default false. */
  dragOnTouch?: boolean;
  /** The long press, in milliseconds. Default 500. */
  holdMs?: number;
  /** A click, a tap, Space. */
  choose(date: LocalDate, trigger: HTMLElement): void;
  /** The run changed. */
  picked(run: DayRun | null): void;
  /** A double-click, a long press, Enter. */
  open?(date: LocalDate, run: DayRun, trigger: HTMLElement): void;
}

interface Gesture {
  pointerId: number;
  /** A touch waiting for, or past, its long press; otherwise a mouse-style drag. */
  touch: boolean;
  grid: HTMLElement;
  date: LocalDate;
  /** The last day the pointer was over; a point between buttons keeps it. */
  last: LocalDate;
  /** The drawn days' rectangles; null until read, and again after any scroll. */
  boxes: { date: LocalDate; box: DOMRect }[] | null;
  scrolled: () => void;
  trigger: HTMLElement;
  x: number;
  y: number;
  before: { run: DayRun | null; anchor: LocalDate | null };
  dragging: boolean;
  held: boolean;
  movedSinceHold: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Non-passive, so the page stops scrolling once a long press, or a touch drag, has the finger. */
  stopScroll: (event: TouchEvent) => void;
}

const POINTER_EVENTS = ["pointermove", "pointerup", "pointercancel"] as const;

const ARROWS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

const span = (a: LocalDate, b: LocalDate): DayRun =>
  a <= b ? { from: a, to: b } : { from: b, to: a };

export class DayPicker implements ReactiveController {
  #host: ReactiveControllerHost & HTMLElement;
  #options: DayPickerOptions;
  #run: DayRun | null = null;
  #anchor: LocalDate | null = null;
  #focus: LocalDate | null = null;
  #gesture: Gesture | null = null;
  #swallowClick = false;
  #lastPointerTouch = false;
  /** The run before the first click of a possible double-click, which that click replaced. */
  #runBeforeClick: DayRun | null = null;

  constructor(host: ReactiveControllerHost & HTMLElement, options: DayPickerOptions) {
    this.#host = host;
    this.#options = options;
    host.addController(this);
  }

  get run(): DayRun | null {
    return this.#run;
  }

  get focusDate(): LocalDate | null {
    return this.#focus;
  }

  isPicked(date: LocalDate): boolean {
    return this.#run !== null && this.#run.from <= date && date <= this.#run.to;
  }

  clear(): void {
    this.#anchor = null;
    this.#set(null);
  }

  hostConnected(): void {
    this.#host.addEventListener("focusin", this.#focusin);
  }

  hostDisconnected(): void {
    this.#host.removeEventListener("focusin", this.#focusin);
    this.#end();
  }

  /** Focus reaches the controller through the host, whatever moved it (Tab, a dialog handing
   *  focus back, a click), so the grid's one Tab stop follows it. */
  #focusin = (event: FocusEvent): void => {
    const day = this.#dayOf(event);
    if (day === null) return;
    this.#focus = day.date;
    this.#host.requestUpdate();
  };

  /** The host binds these on the grid element, under the same event names. */
  readonly handlers = {
    pointerdown: (event: PointerEvent) => this.#pointerdown(event),
    click: (event: MouseEvent) => this.#click(event),
    dblclick: (event: MouseEvent) => this.#dblclick(event),
    keydown: (event: KeyboardEvent) => this.#keydown(event),
    contextmenu: (event: MouseEvent) => {
      if (this.#lastPointerTouch && this.#options.canPick()) event.preventDefault();
    },
  };

  #set(run: DayRun | null): void {
    if (run?.from === this.#run?.from && run?.to === this.#run?.to) return;
    this.#run = run;
    this.#options.picked(run);
    this.#host.requestUpdate();
  }

  #pick(anchor: LocalDate, date: LocalDate): void {
    this.#anchor = anchor;
    this.#set(span(anchor, date));
  }

  /** The day an event came from: the nearest element on its path carrying `data-date`. */
  #dayOf(event: Event): { date: LocalDate; button: HTMLElement } | null {
    const cell = event
      .composedPath()
      .find((node): node is HTMLElement => node instanceof HTMLElement && "date" in node.dataset);
    const date = cell?.dataset.date;
    if (date === undefined) return null;
    const button = this.#options.button(date);
    return button === null ? null : { date, button };
  }

  /** Every drawn day's rectangle, read again only after a scroll has moved them. */
  #boxes(gesture: Gesture): { date: LocalDate; box: DOMRect }[] {
    gesture.boxes ??= this.#options.dates().flatMap((date) => {
      const button = this.#options.button(date);
      return button === null ? [] : [{ date, box: button.getBoundingClientRect() }];
    });
    return gesture.boxes;
  }

  #dateAt(gesture: Gesture, x: number, y: number): LocalDate | null {
    return (
      this.#boxes(gesture).find(
        ({ box }) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom,
      )?.date ?? null
    );
  }

  /** The run `open` receives: the picked run when the date is inside it, else that one day. */
  #runToOpen(date: LocalDate, run: DayRun | null): DayRun {
    return run !== null && run.from <= date && date <= run.to ? run : { from: date, to: date };
  }

  #open(date: LocalDate, run: DayRun, trigger: HTMLElement): void {
    if (run.from === run.to) this.#anchor = date;
    this.#set(run);
    this.#options.open?.(date, run, trigger);
  }

  #pointerdown(event: PointerEvent): void {
    this.#swallowClick = false;
    this.#lastPointerTouch = event.pointerType === "touch";
    if (event.button !== 0 || this.#gesture !== null || !this.#options.canPick()) return;
    const day = this.#dayOf(event);
    if (day === null) return;
    const { date, button: trigger } = day;
    const touch = this.#lastPointerTouch && this.#options.dragOnTouch !== true;
    const gesture: Gesture = {
      pointerId: event.pointerId,
      touch,
      grid: event.currentTarget as HTMLElement,
      date,
      last: date,
      boxes: null,
      scrolled: () => {
        gesture.boxes = null;
      },
      trigger,
      x: event.clientX,
      y: event.clientY,
      before: { run: this.#run, anchor: this.#anchor },
      dragging: false,
      held: false,
      movedSinceHold: false,
      timer: undefined,
      stopScroll: (event: TouchEvent) => {
        if (gesture.held || !gesture.touch) event.preventDefault();
      },
    };
    this.#gesture = gesture;
    if (touch) gesture.timer = setTimeout(() => this.#hold(gesture), this.#options.holdMs ?? 500);
    if (this.#lastPointerTouch)
      gesture.grid.addEventListener("touchmove", gesture.stopScroll, { passive: false });
    for (const type of POINTER_EVENTS) window.addEventListener(type, this.#pointer);
    window.addEventListener("scroll", gesture.scrolled, { capture: true, passive: true });
  }

  #hold(gesture: Gesture): void {
    gesture.held = true;
    gesture.timer = undefined;
    if (!this.isPicked(gesture.date)) this.#pick(gesture.date, gesture.date);
  }

  #pointer = (event: PointerEvent): void => {
    const gesture = this.#gesture;
    if (gesture === null || event.pointerId !== gesture.pointerId) return;
    if (event.type === "pointermove") this.#move(gesture, event);
    else if (event.type === "pointerup") this.#release(gesture);
    else this.#cancel(gesture);
  };

  #move(gesture: Gesture, event: PointerEvent): void {
    const far =
      Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= DRAG_THRESHOLD_PX;
    if (gesture.touch && !gesture.held) {
      // The browser takes this finger for a scroll, and ends it with a pointercancel.
      if (far) clearTimeout(gesture.timer);
      return;
    }
    if (!far && !gesture.dragging && !gesture.movedSinceHold) return;
    if (gesture.touch) gesture.movedSinceHold = true;
    else if (!gesture.dragging) {
      gesture.dragging = true;
      capturePointer(gesture.grid, gesture.pointerId);
    }
    gesture.last = this.#dateAt(gesture, event.clientX, event.clientY) ?? gesture.last;
    this.#pick(gesture.date, gesture.last);
  }

  #release(gesture: Gesture): void {
    if (gesture.held) {
      this.#swallowClick = true;
      if (!gesture.movedSinceHold)
        this.#open(
          gesture.date,
          this.#runToOpen(gesture.date, gesture.before.run),
          gesture.trigger,
        );
    } else if (gesture.dragging) {
      this.#swallowClick = true;
    }
    this.#end();
  }

  #cancel(gesture: Gesture): void {
    this.#anchor = gesture.before.anchor;
    this.#set(gesture.before.run);
    this.#end();
  }

  #end(): void {
    const gesture = this.#gesture;
    if (gesture === null) return;
    this.#gesture = null;
    clearTimeout(gesture.timer);
    releasePointer(gesture.grid, gesture.pointerId);
    gesture.grid.removeEventListener("touchmove", gesture.stopScroll);
    for (const type of POINTER_EVENTS) window.removeEventListener(type, this.#pointer);
    window.removeEventListener("scroll", gesture.scrolled, { capture: true });
  }

  #click(event: MouseEvent): void {
    if (this.#swallowClick) {
      this.#swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const day = this.#dayOf(event);
    if (day === null || event.detail > 1) return;
    const { date, button: trigger } = day;
    this.#focus = date;
    this.#runBeforeClick = this.#run;
    if (event.shiftKey && this.#anchor !== null && this.#options.canPick()) {
      this.#pick(this.#anchor, date);
      return;
    }
    this.#pick(date, date);
    this.#options.choose(date, trigger);
  }

  #dblclick(event: MouseEvent): void {
    const day = this.#dayOf(event);
    if (day === null || !this.#options.canPick()) return;
    this.#open(day.date, this.#runToOpen(day.date, this.#runBeforeClick), day.button);
  }

  #keydown(event: KeyboardEvent): void {
    this.#swallowClick = false;
    const day = this.#dayOf(event);
    if (day === null) return;
    const { date } = day;
    const step = ARROWS[event.key];
    if (step !== undefined) {
      event.preventDefault();
      const next = addDays(date, step);
      const button = this.#options.button(next);
      if (button === null) return;
      this.#focus = next;
      button.focus();
      if (event.shiftKey && this.#options.canPick()) this.#pick(this.#anchor ?? date, next);
      else this.#pick(next, next);
      this.#host.requestUpdate();
      return;
    }
    if (event.key === "Enter" && this.#options.canPick() && this.#options.open) {
      event.preventDefault();
      this.#open(date, this.#runToOpen(date, this.#run), day.button);
    }
  }
}
