import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { baseStyles } from "../base-styles.js";
import {
  GRID_SQUARE_PX,
  type PlanPlacement,
  gridExtent,
  showsName,
} from "../floor-plan-geometry.js";

export interface PlanCanvasTable {
  key: string;
  label: string;
  fixed: boolean;
  placement: PlanPlacement;
}

export interface FloorPlanCanvasCopy {
  label: string;
  fixed: string;
  /** "{name}" is replaced by the table's label. */
  rotate: string;
}

export interface TableSelect {
  key: string | null;
}

export interface TableMove {
  key: string;
  x: number;
  y: number;
}

export interface TableRotate {
  key: string;
  rotation: number;
}

const DEFAULT_COPY: FloorPlanCanvasCopy = {
  label: "Floor plan",
  fixed: "Fixed",
  rotate: "Rotate {name}",
};

const px = (squares: number): string => `${squares * GRID_SQUARE_PX}px`;

/**
 * Controlled: it never changes `tables` or `selected`, only asks through `wt-table-select`; the
 * parent sets `selected`. Tables are drawn at the plan's true size, so a small one is smaller than
 * `--wt-tap-min`.
 */
@customElement("wt-floor-plan-canvas")
export class WtFloorPlanCanvas extends LitElement {
  static override shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .viewport {
        width: 100%;
        height: 100%;
        overflow: auto;
      }

      .grid {
        position: relative;
        background-color: var(--wt-color-surface);
        background-image:
          linear-gradient(to right, var(--wt-color-border) 1px, transparent 1px),
          linear-gradient(to bottom, var(--wt-color-border) 1px, transparent 1px);
      }

      .table {
        position: absolute;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0;
        padding: 0;
        overflow: hidden;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface-lifted);
        color: var(--wt-color-text);
        font: inherit;
        font-size: var(--wt-font-size-sm);
        cursor: pointer;
      }

      .table[data-shape="round"] {
        border-radius: 50%;
      }

      .table[aria-pressed="true"] {
        border-color: var(--wt-color-primary);
        box-shadow: inset 0 0 0 1px var(--wt-color-primary);
      }

      .name {
        overflow: hidden;
        text-overflow: ellipsis;
        text-wrap: nowrap;
      }

      .fixed-marker {
        position: absolute;
        top: 0;
        right: 0;
        width: var(--wt-space-2);
        height: var(--wt-space-2);
        border-bottom-left-radius: var(--wt-radius-sm);
        background: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) tables: PlanCanvasTable[] = [];

  @property() selected: string | null = null;

  @property({ attribute: false }) copy: Partial<FloorPlanCanvasCopy> = {};

  @state() private visible = { columns: 0, rows: 0 };

  #observer = new ResizeObserver(([entry]) => {
    const size = entry!.borderBoxSize[0]!;
    this.visible = {
      columns: Math.ceil(size.inlineSize / GRID_SQUARE_PX),
      rows: Math.ceil(size.blockSize / GRID_SQUARE_PX),
    };
  });

  get #copy(): FloorPlanCanvasCopy {
    return { ...DEFAULT_COPY, ...this.copy };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.updateComplete.then(() =>
      this.#observer.observe(this.renderRoot.querySelector(".viewport")!),
    );
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#observer.disconnect();
  }

  override render(): TemplateResult {
    const copy = this.#copy;
    const extent = gridExtent(
      this.tables.map((t) => t.placement),
      this.visible,
    );
    const gridStyle = styleMap({
      width: px(extent.columns),
      height: px(extent.rows),
      backgroundSize: `${px(1)} ${px(1)}`,
    });
    return html`
      <div class="viewport" part="viewport">
        <div
          class="grid"
          part="grid"
          role="group"
          aria-label=${copy.label}
          style=${gridStyle}
          @click=${this.#onGridClick}
        >
          ${this.tables.map((t) => this.#renderTable(t, copy))}
        </div>
      </div>
    `;
  }

  #renderTable(t: PlanCanvasTable, copy: FloorPlanCanvasCopy): TemplateResult {
    const p = t.placement;
    const style = styleMap({
      left: px(p.x),
      top: px(p.y),
      width: px(p.width),
      height: px(p.height),
      transform: `rotate(${p.rotation}deg)`,
    });
    return html`
      <button
        type="button"
        class="table"
        part="table"
        data-key=${t.key}
        data-shape=${p.shape}
        aria-pressed=${t.key === this.selected ? "true" : "false"}
        aria-label=${t.fixed ? `${t.label}, ${copy.fixed}` : t.label}
        style=${style}
        @click=${(e: Event) => this.#onTableClick(e, t.key)}
      >
        ${showsName(p, GRID_SQUARE_PX) ? html`<span class="name">${t.label}</span>` : nothing}
        ${t.fixed ? html`<span class="fixed-marker" part="fixed-marker"></span>` : nothing}
      </button>
    `;
  }

  #onTableClick(e: Event, key: string): void {
    e.stopPropagation();
    this.#select(key);
  }

  readonly #onGridClick = (e: Event): void => {
    e.stopPropagation();
    this.#select(null);
  };

  #select(key: string | null): void {
    const detail: TableSelect = { key };
    this.dispatchEvent(
      new CustomEvent("wt-table-select", { detail, bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-floor-plan-canvas": WtFloorPlanCanvas;
  }
}
