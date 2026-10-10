import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { partyTablesName } from "@waitron/shared";
import { baseStyles } from "../base-styles.js";
import { DOUBLE_TAP_MS, type GesturePoint, Gestures } from "../gestures.js";
import { type FloorMapDot, type FloorMapFill, floorMapFillStyles } from "../floor-map-fills.js";
import {
  type PlanPlacement,
  type PlanRect,
  bounds,
  cropToTables,
  fitScale,
  showsName,
} from "../floor-plan-geometry.js";

/** A merge's members carry the same `fill`, `dot` and `description`. */
export interface FloorMapTable {
  id: string;
  label: string;
  placement: PlanPlacement;
  fill: FloorMapFill;
  dot: FloorMapDot | null;
  joinId: string | null;
  /** Read after the name: "Seated, 2 ready". */
  description: string;
}

export interface FloorMapCopy {
  /** The tables' group name. */
  label: string;
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

interface Group {
  key: string;
  members: FloorMapTable[];
  box: PlanRect;
}

const DEFAULT_COPY: FloorMapCopy = { label: "Tables" };

const collator = new Intl.Collator(undefined, { numeric: true });

export const mapLabel = (labels: readonly string[]): string => partyTablesName(labels, "+");

function groupsOf(tables: readonly FloorMapTable[]): Group[] {
  const byKey = new Map<string, FloorMapTable[]>();
  for (const table of tables) {
    const key = table.joinId === null ? `table:${table.id}` : `join:${table.joinId}`;
    const members = byKey.get(key);
    if (members) members.push(table);
    else byKey.set(key, [table]);
  }
  return [...byKey].map(([key, members]) => {
    members.sort((a, b) => collator.compare(a.label, b.label));
    return { key, members, box: bounds(members.map((m) => m.placement))! };
  });
}

const px = (value: number): string => `${value}px`;

const tableOf = (target: EventTarget | null): HTMLElement | null =>
  (target as Element | null)?.closest<HTMLElement>("[part=table]") ?? null;

const idOf = (target: EventTarget | null): string | null =>
  tableOf(target)?.dataset["tableId"] ?? null;

/**
 * Draws the placed tables fitted to its box. A merge (tables sharing a `joinId`) is one button,
 * named by `mapLabel`, whose id is its first member's in label order.
 */
@customElement("wt-floor-map")
export class WtFloorMap extends LitElement {
  static override styles = [
    baseStyles,
    floorMapFillStyles,
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

      [part="shape"] {
        position: absolute;
        border: 1px solid var(--wt-color-field-line);
        border-radius: var(--wt-radius-sm);
        pointer-events: auto;
      }

      [part="table"][data-held] [part="shape"] {
        border-color: var(--wt-color-primary);
        box-shadow: inset 0 0 0 1px var(--wt-color-primary);
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

      [part="dot"] {
        position: absolute;
        z-index: 1;
        top: 0;
        right: 0;
        width: var(--wt-space-3);
        height: var(--wt-space-3);
        border: calc(var(--wt-space-1) / 2) solid var(--wt-color-surface);
        border-radius: 50%;
        transform: translate(50%, -50%);
        animation: dot-flash 1s infinite;
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

  #size: { width: number; height: number } | null = null;

  #view: View | null = null;

  #needsFit = true;

  #observer = new ResizeObserver(([entry]) => {
    const size = entry!.contentBoxSize[0]!;
    this.#size = { width: size.inlineSize, height: size.blockSize };
    this.#needsFit = true;
    this.requestUpdate();
  });

  #gestures: Gestures | null = null;

  /** A mouse click on a table, held back DOUBLE_TAP_MS in case a second click makes it a double. */
  #pendingTap: { tableId: string; timer: ReturnType<typeof setTimeout> } | null = null;

  #lastTapId: string | null = null;

  #held: HTMLElement | null = null;

  /** Set by a Shift+F10 keydown, in case the platform follows it with a contextmenu. */
  #swallowContextMenu = false;

  constructor() {
    super();
    this.addEventListener("click", this.#onClick);
    this.addEventListener("contextmenu", this.#onContextMenu);
    this.addEventListener("keydown", this.#onKeyDown);
    this.addEventListener("pointerdown", this.#onPointerDown);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#observer.observe(this);
    this.#gestures = new Gestures(this, {
      tap: this.#onTap,
      doubleTap: this.#onDoubleTap,
      holdStart: (at) => {
        this.#clearHeld();
        this.#held = tableOf(at.target);
        this.#held?.setAttribute("data-held", "");
      },
      longPress: (at) => {
        this.#clearHeld();
        const id = idOf(at.target);
        if (id !== null) this.#send("wt-table-details", id);
      },
      holdDrop: () => this.#clearHeld(),
      cancel: () => this.#clearHeld(),
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#observer.disconnect();
    this.#gestures!.disconnect();
    this.#gestures = null;
    this.#dropPendingTap();
    this.#clearHeld();
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
    if (e.repeat) return;
    this.#swallowContextMenu = false;
    const id = idOf(e.composedPath()[0]!);
    if (e.key !== "F10" || !e.shiftKey || id === null) return;
    e.preventDefault();
    this.#swallowContextMenu = true;
    this.#send("wt-table-details", id);
  };

  /** Never stopped: the till's idle logout listens for pointerdown at its host. */
  readonly #onPointerDown = (): void => {
    this.#swallowContextMenu = false;
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
    if (changed.has("fitKey")) this.#needsFit = true;
    if (!this.#needsFit || this.#size === null) return;
    const crop = cropToTables(this.tables.map((t) => t.placement));
    if (crop === null) return;
    const scale = fitScale(crop, this.#size);
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
      ${
        view === null
          ? nothing
          : repeat(
              groupsOf(this.tables),
              (g) => g.key,
              (g) => this.#renderGroup(g, view, still),
            )
      }
    </div>`;
  }

  #renderGroup(group: Group, view: View, still: boolean): TemplateResult {
    const { box, members } = group;
    const [first] = members as [FloorMapTable, ...FloorMapTable[]];
    const label = mapLabel(members.map((m) => m.label));
    const named = showsName(members.length === 1 ? first.placement : box, view.scale);
    const dot = members.find((m) => m.dot !== null)?.dot ?? null;
    return html`<button
      type="button"
      part="table"
      data-table-id=${first.id}
      data-fill=${first.fill}
      aria-label=${`${label}, ${first.description}`}
      style=${styleMap({
        left: px(view.x + box.x * view.scale),
        top: px(view.y + box.y * view.scale),
        width: px(box.width * view.scale),
        height: px(box.height * view.scale),
      })}
    >
      ${members.map((m) => this.#renderShape(m, box, view.scale))}
      ${named ? html`<span part="name">${label}</span>` : nothing}
      ${
        dot === null ? nothing : html`<span part="dot" data-dot=${dot} ?data-still=${still}></span>`
      }
    </button>`;
  }

  #renderShape(table: FloorMapTable, box: PlanRect, scale: number): TemplateResult {
    const p = table.placement;
    return html`<span
      part="shape"
      data-fill=${table.fill}
      data-shape=${p.shape}
      style=${styleMap({
        left: px((p.x - box.x) * scale),
        top: px((p.y - box.y) * scale),
        width: px(p.width * scale),
        height: px(p.height * scale),
        transform: `rotate(${p.rotation}deg)`,
      })}
    ></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-floor-map": WtFloorMap;
  }
}
