import { LitElement, type TemplateResult, css, html, nothing, svg } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { groupStep, partyTablesName } from "@waitron/shared";
import { baseStyles } from "../base-styles.js";
import { DOUBLE_TAP_MS, type GesturePoint, Gestures } from "../gestures.js";
import {
  type FloorMapCue,
  type FloorMapDot,
  type FloorMapFill,
  type FloorMapOutline,
  type FloorMapPulse,
  floorMapFillStyles,
} from "../floor-map-fills.js";
import { floorRingStyles, renderFloorPulse, renderFloorRing } from "../floor-ring.js";
import "../floor-chips.js";
import "./wt-icon.js";
import {
  type PlanPlacement,
  type PlanRect,
  bounds,
  cropToTables,
  fitScale,
  showsCue,
  showsName,
  unionRect,
} from "../floor-plan-geometry.js";

/** A merge's members carry the same `fill`, `outline`, `pulse`, `cue`, `linkId` and `description`. */
export interface FloorMapTable {
  id: string;
  label: string;
  placement: PlanPlacement;
  fill: FloorMapFill;
  dot?: FloorMapDot | null;
  outline?: FloorMapOutline | null;
  pulse?: FloorMapPulse | null;
  /** Drawn under the name on a table big enough for both (`showsCue`). */
  cue?: FloorMapCue | null;
  joinId: string | null;
  /** Today's name when it differs from `label`. */
  name?: string;
  /** The merge's name today; every member carries the same. */
  groupName?: string;
  /** A fixed table is not drawn moved by a drag: a copy follows the finger. Unset is movable. */
  fixed?: boolean;
  /** Groups sharing one are drawn linked by a line and named once: one party at several groups. */
  linkId?: string | null;
  /** Read after the name: "Seated, 2 ready". */
  description: string;
  allergy?: boolean;
}

export interface FloorMapCopy {
  /** The tables' group name. */
  label: string;
  allergy: string;
}

export interface FloorMapTap {
  tableId: string;
}

export interface FloorMapDetails {
  tableId: string;
}

export interface FloorMapDrop {
  tableId: string;
  x: number;
  y: number;
  targetId: string | null;
}

interface View {
  scale: number;
  x: number;
  y: number;
}

/** The last fit: its scale, and the crop's centre in grid squares. */
interface Fit {
  scale: number;
  x: number;
  y: number;
}

/** The held group's first member, drawn moved by whole squares. */
interface Drag {
  tableId: string;
  dx: number;
  dy: number;
  x: number;
  y: number;
  /** The first other table under the pointer at the latest move the map drew. */
  targetId: string | null;
}

/**
 * A drag's travel in squares: `x`, `y` made at earlier scales, plus the pointer's px since
 * (`fromX`, `fromY`) at `scale`. Banked when the scale changes, so a view rescaled mid-drag does
 * not rescale the travel already made.
 */
interface Travel {
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  scale: number;
  /** The last move's px since the press. */
  dx: number;
  dy: number;
}

const MIN_ZOOM = 1 / 2;
const MAX_ZOOM = 4;
const WHEEL_DOUBLING = 100;
const WHEEL_LINE_PX = 16;

interface Group {
  key: string;
  members: FloorMapTable[];
  box: PlanRect;
  /** Its tables' name, or its linked party's. */
  label: string;
  /** False on a linked group after the first. */
  drawsName: boolean;
  fixed: boolean;
}

const DEFAULT_COPY: FloorMapCopy = { label: "Tables", allergy: "Allergy" };

const collator = new Intl.Collator(undefined, { numeric: true });

/** The order the map names a merge's labels in, and so the order a waiter reads them. */
export const inNumberOrder = (a: string, b: string): number => collator.compare(a, b);

export const MAP_SEPARATOR = "+";

/** Names the labels in the order given. */
export const mapLabel = (labels: readonly string[]): string =>
  partyTablesName(labels, MAP_SEPARATOR);

/** A merge's name when it has none for today: its labels in number order, then `mapLabel`. */
export const mergeLabel = (labels: readonly string[]): string =>
  mapLabel([...labels].sort(inNumberOrder));

/** By the top of each box, then its left. */
const readingOrder = (groups: readonly Group[]): Group[] =>
  [...groups].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);

/**
 * How far a span from `start` to `end` moves for a view from 0 to `size`, the least distance. A span
 * that fits moves to lie within it. A wider span covering it already moves nothing; one leaving a
 * gap moves to close it: `start` to 0, or `end` to `size`.
 */
const intoView = (start: number, end: number, size: number): number => {
  if (end - start > size) return start > 0 ? -start : end < size ? size - end : 0;
  return start < 0 ? -start : end > size ? size - end : 0;
};

function groupsOf(tables: readonly FloorMapTable[]): Group[] {
  const byKey = new Map<string, FloorMapTable[]>();
  for (const table of tables) {
    const key = table.joinId === null ? `table:${table.id}` : `join:${table.joinId}`;
    const members = byKey.get(key);
    if (members) members.push(table);
    else byKey.set(key, [table]);
  }
  return [...byKey].map(([key, members]) => {
    members.sort((a, b) => inNumberOrder(a.label, b.label));
    return {
      key,
      members,
      box: bounds(members.map((m) => m.placement))!,
      label: members[0]!.groupName ?? mergeLabel(members.map((m) => m.name ?? m.label)),
      drawsName: true,
      fixed: members.some((m) => m.fixed === true),
    };
  });
}

/** Names each linked party's groups once, on the first; its groups in their first labels' order. */
function linksOf(groups: readonly Group[]): Group[][] {
  const byLink = new Map<string, Group[]>();
  for (const group of groups) {
    const linkId = group.members[0]!.linkId;
    if (linkId === undefined || linkId === null) continue;
    const linked = byLink.get(linkId);
    if (linked) linked.push(group);
    else byLink.set(linkId, [group]);
  }
  const links = [...byLink.values()].filter((linked) => linked.length > 1);
  for (const linked of links) {
    linked.sort((a, b) => inNumberOrder(a.members[0]!.label, b.members[0]!.label));
    const named = linked.some((g) =>
      g.members.some((m) => m.name !== undefined || m.groupName !== undefined),
    );
    const label = named
      ? mapLabel(linked.map((g) => g.label))
      : mergeLabel(linked.flatMap((g) => g.members.map((m) => m.label)));
    for (const group of linked) {
      group.label = label;
      group.drawsName = group === linked[0];
    }
  }
  return links;
}

const px = (value: number): string => `${value}px`;

/** A box's centre in host px, moved by (dx, dy) squares. */
const centreOf = (box: PlanRect, view: View, dx = 0, dy = 0): { x: number; y: number } => ({
  x: view.x + (box.x + dx + box.width / 2) * view.scale,
  y: view.y + (box.y + dy + box.height / 2) * view.scale,
});

/** A wheel's delta in px; `page` is the host's size along the delta's axis. */
const wheelPx = (delta: number, mode: number, page: number): number =>
  mode === WheelEvent.DOM_DELTA_LINE
    ? delta * WHEEL_LINE_PX
    : mode === WheelEvent.DOM_DELTA_PAGE
      ? delta * page
      : delta;

const tableOf = (target: EventTarget | null): HTMLElement | null =>
  (target as Element | null)?.closest<HTMLElement>("[part=table]") ?? null;

const idOf = (target: EventTarget | null): string | null =>
  tableOf(target)?.dataset["tableId"] ?? null;

/**
 * Draws the placed tables fitted to its box. A merge (tables sharing a `joinId`) is one button,
 * named by its own name for today, else `mergeLabel` over its tables' shown names. Its id is its
 * first member's in label order.
 */
@customElement("wt-floor-map")
export class WtFloorMap extends LitElement {
  static override styles = [
    baseStyles,
    floorMapFillStyles,
    floorRingStyles,
    css`
      :host {
        display: block;
        position: relative;
        isolation: isolate;
        overflow: clip;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        background-color: var(--wt-color-surface);
      }

      button[part="table"] {
        position: absolute;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        font: inherit;
        pointer-events: none;
      }

      button[part="table"]:focus-visible {
        z-index: 1;
      }

      [part="shape"] {
        position: absolute;
        border: 1px solid var(--wt-color-field-line);
        border-radius: var(--wt-radius-sm);
        pointer-events: auto;
      }

      [part="shape"][data-outline="clearing"] {
        border: var(--wt-space-1) dashed var(--wt-color-warning);
      }

      [part="table"][data-held] [part="shape"] {
        border-color: var(--wt-color-primary);
        box-shadow: inset 0 0 0 1px var(--wt-color-primary);
      }

      /* Outside the edge, so --wt-focus-offset and not --wt-selected-ring-offset: the seated fill
         is the primary colour itself. */
      [part="table"][data-held]:not([data-merge]) [part="shape"],
      [part="table"][data-held][data-merge],
      [part="table"][data-drop-target]:not([data-merge]) [part="shape"],
      [part="table"][data-drop-target][data-merge] {
        outline: var(--wt-selected-ring);
        outline-offset: var(--wt-focus-offset);
      }

      /* Above every other table, so a moving table is not hidden under the one it is dragged onto
         and a held merge's ring is not cut by a table touching it. */
      [part="table"][data-held] {
        z-index: 1;
      }

      [part="ghost"],
      [part="drag-link"] {
        position: absolute;
        z-index: 3;
        pointer-events: none;
      }

      [part="links"] {
        position: absolute;
        pointer-events: none;
      }

      [part="links"] line {
        stroke: var(--wt-color-field-line);
        stroke-width: 1px;
      }

      [part="ghost"],
      [part="table"][data-moving] {
        opacity: 0.5;
      }

      [part="ghost"] [part="shape"] {
        pointer-events: none;
      }

      [part="drag-link"],
      [part="links"] {
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: visible;
      }

      [part="drag-link"] line {
        stroke: var(--wt-color-primary);
        stroke-width: 1px;
      }

      [part="shape"][data-shape="round"] {
        border-radius: 50%;
      }

      [part="name"] {
        position: relative;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        text-wrap: nowrap;
      }

      /* Positioned, or it paints under the table's own shape. */
      [part="caption"] {
        position: relative;
        display: flex;
        flex-direction: column;
        max-width: 100%;
        overflow: hidden;
        line-height: 1.2;
      }

      [part="cue"] {
        display: flex;
        align-items: center;
        gap: var(--wt-space-1);
        justify-content: center;
        font-size: var(--wt-font-size-sm);
        text-wrap: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* A flex container cuts no text itself: its text's own box carries the ellipsis. */
      [part="cue"] .cue-text {
        overflow: hidden;
        text-overflow: ellipsis;
      }

      [part="cue"] wt-icon {
        flex: none;
        color: inherit;
      }

      /* Painted in the fill, over the seam between a merge's tables. */
      [part="table"][data-merge] > [part="name"],
      [part="table"][data-merge] [part="caption"] {
        padding-inline: var(--wt-space-1);
        border-radius: var(--wt-radius-sm);
      }

      [part="dot"] {
        position: absolute;
        z-index: 2;
        top: 0;
        right: 0;
        width: var(--wt-space-3);
        height: var(--wt-space-3);
        border: calc(var(--wt-space-1) / 2) solid var(--wt-color-surface);
        border-radius: 50%;
        transform: translate(50%, -50%);
        animation: dot-flash 1s infinite;
      }

      [part="allergy"] {
        position: absolute;
        z-index: 2;
        top: 0;
        left: 0;
        display: grid;
        place-items: center;
        width: var(--wt-space-5);
        height: var(--wt-space-5);
        border: calc(var(--wt-space-1) / 2) solid var(--wt-color-surface);
        border-radius: 50%;
        background-color: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
        transform: translate(-50%, -50%);
        pointer-events: none;
      }

      [part="dot"][data-dot="ready"] {
        background-color: var(--wt-color-success);
      }

      [part="dot"][data-dot="forgotten"] {
        background-color: var(--wt-color-danger);
      }

      [part="dot"][data-still] {
        animation: none;
      }

      @keyframes dot-flash {
        50% {
          opacity: 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        [part="dot"] {
          animation: none;
        }
      }
    `,
  ];

  /** The placed tables only. */
  @property({ attribute: false }) tables: FloorMapTable[] = [];

  /** A change fits the view again. */
  @property() fitKey = "";

  @property({ attribute: false }) copy: Partial<FloorMapCopy> = {};

  /** `undefined` reads `prefers-reduced-motion` on every render; a test sets it. */
  @property({ attribute: false }) reducedMotion?: boolean;

  /** Read on each move: off, a held table does not move, though a drag already moved is still sent on release; a long press still works. */
  @property({ attribute: false }) canDrag = true;

  #size: { width: number; height: number } | null = null;

  #view: View | null = null;

  #needsFit = true;

  #fit: Fit | null = null;

  /** Set by a pan, a pinch or the wheel; a resize then keeps the view. */
  #touched = false;

  #drag: Drag | null = null;

  #travel: Travel | null = null;

  #tablesCrop: PlanRect | null = null;

  /** The crops this drag has drawn while the view was untouched, since it started or since
   * `tables` last changed, united, so a drag back inward does not shrink the plan; null until such
   * a drag of a movable group moves. */
  #dragCrop: PlanRect | null = null;

  /** Set by a fit to a drag's crop, cleared by the next fit. Ending a hold then refits an untouched
   * view: the tables' crop can have the same ratio, so no resize would. */
  #fittedToDrag = false;

  #refitFrame = 0;

  /** Built from `tables` when it changes: the groups in `tables`' order, in reading order, and by
   * member id. */
  #groups: Group[] = [];

  #readingOrder: Group[] = [];

  #groupOf = new Map<string, Group>();

  /** Each linked party's groups, in their first labels' order. */
  #links: Group[][] = [];

  /** The host's box, read when a pinch's first move needs it; a pointerdown clears it. */
  #pinchBox: DOMRect | null = null;

  #observer = new ResizeObserver(([entry]) => {
    const size = entry!.contentBoxSize[0]!;
    this.#size = { width: size.inlineSize, height: size.blockSize };
    if (!this.#touched) this.#needsFit = true;
    this.requestUpdate();
  });

  #gestures: Gestures | null = null;

  /** A mouse click on a table, held back DOUBLE_TAP_MS in case a second click makes it a double. */
  #pendingTap: { tableId: string; timer: ReturnType<typeof setTimeout> } | null = null;

  #lastTapId: string | null = null;

  #held: HTMLElement | null = null;

  /** The table last focused; the tab stop while the map draws it. */
  #focusedId: string | null = null;

  /** Set by a Shift+F10 keydown, in case the platform follows it with a contextmenu. */
  #swallowContextMenu = false;

  constructor() {
    super();
    this.addEventListener("click", this.#onClick);
    this.addEventListener("contextmenu", this.#onContextMenu);
    this.addEventListener("keydown", this.#onKeyDown);
    this.addEventListener("pointerdown", this.#onPointerDown);
    this.addEventListener("wheel", this.#onWheel);
  }

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();
    // A listener on the host misses focus moving between two tables, by a press, a script or an
    // arrow key: both ends are inside this shadow root.
    root.addEventListener("focusin", this.#onFocusIn);
    return root;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#observer.observe(this);
    this.#gestures = new Gestures(this, {
      tap: this.#onTap,
      doubleTap: this.#onDoubleTap,
      holdStart: (at) => {
        this.#held = tableOf(at.target);
        this.#held?.setAttribute("data-held", "");
        this.#travel = null;
        cancelAnimationFrame(this.#refitFrame);
      },
      longPress: (at) => {
        this.#endDrag();
        const id = idOf(at.target);
        if (id !== null) this.#send("wt-table-details", id);
      },
      holdDrag: this.#onHoldDrag,
      holdDrop: () => {
        const drag = this.#drag;
        this.#endDrag();
        if (drag !== null) this.#sendDrop(drag);
      },
      cancel: () => this.#endDrag(),
      pan: ({ dx, dy }) => this.#moveView(1, 0, 0, dx, dy),
      pinch: ({ ratio, x, y, dx, dy }) => {
        const box = (this.#pinchBox ??= this.getBoundingClientRect());
        this.#moveView(ratio, x - box.left - dx, y - box.top - dy, dx, dy);
      },
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#observer.disconnect();
    this.#gestures!.disconnect();
    this.#gestures = null;
    this.#dropPendingTap();
    this.#endDrag();
    cancelAnimationFrame(this.#refitFrame);
  }

  readonly #onTap = (at: GesturePoint): void => {
    this.#flushPendingTap();
    const id = idOf(at.target);
    this.#lastTapId = id;
    if (id === null) return;
    if (at.pointerType !== "mouse") {
      this.#send("wt-table-tap", id);
      return;
    }
    this.#pendingTap = { tableId: id, timer: setTimeout(this.#flushPendingTap, DOUBLE_TAP_MS) };
  };

  readonly #onDoubleTap = (at: GesturePoint): void => {
    const id = idOf(at.target);
    if (id === null && this.#lastTapId === null) {
      // At once, so a pan or the wheel before the next render moves the fitted view.
      this.#fitView();
      this.requestUpdate();
      return;
    }
    if (id !== this.#lastTapId) {
      this.#onTap(at);
      return;
    }
    // A touch or pen tap already opened this table; only a mouse's first click is still waiting.
    const pending = this.#pendingTap;
    if (pending === null) return;
    this.#dropPendingTap();
    this.#send("wt-table-details", pending.tableId);
  };

  readonly #flushPendingTap = (): void => {
    const pending = this.#pendingTap;
    this.#dropPendingTap();
    if (pending !== null) this.#send("wt-table-tap", pending.tableId);
  };

  #dropPendingTap(): void {
    clearTimeout(this.#pendingTap?.timer);
    this.#pendingTap = null;
  }

  #clearHeld(): void {
    this.#held?.removeAttribute("data-held");
    this.#held = null;
  }

  #endDrag(): void {
    this.#clearHeld();
    this.#drag = null;
    this.#dragCrop = null;
    if (this.#fittedToDrag) {
      // A frame later: the map's own update from the drop runs before its parent re-renders it.
      cancelAnimationFrame(this.#refitFrame);
      this.#refitFrame = requestAnimationFrame(this.#refitAfterDrag);
    }
    this.requestUpdate();
  }

  readonly #refitAfterDrag = (): void => {
    if (this.#touched) return;
    this.#needsFit = true;
    this.requestUpdate();
  };

  readonly #onHoldDrag = (at: GesturePoint & { dx: number; dy: number }): void => {
    const { dx, dy } = at;
    const id = this.#held?.dataset["tableId"];
    const members = id === undefined ? undefined : this.#groupOf.get(id)?.members;
    const first = members?.find((m) => m.id === id);
    if (first === undefined) return;
    const squares = this.#travelled(dx, dy);
    if (squares === null || !this.canDrag) return;
    // The whole group stays on the grid, as the server holds it when the move lands.
    const { dx: movedX, dy: movedY } = groupStep(
      members!.map((m) => m.placement),
      { x: Math.round(squares.x), y: Math.round(squares.y) },
    );
    const x = first.placement.x + movedX;
    const y = first.placement.y + movedY;
    const targetId = this.#targetAt(at, first.id);
    const drag = this.#drag;
    if (
      drag?.tableId === first.id &&
      drag.x === x &&
      drag.y === y &&
      drag.dx === movedX &&
      drag.dy === movedY &&
      drag.targetId === targetId
    ) {
      return;
    }
    this.#drag = { tableId: first.id, dx: movedX, dy: movedY, x, y, targetId };
    if (!this.#touched) this.#dragCrop = this.#grownCrop(this.#dragCrop);
    this.requestUpdate();
  };

  /** `from`, or the tables' crop, united with the crop of the tables as the drag draws them; null
   * for a fixed group, so its drag never grows the plan. */
  #grownCrop(from: PlanRect | null): PlanRect | null {
    const drag = this.#drag!;
    const group = this.#groupOf.get(drag.tableId)!;
    if (group.fixed) return null;
    const moved = this.tables.map((t) =>
      group.members.includes(t)
        ? { ...t.placement, x: t.placement.x + drag.dx, y: t.placement.y + drag.dy }
        : t.placement,
    );
    return unionRect(from ?? this.#tablesCrop!, cropToTables(moved)!);
  }

  /** What the view fits and the ratio describes: a drag's crop until release, else the tables'. */
  #crop(): PlanRect | null {
    return this.#dragCrop ?? this.#tablesCrop;
  }

  /** Called on every move, even one that moves nothing, or a scale change banks travel at the wrong scale.
   * Null, and nothing banked, while the scale is not above 0, as on a hidden host the map has refitted. */
  #travelled(dx: number, dy: number): { x: number; y: number } | null {
    const scale = this.#view!.scale;
    if (!(scale > 0)) return null;
    const travel = (this.#travel ??= { x: 0, y: 0, fromX: 0, fromY: 0, scale, dx: 0, dy: 0 });
    if (travel.scale !== scale) {
      travel.x += (travel.dx - travel.fromX) / travel.scale;
      travel.y += (travel.dy - travel.fromY) / travel.scale;
      travel.fromX = travel.dx;
      travel.fromY = travel.dy;
      travel.scale = scale;
    }
    travel.dx = dx;
    travel.dy = dy;
    return {
      x: travel.x + (dx - travel.fromX) / scale,
      y: travel.y + (dy - travel.fromY) / scale,
    };
  }

  #targetAt(at: GesturePoint, tableId: string): string | null {
    return (
      this.shadowRoot!.elementsFromPoint(at.x, at.y)
        .map(idOf)
        .find((id) => id !== tableId) ?? null
    );
  }

  /** The drag's target while it still heads a group: the table `data-drop-target` marks, the drag
   * link points at and a release sends. */
  #markedTarget(drag: Drag | null): Group | null {
    const targetId = drag?.targetId ?? null;
    if (targetId === null) return null;
    const group = this.#groupOf.get(targetId);
    return group?.members[0]!.id === targetId ? group : null;
  }

  /** Sends the table `data-drop-target` marks, not the one under the pointer at release: a refit
   * since the last move can make the two differ. */
  #sendDrop(drag: Drag): void {
    this.dispatchEvent(
      new CustomEvent<FloorMapDrop>("wt-table-drag-end", {
        detail: {
          tableId: drag.tableId,
          x: drag.x,
          y: drag.y,
          targetId: this.#markedTarget(drag)?.members[0]!.id ?? null,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Scales the view by `ratio` about (mx, my), host px, then moves it by (dx, dy); the scale stays
   * within MIN_ZOOM to MAX_ZOOM of the fit, and the crop's centre within the host.
   */
  #moveView(ratio: number, mx: number, my: number, dx: number, dy: number): void {
    const view = this.#view;
    if (view === null) return;
    const fit = this.#fit!;
    const scale = Math.min(
      fit.scale * MAX_ZOOM,
      Math.max(fit.scale * MIN_ZOOM, view.scale * ratio),
    );
    const change = scale / view.scale;
    const size = this.#size!;
    const x = mx + dx - (mx - view.x) * change;
    const y = my + dy - (my - view.y) * change;
    this.#view = {
      scale,
      x: Math.min(size.width, Math.max(0, x + fit.x * scale)) - fit.x * scale,
      y: Math.min(size.height, Math.max(0, y + fit.y * scale)) - fit.y * scale,
    };
    this.#touched = true;
    this.requestUpdate();
  }

  readonly #onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const deltaX = wheelPx(e.deltaX, e.deltaMode, this.clientWidth);
    const deltaY = wheelPx(e.deltaY, e.deltaMode, this.clientHeight);
    if (!e.ctrlKey) {
      this.#moveView(1, 0, 0, -deltaX, -deltaY);
      return;
    }
    const box = this.getBoundingClientRect();
    this.#moveView(
      2 ** (-deltaY / WHEEL_DOUBLING),
      e.clientX - box.left,
      e.clientY - box.top,
      0,
      0,
    );
  };

  /** Enter or Space on a focused table; a pointer's own click is left to the gesture. */
  readonly #onClick = (e: MouseEvent): void => {
    const id = idOf(e.composedPath()[0]!);
    if (e.detail !== 0 || id === null) return;
    e.stopPropagation();
    this.#send("wt-table-tap", id);
  };

  readonly #onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const swallow = this.#swallowContextMenu;
    this.#swallowContextMenu = false;
    const id = idOf(e.composedPath()[0]!);
    if (swallow || this.#gestures?.active === true || id === null) return;
    e.stopPropagation();
    this.#send("wt-table-details", id);
  };

  /** Never stopped: the till's idle logout listens for keydown at its host. */
  readonly #onKeyDown = (e: KeyboardEvent): void => {
    const id = idOf(e.composedPath()[0]!);
    const shiftF10 = e.key === "F10" && e.shiftKey;
    // A repeat left unprevented opens the browser's menu again on Linux Chromium.
    if (e.repeat && id !== null && (shiftF10 || e.key === "ContextMenu")) {
      e.preventDefault();
      return;
    }
    this.#swallowContextMenu = false;
    if (id !== null && this.#moveFocus(id, e)) {
      e.preventDefault();
      return;
    }
    if (!shiftF10 || id === null) return;
    e.preventDefault();
    this.#swallowContextMenu = true;
    this.#send("wt-table-details", id);
  };

  /** Focuses the table `key` moves to from `id`; false when `key` is not a move. */
  #moveFocus(id: string, { key, altKey, ctrlKey, metaKey }: KeyboardEvent): boolean {
    // Alt+ArrowLeft is the browser's Back, and Ctrl or Meta with Home or End its own moves.
    if (altKey || ctrlKey || metaKey) return false;
    const order = this.#readingOrder;
    const at = order.findIndex((g) => g.members[0]!.id === id);
    const last = order.length - 1;
    const to = {
      ArrowRight: at + 1,
      ArrowDown: at + 1,
      ArrowLeft: at - 1,
      ArrowUp: at - 1,
      Home: 0,
      End: last,
    }[key];
    if (to === undefined) return false;
    const target = order[Math.min(last, Math.max(0, to))]!;
    this.#panTo(target.box);
    // The map cannot scroll, so a focus left to scroll would scroll the till's tab shell instead.
    this.#buttonOf(target.members[0]!.id).focus({ preventScroll: true });
    return true;
  }

  #panTo(box: PlanRect): void {
    const view = this.#view!;
    const size = this.#size!;
    const left = view.x + box.x * view.scale;
    const top = view.y + box.y * view.scale;
    const dx = intoView(left, left + box.width * view.scale, size.width);
    const dy = intoView(top, top + box.height * view.scale, size.height);
    if (dx !== 0 || dy !== 0) this.#moveView(1, 0, 0, dx, dy);
  }

  #buttonOf(id: string): HTMLElement {
    return this.shadowRoot!.querySelector<HTMLElement>(`[part="table"][data-table-id="${id}"]`)!;
  }

  readonly #onFocusIn = (e: Event): void => {
    const id = idOf(e.composedPath()[0]!);
    if (id === this.#focusedId) return;
    this.#focusedId = id;
    this.requestUpdate();
  };

  /** Never stopped: the till's idle logout listens for pointerdown at its host. */
  readonly #onPointerDown = (): void => {
    this.#swallowContextMenu = false;
    this.#pinchBox = null;
  };

  #send(type: "wt-table-tap" | "wt-table-details", tableId: string): void {
    this.dispatchEvent(
      new CustomEvent<FloorMapTap | FloorMapDetails>(type, {
        detail: { tableId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("tables")) {
      this.#groups = groupsOf(this.tables);
      this.#links = linksOf(this.#groups);
      this.#readingOrder = readingOrder(this.#groups);
      this.#groupOf = new Map(this.#groups.flatMap((g) => g.members.map((m) => [m.id, g])));
      this.#tablesCrop = cropToTables(this.tables.map((t) => t.placement));
      if (this.#held !== null && !this.#groupOf.has(this.#held.dataset["tableId"]!))
        this.#endDrag();
      else if (this.#drag !== null && !this.#touched) this.#dragCrop = this.#grownCrop(null);
    }
    const crop = this.#crop();
    // A host whose CSS reads this is resized when it changes; the observer refits an untouched view.
    this.style.setProperty(
      "--floor-map-ratio",
      String(crop === null ? 1 : crop.width / crop.height),
    );
    if (changed.has("fitKey")) this.#needsFit = true;
    if (this.#needsFit) this.#fitView();
  }

  #fitView(): void {
    if (this.#size === null) return;
    const crop = this.#crop();
    if (crop === null) return;
    const scale = fitScale(crop, this.#size);
    this.#fittedToDrag = this.#dragCrop !== null;
    this.#fit = { scale, x: crop.x + crop.width / 2, y: crop.y + crop.height / 2 };
    this.#touched = false;
    this.#view = {
      scale,
      x: (this.#size.width - crop.width * scale) / 2 - crop.x * scale,
      y: (this.#size.height - crop.height * scale) / 2 - crop.y * scale,
    };
    this.#needsFit = false;
  }

  protected override render(): TemplateResult {
    const view = this.#view;
    const still = this.reducedMotion ?? matchMedia("(prefers-reduced-motion: reduce)").matches;
    return html`<div role="group" aria-label=${{ ...DEFAULT_COPY, ...this.copy }.label}>
      ${view === null ? nothing : this.#renderGroups(view, still)}
    </div>`;
  }

  #renderGroups(view: View, still: boolean): TemplateResult {
    const tabStop =
      (this.#focusedId === null ? undefined : this.#groupOf.get(this.#focusedId)) ??
      this.#readingOrder[0];
    return html`${this.#links.map((linked) => this.#renderLink(linked, view))}${repeat(
      this.#groups,
      (g) => g.key,
      (g) => this.#renderGroup(g, view, still, g === tabStop),
    )}${this.#renderFixedDrag(view)}`;
  }

  #renderGroup(group: Group, view: View, still: boolean, tabStop: boolean): TemplateResult {
    const { box, members, label } = group;
    const [first] = members as [FloorMapTable, ...FloorMapTable[]];
    const merged = members.length > 1;
    const drawn = merged ? box : first.placement;
    const named = group.drawsName && showsName(drawn, view.scale);
    const cue = named && showsCue(drawn, view.scale) ? (first.cue ?? null) : null;
    const drag = this.#drag?.tableId === first.id && !group.fixed ? this.#drag : null;
    const dot = members.find((m) => m.dot != null)?.dot ?? null;
    const allergy = members.some((member) => member.allergy);
    return html`<button
      type="button"
      part="table"
      data-table-id=${first.id}
      data-fill=${first.fill}
      ?data-merge=${merged}
      ?data-drop-target=${this.#markedTarget(this.#drag) === group}
      ?data-moving=${drag !== null}
      tabindex=${tabStop ? 0 : -1}
      aria-label=${[
        label,
        ...(cue === null || cue.text === "" ? [] : [cue.text]),
        first.description,
        ...(allergy ? [this.copy.allergy ?? DEFAULT_COPY.allergy] : []),
      ].join(", ")}
      style=${styleMap({
        left: px(view.x + (box.x + (drag?.dx ?? 0)) * view.scale),
        top: px(view.y + (box.y + (drag?.dy ?? 0)) * view.scale),
        width: px(box.width * view.scale),
        height: px(box.height * view.scale),
      })}
    >
      ${members.map((m) => this.#renderShape(m, box, view.scale, still))}
      ${allergy ? html`<span part="allergy" aria-hidden="true">!</span>` : nothing}
      ${
        cue !== null
          ? html`<span part="caption" data-fill=${merged ? first.fill : nothing}
              ><span part="name">${label}</span>
              <span part="cue"
                >${cue.icon === null ? nothing : html`<wt-icon name=${cue.icon} size="sm"></wt-icon>`}${
                  cue.text === "" ? nothing : html`<span class="cue-text">${cue.text}</span>`
                }</span
              ></span
            >`
          : named
            ? html`<span part="name" data-fill=${merged ? first.fill : nothing}>${label}</span>`
            : nothing
      }
      ${
        dot === null ? nothing : html`<span part="dot" data-dot=${dot} ?data-still=${still}></span>`
      }
    </button>`;
  }

  #renderLink(linked: readonly Group[], view: View): TemplateResult {
    const drag = this.#drag;
    const centres = linked.map((g) =>
      drag?.tableId === g.members[0]!.id && !g.fixed
        ? centreOf(g.box, view, drag.dx, drag.dy)
        : centreOf(g.box, view),
    );
    // `svg`, not `html`: a separate `html` fragment makes an HTML-namespace <line> that draws nothing.
    return html`<svg part="links" aria-hidden="true">
      ${centres
        .slice(1)
        .map(
          (to, i) =>
            svg`<line x1=${centres[i]!.x} y1=${centres[i]!.y} x2=${to.x} y2=${to.y}></line>`,
        )}
    </svg>`;
  }

  /** A fixed group's copy where the drag would put it, and a line to the table marked as the drop
   * target. */
  #renderFixedDrag(view: View): TemplateResult | typeof nothing {
    const drag = this.#drag;
    const group = drag === null ? undefined : this.#groupOf.get(drag.tableId);
    if (!group?.fixed) return nothing;
    const { box, members } = group;
    const target = this.#markedTarget(drag);
    const from = centreOf(box, view);
    const to = target === null ? null : centreOf(target.box, view);
    return html`<span
        part="ghost"
        aria-hidden="true"
        style=${styleMap({
          left: px(view.x + (box.x + drag!.dx) * view.scale),
          top: px(view.y + (box.y + drag!.dy) * view.scale),
          width: px(box.width * view.scale),
          height: px(box.height * view.scale),
        })}
        >${members.map((m) => this.#renderShape(m, box, view.scale, null))}</span
      >${
        to === null
          ? nothing
          : html`<svg part="drag-link" aria-hidden="true">
              <line x1=${from.x} y1=${from.y} x2=${to.x} y2=${to.y}></line>
            </svg>`
      }`;
  }

  /** `still` null draws the fill alone, as a fixed drag's copy does. */
  #renderShape(
    table: FloorMapTable,
    box: PlanRect,
    scale: number,
    still: boolean | null,
  ): TemplateResult {
    const p = table.placement;
    const outline = still === null ? null : (table.outline ?? null);
    return html`<span
      part="shape"
      data-fill=${table.fill}
      data-outline=${outline ?? nothing}
      data-shape=${p.shape}
      style=${styleMap({
        left: px((p.x - box.x) * scale),
        top: px((p.y - box.y) * scale),
        width: px(p.width * scale),
        height: px(p.height * scale),
        transform: `rotate(${p.rotation}deg)`,
      })}
      >${
        outline === "overdue" || outline === "waiting"
          ? renderFloorRing(outline, false, { onFill: true })
          : nothing
      }${still === null ? nothing : renderFloorPulse(table.pulse ?? null, !still)}</span
    >`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-floor-map": WtFloorMap;
  }
}
