import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { partyTablesName } from "@waitron/shared";
import { baseStyles } from "../base-styles.js";
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

  override connectedCallback(): void {
    super.connectedCallback();
    this.#observer.observe(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#observer.disconnect();
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
