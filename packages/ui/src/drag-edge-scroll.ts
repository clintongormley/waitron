type Point = { x: number; y: number };
type Axis = "x" | "y";

function parentOf(element: Element): Element | null {
  // A top-layer surface is painted outside its ancestors' clipping and scroll chain.
  if (element.matches(":modal, :popover-open")) return null;
  const parent = element.parentNode;
  return (
    element.assignedSlot ??
    element.parentElement ??
    (parent instanceof ShadowRoot ? parent.host : null)
  );
}

/** A drag owns this loop and stops it before clearing its drop state. */
export class DragEdgeScroll {
  #origin: Element | null = null;
  #point: Point = { x: 0, y: 0 };
  #axis: Axis = "y";
  #afterScroll!: () => void;
  #frame = 0;

  start(origin: Element, point: Point, afterScroll: () => void, axis: Axis = "y"): void {
    this.stop();
    this.#origin = origin;
    this.#axis = axis;
    this.#afterScroll = afterScroll;
    this.update(point);
  }

  update(point: Point): void {
    this.#point = point;
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = this.#target() ? requestAnimationFrame(this.#tick) : 0;
  }

  stop(): void {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#origin = null;
  }

  #target(): { element: Element; delta: number } | null {
    const origin = this.#origin;
    if (!origin?.isConnected) return null;
    const vertical = this.#axis === "y";
    const point = vertical ? this.#point.y : this.#point.x;
    const cross = vertical ? this.#point.x : this.#point.y;
    const band = Number.parseFloat(getComputedStyle(origin).getPropertyValue("--wt-tap-min")) || 44;
    const ancestors: Element[] = [];
    for (let at: Element | null = origin; at; at = parentOf(at)) ancestors.push(at);
    for (const [index, element] of ancestors.entries()) {
      const page = element === document.scrollingElement;
      const style = getComputedStyle(element);
      const overflow = vertical ? style.overflowY : style.overflowX;
      if (!page && overflow !== "auto" && overflow !== "scroll") continue;
      const position = vertical ? element.scrollTop : element.scrollLeft;
      const limit = vertical
        ? element.scrollHeight - element.clientHeight
        : element.scrollWidth - element.clientWidth;
      if (limit <= 0) continue;
      const rect = element.getBoundingClientRect();
      let start = page
        ? 0
        : vertical
          ? rect.top + element.clientTop
          : rect.left + element.clientLeft;
      let end = page
        ? vertical
          ? window.innerHeight
          : window.innerWidth
        : start + (vertical ? element.clientHeight : element.clientWidth);
      let crossStart = page ? 0 : vertical ? rect.left : rect.top;
      let crossEnd = page
        ? vertical
          ? window.innerWidth
          : window.innerHeight
        : vertical
          ? rect.right
          : rect.bottom;
      for (const clip of ancestors.slice(index + 1)) {
        const clipping = getComputedStyle(clip);
        const bounds = clip.getBoundingClientRect();
        if ((vertical ? clipping.overflowY : clipping.overflowX) !== "visible") {
          start = Math.max(start, vertical ? bounds.top : bounds.left);
          end = Math.min(end, vertical ? bounds.bottom : bounds.right);
        }
        if ((vertical ? clipping.overflowX : clipping.overflowY) !== "visible") {
          crossStart = Math.max(crossStart, vertical ? bounds.left : bounds.top);
          crossEnd = Math.min(crossEnd, vertical ? bounds.right : bounds.bottom);
        }
      }
      start = Math.max(0, start);
      end = Math.min(vertical ? window.innerHeight : window.innerWidth, end);
      if (end <= start || point < start || point > end || cross < crossStart || cross > crossEnd)
        continue;
      const edgeBand = Math.min(band, (end - start) / 2);
      const delta =
        point < start + edgeBand
          ? -16 * (1 - (point - start) / edgeBand)
          : point > end - edgeBand
            ? 16 * (1 - (end - point) / edgeBand)
            : 0;
      if ((delta < 0 && position > 0) || (delta > 0 && position < limit))
        return { element, delta: Math.sign(delta) * Math.max(1, Math.abs(delta)) };
    }
    return null;
  }

  readonly #tick = (): void => {
    this.#frame = 0;
    const target = this.#target();
    if (!target) return;
    if (this.#axis === "y") target.element.scrollTop += target.delta;
    else target.element.scrollLeft += target.delta;
    this.#afterScroll();
    if (!this.#frame && this.#target()) this.#frame = requestAnimationFrame(this.#tick);
  };
}
