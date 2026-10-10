import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { baseStyles } from "../base-styles.js";
import { type PlanRect, cropToTables } from "../floor-plan-geometry.js";
import type { PlanCanvasTable } from "./wt-floor-plan-canvas.js";

export type PreviewTable = Pick<PlanCanvasTable, "key" | "label" | "fixed" | "placement">;

const percent = (part: number, whole: number): string => `${(part / whole) * 100}%`;

/**
 * Read-only: no focus, no events. Positions are percentages of the crop, so the drawing scales with
 * its box and needs no measuring. `--wt-floor-plan-preview-max-height` caps the height; the width
 * shrinks with it to keep the plan's shape.
 */
@customElement("wt-floor-plan-preview")
export class WtFloorPlanPreview extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        --wt-floor-plan-preview-max-height: calc(4 * var(--wt-tap-min));
      }

      .plan {
        position: relative;
        width: min(100%, calc(var(--wt-floor-plan-preview-max-height) * var(--plan-aspect)));
        aspect-ratio: var(--plan-aspect);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
        box-shadow: inset 0 0 0 1px var(--wt-color-border);
      }

      .table {
        position: absolute;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface-lifted);
      }

      .table[data-shape="round"] {
        border-radius: 50%;
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

      /* A circle clips the corner, so the mark sits where the circle still covers it. */
      .table[data-shape="round"] .fixed-marker {
        top: 15%;
        right: 15%;
        border-radius: 50%;
      }
    `,
  ];

  @property({ attribute: false }) tables: PreviewTable[] = [];

  /** The drawing's accessible name. */
  @property() label = "Floor plan";

  override render() {
    const crop = cropToTables(this.tables.map((t) => t.placement));
    if (crop === null) return nothing;
    return html`
      <div
        class="plan"
        part="plan"
        role="img"
        aria-label=${this.label}
        style=${styleMap({ "--plan-aspect": String(crop.width / crop.height) })}
      >
        ${repeat(
          this.tables,
          (t) => t.key,
          (t) => this.#renderTable(t, crop),
        )}
      </div>
    `;
  }

  #renderTable(t: PreviewTable, crop: PlanRect): TemplateResult {
    const p = t.placement;
    const style = styleMap({
      left: percent(p.x - crop.x, crop.width),
      top: percent(p.y - crop.y, crop.height),
      width: percent(p.width, crop.width),
      height: percent(p.height, crop.height),
      transform: `rotate(${p.rotation}deg)`,
    });
    return html`<div
      class="table"
      part="table"
      data-key=${t.key}
      data-shape=${p.shape}
      style=${style}
    >
      ${t.fixed ? html`<span class="fixed-marker" part="fixed-marker"></span>` : nothing}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-floor-plan-preview": WtFloorPlanPreview;
  }
}
