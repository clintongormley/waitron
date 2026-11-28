import { html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import type { PlanRect } from "../floor-plan-geometry.js";
import "./wt-placeholder.js";

const px = (value: number): string => `${value}px`;

export function renderFloorPlaceholders(
  placeholders: readonly PlanRect[],
  view: { x: number; y: number; scale: number } | null,
) {
  return html`<div class="map-content" inert aria-hidden="true">
    <div class="plan">
      ${
        view === null
          ? nothing
          : placeholders.map(
              ({ x, y, width, height }) =>
                html` <wt-placeholder
                  style=${styleMap({
                    position: "absolute",
                    left: px(view.x + x * view.scale),
                    top: px(view.y + y * view.scale),
                    width: px(width * view.scale),
                    height: px(height * view.scale),
                  })}
                ></wt-placeholder>`,
            )
      }
    </div>
  </div>`;
}
