import { css, type CSSResult } from "lit";

export type FloorMapFill = "free" | "seated" | "bill" | "clearing" | "reserved";
export type FloorMapDot = "ready" | "forgotten";

export const FLOOR_MAP_FILLS: readonly FloorMapFill[] = [
  "free",
  "seated",
  "bill",
  "clearing",
  "reserved",
];

/** `[data-fill="<fill>"]` paints background `--wt-color-table-<fill>` and colour `--wt-color-on-table-<fill>`. */
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

  [data-fill="clearing"] {
    background-color: var(--wt-color-table-clearing);
    color: var(--wt-color-on-table-clearing);
  }

  [data-fill="reserved"] {
    background-color: var(--wt-color-table-reserved);
    color: var(--wt-color-on-table-reserved);
  }
`;
