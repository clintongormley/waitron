import { css } from "lit";

/**
 * Fades the end of a sideways-scrolling `.edge-fade` strip that `markOverflow` marks as hiding
 * content, across the strip's `--fade-width`.
 */
export const edgeFadeStyles = css`
  .edge-fade {
    --fade-start: 0px;
    --fade-end: 0px;
    --fade-towards: to right;
  }
  .edge-fade:dir(rtl) {
    --fade-towards: to left;
  }
  .edge-fade[data-overflow="start"],
  .edge-fade[data-overflow="both"] {
    --fade-start: var(--fade-width);
  }
  .edge-fade[data-overflow="end"],
  .edge-fade[data-overflow="both"] {
    --fade-end: var(--fade-width);
  }
  /* A mask reads only alpha, and the background token is opaque in every theme. */
  .edge-fade[data-overflow] {
    mask-image: linear-gradient(
      var(--fade-towards),
      transparent 0,
      var(--wt-color-bg) var(--fade-start),
      var(--wt-color-bg) calc(100% - var(--fade-end)),
      transparent 100%
    );
  }
`;

/**
 * Marks which ends of `strip` hide content in its `data-overflow`. Scroll offsets are negative right
 * to left, so the distance from the start is their size. A pixel or less counts as nothing: right to
 * left, Chromium can report a strip scrolled to its far end a pixel short of it when its content's
 * width is not a whole number of pixels.
 */
export function markOverflow(strip: HTMLElement): void {
  const fromStart = Math.abs(strip.scrollLeft);
  const start = fromStart > 1;
  const end = strip.scrollWidth - strip.clientWidth - fromStart > 1;
  const overflow = start && end ? "both" : start ? "start" : end ? "end" : undefined;
  if (overflow) strip.dataset.overflow = overflow;
  else delete strip.dataset.overflow;
}

/** Runs `run` at most once an animation frame, however often `schedule` is called before it. */
export function oncePerFrame(run: () => void): { schedule: () => void; cancel: () => void } {
  let frame: number | undefined;
  return {
    schedule: () => {
      frame ??= requestAnimationFrame(() => {
        frame = undefined;
        run();
      });
    },
    cancel: () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
    },
  };
}
