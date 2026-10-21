import { css, type CSSResult } from "lit";
import type { FloorCueIcon } from "./floor-chips.js";
import type { FloorPulse } from "./floor-ring.js";

export const FLOOR_MAP_FILLS = [
  "free",
  "seated",
  "bill",
  "reserved",
  "calm",
  "ready",
  "danger",
  "warning",
  "plain",
] as const;
export type FloorMapFill = (typeof FLOOR_MAP_FILLS)[number];
export type FloorMapOutline = "overdue" | "waiting" | "clearing";
export type FloorMapPulse = FloorPulse;
export interface FloorMapCue {
  icon: FloorCueIcon | null;
  text: string;
}

export const floorMapFillStyles: CSSResult = css`
  [data-fill="free"] {
    background-color: var(--wt-color-table-free);
    color: var(--wt-color-on-table-free);
  }

  [data-fill="seated"] {
    background-color: var(--wt-color-table-seated);
    color: var(--wt-color-on-table-seated);
  }

  [data-fill="bill"] {
    background-color: var(--wt-color-table-bill);
    color: var(--wt-color-on-table-bill);
  }

  [data-fill="reserved"] {
    background-color: var(--wt-color-table-reserved);
    color: var(--wt-color-on-table-reserved);
  }

  [data-fill="calm"] {
    background-color: var(--wt-color-table-calm);
    color: var(--wt-color-on-table-calm);
  }

  [data-fill="ready"] {
    background-color: var(--wt-color-success);
    color: var(--wt-color-on-success);
  }

  [data-fill="danger"] {
    background-color: var(--wt-color-danger);
    color: var(--wt-color-on-danger);
  }

  [data-fill="warning"] {
    background-color: var(--wt-color-warning);
    color: var(--wt-color-on-warning);
  }

  [data-fill="plain"] {
    background-color: var(--wt-color-surface);
    color: var(--wt-color-text);
  }
`;
