import { css, nothing, type CSSResult } from "lit";
import { AsyncDirective, directive, type ElementPart } from "lit/async-directive.js";
import { visuallyHiddenStyles } from "@waitron/ui";
import { oncePerFrame } from "./edge-fade.js";

/**
 * A counted dish tile's count, outside the tile's top end corner, and the room its name keeps for
 * it, added to the shared `menuTileStyles`. Unless `data-name-room` says otherwise, the name keeps
 * the count's reach into the tile clear on both sides of its first line, so that line stays centred.
 */
export const countedNameStyles: CSSResult = css`
  /* With the end padding, the count's reach into the tile; the tile's own padding covers the ring.
     The count's width is set by countedName, at a count's narrowest until then. */
  .tile[data-in-order] .name {
    --name-count-room: max(
      0px,
      var(--count-badge-width, var(--wt-space-5)) - var(--count-outside) - var(--name-ellipsis-room)
    );
  }

  .tile[data-in-order]:is(:not([data-name-room]), [data-name-room="end"]) .name::before {
    content: "";
    float: inline-end;
    width: var(--name-count-room);
    height: 1lh;
  }

  /* Being something for the first line to hold, a first word too wide to sit beside the count
     starts the second line instead of pushing every line below the count. */
  .name-start {
    display: inline-block;
    vertical-align: top;
    width: var(--name-count-room);
  }

  /* "none": no room; "end": the room at the first line's end only; "both": the room on both sides
     of every line. */
  .tile[data-name-room] .name-start {
    position: absolute;
  }

  .tile[data-name-room="both"] .name {
    padding-inline: calc(var(--name-ellipsis-room) + var(--name-count-room));
  }

  .in-order {
    position: absolute;
    inset-block-start: calc(-1 * var(--count-outside));
    inset-inline-end: calc(-1 * var(--count-outside));
  }

  .in-order::part(badge) {
    box-shadow: 0 0 0 var(--count-ring) var(--wt-color-bg);
  }

  .in-order-words {
    ${visuallyHiddenStyles}
  }
`;

/** A tile's `data-name-room`, most preferred first; `undefined` leaves it unset. */
const ROOMS = [undefined, "none", "end", "both"] as const;
type Room = (typeof ROOMS)[number];

/** Each directive due a placement at the next frame, and whether it may keep a room that still
 * fits rather than try every room again. */
const due = new Map<CountedName, boolean>();
const frame = oncePerFrame(placeDue);
/** The tile and count each directive watches, with their sizes as it last measured them. */
const watched = new WeakMap<Element, { by: CountedName; width: number; height: number }>();
let observer: ResizeObserver | undefined;

function placeLater(name: CountedName, keep: boolean): void {
  due.set(name, keep && (due.get(name) ?? true));
  frame.schedule();
}

function resized(entries: ResizeObserverEntry[]): void {
  for (const entry of entries) {
    const seen = watched.get(entry.target);
    const [size] = entry.borderBoxSize;
    if (seen === undefined || size === undefined) continue;
    if (seen.width !== size.inlineSize || seen.height !== size.blockSize)
      placeLater(seen.by, false);
  }
}

/** Every tile and count is read first; then each round writes every tile still trying a room before
 * reading them all, so the page is laid out once per round rather than once per tile. */
function placeDue(): void {
  const placements = [...due].flatMap(([name, keep]) => name.placement(keep) ?? []);
  due.clear();
  let trying = placements;
  while (trying.length > 0) {
    for (const placement of trying) placement.write();
    trying = trying.filter((placement) => !placement.fits() && placement.next());
  }
}

/** One tile's search for the first room that keeps its name on its first line and clear of its
 * count. */
class Placement {
  readonly #name: HTMLElement;
  readonly #tile: HTMLElement;
  readonly #count: DOMRect;
  readonly #countWidth: string;
  readonly #ring: number;
  readonly #fontSize: number;
  #rooms: Room[];

  constructor(
    name: HTMLElement,
    tile: HTMLElement,
    count: DOMRect,
    countWidth: string,
    rooms: Room[],
  ) {
    this.#name = name;
    this.#tile = tile;
    this.#count = count;
    this.#countWidth = countWidth;
    const look = getComputedStyle(name);
    this.#ring = parseFloat(look.getPropertyValue("--count-ring"));
    this.#fontSize = parseFloat(look.fontSize);
    this.#rooms = rooms;
  }

  write(): void {
    const name = this.#name.style;
    if (name.getPropertyValue("--count-badge-width") !== this.#countWidth)
      name.setProperty("--count-badge-width", this.#countWidth);
    const room = this.#rooms[0];
    if ((this.#tile.getAttribute("data-name-room") ?? undefined) === room) return;
    if (room === undefined) this.#tile.removeAttribute("data-name-room");
    else this.#tile.setAttribute("data-name-room", room);
  }

  /** Moves to the next room, or leaves the last one tried in place when none is left. */
  next(): boolean {
    this.#rooms.shift();
    return this.#rooms.length > 0;
  }

  /** Whether the name starts on its first line with no line under the count or its ring. */
  fits(): boolean {
    const name = this.#name;
    const look = getComputedStyle(name);
    const own = name.getBoundingClientRect();
    const lines = textLines(name, own.right - parseFloat(look.paddingRight));
    // A tile out of the layout, as in a hidden panel, draws no lines.
    if (lines.length === 0) return true;
    if (lines[0]!.top - own.top >= this.#fontSize / 2) return false;
    const ring = this.#ring;
    const count = this.#count;
    return !lines.some(
      (line) =>
        line.left < count.right + ring &&
        count.left - ring < line.right &&
        line.top < count.bottom + ring &&
        count.top - ring < line.bottom,
    );
  }
}

/**
 * On a counted tile's `.name-start`. Where the room kept on both sides of the name's first line
 * leaves that line empty, or puts a line under the count or its ring, sets the tile's
 * `data-name-room` to the first of `none`, `end` and `both` that does neither; when none does,
 * `both` stays. Placed at the next frame, never while a ResizeObserver is delivering, and again
 * when the tile or the count changes size; a redraw keeps a room that still fits while the count's
 * width and the name's text and language are unchanged, since a redraw can give the tile another
 * dish.
 */
class CountedName extends AsyncDirective {
  #start?: HTMLElement;
  /** Kept, because a start the count's end has removed no longer finds its name or tile. */
  #name?: HTMLElement;
  #tile?: HTMLElement;
  #count?: Element;
  /** The name's language and text its room was chosen for. */
  #placedFor?: string;

  render(): typeof nothing {
    return nothing;
  }

  override update(part: ElementPart): typeof nothing {
    this.#start = part.element as HTMLElement;
    placeLater(this, true);
    return this.render();
  }

  protected override disconnected(): void {
    due.delete(this);
    if (due.size === 0) frame.cancel();
    this.#name?.style.removeProperty("--count-badge-width");
    this.#tile?.removeAttribute("data-name-room");
    for (const element of [this.#tile, this.#count]) {
      if (element === undefined) continue;
      observer?.unobserve(element);
      watched.delete(element);
    }
    this.#name = this.#tile = this.#count = this.#placedFor = undefined;
  }

  protected override reconnected(): void {
    placeLater(this, false);
  }

  /** Reads the count's box, so call it before any placement of this frame writes. */
  placement(keep: boolean): Placement | undefined {
    // A placement queued by a render can run after the tile has gone.
    if (!this.#start?.isConnected) return undefined;
    const placed = this.#name !== undefined;
    const name = (this.#name = this.#start.parentElement!);
    const tile = (this.#tile = name.closest<HTMLElement>(".tile")!);
    const count = tile.querySelector(".in-order")!;
    if (count !== this.#count) {
      if (this.#count !== undefined) observer?.unobserve(this.#count);
      observer ??= new ResizeObserver(resized);
      if (!placed) observer.observe(tile);
      observer.observe((this.#count = count));
    }
    const countBox = count.getBoundingClientRect();
    const tileBox = tile.getBoundingClientRect();
    watched.set(tile, { by: this, width: tileBox.width, height: tileBox.height });
    watched.set(count, { by: this, width: countBox.width, height: countBox.height });
    const current = (tile.getAttribute("data-name-room") ?? undefined) as Room;
    const countWidth = `${countBox.width}px`;
    const placedFor = `${name.lang}\n${name.textContent}`;
    let rooms: Room[] = [...ROOMS];
    if (
      keep &&
      placed &&
      placedFor === this.#placedFor &&
      name.style.getPropertyValue("--count-badge-width") === countWidth
    ) {
      const rest = ROOMS.filter((room) => room !== current);
      rooms = current === "both" ? [current, ...rest, "both"] : [current, ...rest];
    }
    this.#placedFor = placedFor;
    return new Placement(name, tile, countBox, countWidth, rooms);
  }
}

/** The lines of `name`'s text the two-line cut leaves shown, each as wide as its text. A line cut
 * with "…", which Chromium draws as a second, shortened box of the line's text with the "…" after
 * it, is taken to reach `cutEnd`: the last shown line of a name with more text than it shows, and
 * a line whose text runs past `cutEnd`. */
function textLines(name: HTMLElement, cutEnd: number): DOMRect[] {
  const text = [...name.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
  // Lit draws an empty name as no text at all.
  if (text === undefined) return [];
  const words = document.createRange();
  words.selectNodeContents(text);
  const bottom = name.getBoundingClientRect().bottom;
  const lines = new Map<number, { left: number; right: number; height: number }>();
  for (const box of words.getClientRects()) {
    if (box.width === 0 || box.top >= bottom) continue;
    const seen = lines.get(box.top);
    lines.set(
      box.top,
      seen === undefined
        ? { left: box.left, right: box.right, height: box.height }
        : {
            left: Math.min(seen.left, box.left),
            right: Math.max(seen.right, box.right),
            height: Math.max(seen.height, box.height),
          },
    );
  }
  const shown = [...lines];
  const clamped = name.scrollHeight > name.clientHeight;
  return shown.map(([top, line], index) => {
    const right = clamped && index === shown.length - 1 ? cutEnd : Math.min(line.right, cutEnd);
    return new DOMRect(line.left, top, Math.max(0, right - line.left), line.height);
  });
}

export const countedName = directive(CountedName);
