import { nothing } from "lit";
import { AsyncDirective, directive, type ElementPart } from "lit/async-directive.js";

/** How a counted name keeps clear of its count once the room on both sides of its first line has
 * left that line empty, most preferred first. */
const FALLBACKS = ["none", "end", "both"] as const;

/**
 * On a counted tile's `.name-start`. The room kept on both sides of the name's first line leaves
 * that line empty when the first word cannot sit inside it, dropping the name below its row's
 * others. The tile's `data-name-room` then names the first fallback that starts the name on its
 * first line with no line under the count or its ring. Placed again when the tile or the count
 * changes size.
 */
class CountedName extends AsyncDirective {
  #start?: HTMLElement;
  /** Kept, because a start the count's end has removed no longer finds its tile. */
  #tile?: HTMLElement;
  #observer?: ResizeObserver;

  render(): typeof nothing {
    return nothing;
  }

  // A tile's template is put in the page after its parts update, so the tile is found later.
  override update(part: ElementPart): typeof nothing {
    this.#start = part.element as HTMLElement;
    queueMicrotask(() => this.#place());
    return this.render();
  }

  protected override disconnected(): void {
    this.#observer?.disconnect();
    this.#observer = undefined;
    this.#tile?.removeAttribute("data-name-room");
  }

  protected override reconnected(): void {
    queueMicrotask(() => this.#place());
  }

  #place() {
    // A placement queued by a render can run after the tile has gone.
    if (!this.#start!.isConnected) return;
    const name = this.#start!.parentElement!;
    const tile = (this.#tile = name.closest<HTMLElement>(".tile")!);
    if (this.#observer === undefined) {
      this.#observer = new ResizeObserver(() => this.#place());
      // The start's width is the room, worked out from the count's width.
      this.#observer.observe(this.#start!);
      this.#observer.observe(tile);
    }
    const count = tile.querySelector(".in-order")!;
    tile.removeAttribute("data-name-room");
    if (fits(name, count)) return;
    for (const fallback of FALLBACKS) {
      tile.setAttribute("data-name-room", fallback);
      if (fits(name, count)) return;
    }
  }
}

/** Whether `name` starts on its first line with no line under `count` or its ring. */
function fits(name: HTMLElement, count: Element): boolean {
  const look = getComputedStyle(name);
  const own = name.getBoundingClientRect();
  const lines = textLines(name, own.right - parseFloat(look.paddingRight));
  // A tile out of the layout, as in a hidden panel, draws no lines.
  if (lines.length === 0) return true;
  if (lines[0]!.top - own.top >= parseFloat(look.fontSize) / 2) return false;
  const ring = parseFloat(look.getPropertyValue("--count-ring"));
  const badge = count.getBoundingClientRect();
  return !lines.some(
    (line) =>
      line.left < badge.right + ring &&
      badge.left - ring < line.right &&
      line.top < badge.bottom + ring &&
      badge.top - ring < line.bottom,
  );
}

/** The lines of `name`'s text the two-line cut leaves shown. Chromium draws a cut line's text as a
 * second, shortened box with the "…" after it, so a cut line is taken to reach `cutEnd`. */
function textLines(name: HTMLElement, cutEnd: number): DOMRect[] {
  const text = [...name.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)!;
  const words = document.createRange();
  words.selectNodeContents(text);
  const bottom = name.getBoundingClientRect().bottom;
  const lines = new Map<number, DOMRect>();
  for (const box of words.getClientRects()) {
    if (box.width === 0 || box.top >= bottom) continue;
    const seen = lines.get(box.top);
    if (seen === undefined) lines.set(box.top, box);
    else {
      const left = Math.min(seen.left, box.left);
      lines.set(box.top, new DOMRect(left, box.top, cutEnd - left, box.height));
    }
  }
  return [...lines.values()];
}

export const countedName = directive(CountedName);
