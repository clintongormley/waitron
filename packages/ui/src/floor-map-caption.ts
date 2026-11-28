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

  [part="name"][data-wrap] {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-height: 1.2;
    overflow-wrap: anywhere;
    text-wrap: var(--wt-floor-map-name-wrap, nowrap);
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
  [part="table"]:has(> [part="shape"][data-outline]) > [part="caption"]:not([data-job]) {
    max-width: calc(100% - 2 * (var(--wt-space-1) + 1px));
  }

  [part="table"]:has(> [part="allergy"]) > [part="caption"] {
    margin-block-start: var(--wt-space-3);
    max-block-size: calc(100% - var(--wt-space-3));
  }

  [part="caption"][data-job] {
    max-width: calc(100% - 2 * (var(--wt-space-2) + var(--wt-space-1) / 2));
  }

  :is([part="caption"][data-compact], .name-probe, .job-probe) {
    line-height: 1.05;
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

  .name-probe,
  .job-probe {
    position: absolute;
    visibility: hidden;
    inline-size: var(--wt-font-size-sm);
  }

  [part="cue"].whole-cue,
  [part="job"],
  .job-probe {
    font-size: calc((var(--wt-font-size-sm) + var(--wt-font-size-md)) / 2);
    font-weight: var(--wt-font-weight-bold);
  }

  [part="job"] {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }

  [part="time"] {
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-bold);
    text-wrap: nowrap;
  }
`;

export interface CaptionMetrics {
  widthOf: (text: string) => number;
  jobWidthOf: (text: string) => number;
  fitsJob: (text: string, width: number) => boolean;
  nameSize: number;
  compactHeight: number;
  badgeSpace: number;
  inset: number;
  jobInset: number;
  cueIconSpace: number;
}

let measuring: CanvasRenderingContext2D | null = null;

export function captionMetrics(root: HTMLElement | DocumentFragment): CaptionMetrics | undefined {
  const name = root.querySelector(".name-probe");
  const job = root.querySelector(".job-probe");
  if (name === null || job === null) return undefined;
  measuring ??= document.createElement("canvas").getContext("2d");
  const canvas = measuring;
  if (canvas === null) return undefined;
  const styles = getComputedStyle(name);
  const fontFor = ({ fontWeight, fontSize, fontFamily }: CSSStyleDeclaration) =>
    `${fontWeight} ${fontSize} ${fontFamily}`;
  const nameFont = fontFor(styles);
  const jobStyle = getComputedStyle(job);
  const jobFont = fontFor(jobStyle);
  const jobWidthOf = (text: string) => {
    canvas.font = jobFont;
    return canvas.measureText(text).width;
  };
  const inset = Number.parseFloat(styles.getPropertyValue("--wt-space-1")) || 0;
  return {
    widthOf: (text) => {
      canvas.font = nameFont;
      return canvas.measureText(text).width;
    },
    jobWidthOf,
    fitsJob: (text, width) => {
      if (jobWidthOf(text) <= width) return true;
      for (const { index, 0: gap } of text.matchAll(/\s+/g)) {
        if (canvas.measureText(text.slice(0, index)).width > width) return false;
        if (canvas.measureText(text.slice(index + gap.length)).width <= width) return true;
      }
      return false;
    },
    nameSize: Number.parseFloat(styles.fontSize),
    compactHeight: Number.parseFloat(styles.lineHeight) + Number.parseFloat(jobStyle.lineHeight),
    badgeSpace: Number.parseFloat(styles.getPropertyValue("--wt-space-3")) || 0,
    inset,
    jobInset: (Number.parseFloat(styles.getPropertyValue("--wt-space-2")) || 0) + inset / 2,
    cueIconSpace: Number.parseFloat(jobStyle.inlineSize) + inset,
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
  allergy,
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
  allergy: boolean;
  outlined: boolean;
  fill?: FloorMapFill | undefined;
}) {
  const inset = metrics?.inset ?? 0;
  const space = width - (outlined ? 2 * (inset + 1) : 0) - (fill === undefined ? 0 : 2 * inset);
  const captionHeight = height - (allergy ? (metrics?.badgeSpace ?? 0) : 0);
  const jobSpace = width - 2 * ((metrics?.jobInset ?? 0) + (fill === undefined ? 0 : inset));
  const full =
    job !== null &&
    (metrics === undefined ||
      (captionHeight >= metrics.nameSize * 4 &&
        metrics.fitsJob(job.text, jobSpace) &&
        (job.time === undefined || metrics.jobWidthOf(job.time) <= jobSpace)));
  const compact =
    job?.compactTime === undefined ? job?.compact : `${job.compact} ${job.compactTime}`;
  const showCompact =
    compact !== undefined &&
    (metrics === undefined ||
      (captionHeight >= metrics.compactHeight && metrics.jobWidthOf(compact) <= jobSpace));
  const nameSpace = cue !== null && (full || showCompact) ? jobSpace : space;
  const fullWidth = shortLabel === undefined ? 0 : (metrics?.widthOf(label) ?? 0);
  const name =
    shortLabel !== undefined &&
    metrics !== undefined &&
    fullWidth > nameSpace &&
    metrics.widthOf(shortLabel) < fullWidth
      ? shortLabel
      : label;
  if (cue === null || (job !== null && !full && !showCompact)) {
    const wrap = !allergy && metrics !== undefined && height >= metrics.nameSize * 2.4;
    return {
      name,
      content: html`<span part="name" data-fill=${fill ?? nothing} ?data-wrap=${wrap}
        >${name}</span
      >`,
    };
  }
  const showCueText =
    cue.text !== "" &&
    (!cue.keepTextWhole ||
      metrics === undefined ||
      metrics.jobWidthOf(cue.text) + (cue.icon === null ? 0 : metrics.cueIconSpace) <= space);
  const detail = full
    ? html`<span part="job">${job.text}</span
        >${job.time === undefined ? nothing : html`<span part="time">${job.time}</span>`}`
    : job === null
      ? html`<span part="cue" class=${cue.keepTextWhole ? "whole-cue" : nothing}
          >${cue.icon === null ? nothing : html`<wt-icon name=${cue.icon} size="sm"></wt-icon>`}${showCueText ? html`<span class="cue-text">${cue.text}</span>` : nothing}</span
        >`
      : html`<span part="cue" class="whole-cue">${compact}</span>`;
  return {
    name,
    content: html`<span
      part="caption"
      data-fill=${fill ?? nothing}
      ?data-job=${job !== null}
      ?data-compact=${job !== null && !full}
    >
      <span part="name">${name}</span> ${detail}
    </span>`,
  };
}
