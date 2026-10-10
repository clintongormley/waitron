import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { baseStyles } from "../base-styles.js";
import { type PlanRect, cropToTables } from "../floor-plan-geometry.js";
import { floorPlanTableStyles } from "../floor-plan-table-styles.js";
import type { PlanCanvasTable } from "./wt-floor-plan-canvas.js";

export type PreviewTable = Pick<PlanCanvasTable, "key" | "fixed" | "placement">;

const percent = (part: number, whole: number): string => `${(part / whole) * 100}%`;

/**
 * Positions are percentages of the crop, so the drawing scales with its box and needs no measuring.
 * `--wt-floor-plan-preview-max-height` caps the height; the width shrinks with it to keep the
 * plan's shape.
 */
@customElement("wt-floor-plan-preview")
export class WtFloorPlanPreview extends LitElement {
  static override styles = [
    baseStyles,
    floorPlanTableStyles,
    css`
      :host {
        display: block;
      }

      .plan {
        position: relative;
        width: min(100%, calc(var(--wt-floor-plan-preview-max-height) * var(--plan-aspect)));
        aspect-ratio: var(--plan-aspect);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
        box-shadow: inset 0 0 0 1px var(--wt-color-border);
      }
    `,
  ];

  @property({ attribute: false }) tables: PreviewTable[] = [];

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
