import { css, html, nothing } from "lit";
import type { FloorMapCue, FloorMapFill, FloorMapJob } from "./floor-map-fills.js";

export const captionStyles = css`
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

  /* Clear, left and right, of the thickest outline drawn inside the shape: Overdue's. */
  [part="table"]:has(> [part="shape"][data-outline]) > [part="name"],
  [part="table"]:has(> [part="shape"][data-outline]) > [part="caption"] {
    max-width: calc(100% - 2 * (var(--wt-space-1) + 1px));
  }

  [part="cue"] {
    display: flex;
    align-items: center;
    gap: var(--wt-space-1);
    justify-content: center;
    font-size: var(--wt-font-size-sm);
    text-wrap: nowrap;
    overflow: hidden;
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

  .name-probe {
    position: absolute;
    visibility: hidden;
  }

  [part="job"] {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
    font-size: calc((var(--wt-font-size-sm) + var(--wt-font-size-md)) / 2);
    font-weight: var(--wt-font-weight-bold);
  }

  [part="time"] {
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-bold);
    white-space: nowrap;
  }
`;

export interface CaptionMetrics {
  widthOf: (text: string) => number;
  nameSize: number;
  inset: number;
}

let measuring: CanvasRenderingContext2D | null = null;

export function captionMetrics(root: HTMLElement | DocumentFragment): CaptionMetrics | undefined {
  const probe = root.querySelector(".name-probe");
  if (probe === null) return undefined;
  measuring ??= document.createElement("canvas").getContext("2d");
  if (measuring === null) return undefined;
  const styles = getComputedStyle(probe);
  measuring.font = `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
  return {
    widthOf: (text) => measuring!.measureText(text).width,
    nameSize: Number.parseFloat(styles.fontSize),
    inset: Number.parseFloat(styles.getPropertyValue("--wt-space-1")) || 0,
  };
}

export function renderCaption({
  label,
  shortLabel,
  cue,
  job,
  metrics,
  width,
  height,
  outlined,
  fill,
}: {
  label: string;
  shortLabel?: string | undefined;
  cue: FloorMapCue | null;
  job: FloorMapJob | null;
  metrics?: CaptionMetrics | undefined;
  width: number;
  height: number;
  outlined: boolean;
  fill?: FloorMapFill | undefined;
}) {
  const inset = metrics?.inset ?? 0;
  const space = width - (outlined ? 2 * (inset + 1) : 0) - (fill === undefined ? 0 : 2 * inset);
  const name =
    shortLabel !== undefined && metrics !== undefined && metrics.widthOf(label) > space
      ? shortLabel
      : label;
  if (cue === null) return html`<span part="name" data-fill=${fill ?? nothing}>${name}</span>`;
  const full =
    job !== null && (metrics === undefined || Math.min(width, height) >= metrics.nameSize * 4);
  const compact = job?.compact ?? cue.text;
  return html`<span part="caption" data-fill=${fill ?? nothing}>
    <span part="name">${name}</span>
    ${full ? html`<span part="job">${job.text}</span>${job.time === undefined ? nothing : html`<span part="time">${job.time}</span>`}` : html`<span part="cue">${cue.icon === null || job !== null ? nothing : html`<wt-icon name=${cue.icon} size="sm"></wt-icon>`}${compact === "" ? nothing : html`<span class="cue-text">${compact}</span>`}</span>`}
  </span>`;
}
