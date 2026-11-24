import { css } from "lit";
import { visuallyHiddenStyles } from "@waitron/ui";

export const menuTileStyles = css`
  .thumb {
    display: block;
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
    border-radius: var(--wt-radius-sm);
  }

  .section-photo {
    position: relative;
    width: 100%;
  }

  wt-icon.folder-badge {
    position: absolute;
    inset-block-start: var(--wt-space-1);
    inset-inline-start: var(--wt-space-1);
    padding: var(--wt-space-1);
    border-radius: var(--wt-radius-sm);
    background: var(--wt-color-surface-raised);
    color: var(--wt-color-text);
  }

  .section-kind {
    ${visuallyHiddenStyles}
  }

  .tile,
  .slot {
    width: 100%;
  }

  .slot {
    min-height: calc(var(--wt-tap-min) * 1.5);
  }

  .tile::part(button) {
    position: relative;
    height: 100%;
    min-height: calc(var(--wt-tap-min) * 1.5);
    padding: var(--wt-space-2);
  }

  .nutrition-mark {
    position: absolute;
    inset-block-start: var(--wt-space-1);
    inset-inline-end: var(--wt-space-1);
  }
  .tile[data-nutrition] .name {
    padding-inline-end: var(--wt-space-5);
  }

  .in-order {
    position: absolute;
    inset-block-start: var(--wt-space-1);
    inset-inline-start: var(--wt-space-1);
    min-inline-size: var(--wt-space-5);
    block-size: var(--wt-space-5);
    padding-inline: var(--wt-space-1);
    border-radius: var(--wt-radius-full);
    background: var(--wt-color-primary);
    color: var(--wt-color-on-primary);
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-bold);
    line-height: var(--wt-space-5);
    text-align: center;
  }
  /* Room for the badge is kept above the name whether or not the dish is counted, so a tile
   never changes size when its first dish is added and its name stays centred. On a photo the
   badge covers the photo's corner instead. */
  .tile[data-counted]:not(:has(.thumb))::part(button) {
    padding-block-start: calc(var(--wt-space-1) + var(--wt-space-5));
  }
  .in-order-words {
    ${visuallyHiddenStyles}
  }

  .label {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
    text-align: center;
    overflow-wrap: break-word;
  }

  /* A centred column item is as wide as its longest word, so without this a word wider than
   the tile would spill out of it instead of breaking. */
  .label > * {
    max-width: 100%;
  }

  .name {
    font-weight: var(--wt-font-weight-bold);
  }

  .name[lang] {
    hyphens: auto;
    /* No hyphen in a word under 8 letters, so a short word that fits a line stays whole
     (menu-browser.home-columns.test.ts); a longer one can still be hyphenated where it would
     fit on the next line. */
    hyphenate-limit-chars: 8 auto auto;
  }

  .price,
  .kind,
  .sold-out,
  .empty {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }

  .tile[data-painted]::part(button) {
    background: var(--tile-fill);
    border-color: var(--tile-fill);
    color: var(--tile-ink);
  }

  .tile[data-painted]:not([data-sold-out])::part(button):hover:not(:disabled) {
    border-color: var(--tile-ink);
  }

  /* wt-icon sets its own text colour on its host, so it is named here as the labels are. */
  .tile[data-painted] .price,
  .tile[data-painted] .kind,
  .tile[data-painted] .sold-out,
  .tile[data-painted] wt-icon {
    color: inherit;
  }

  /* Sold-out dishes still open information. */
  .tile[data-sold-out]::part(button) {
    opacity: 1;
    background: var(--wt-color-surface-sunken);
    border-color: var(--wt-color-border);
    color: var(--wt-color-text);
  }

  /* Inset shadows take no layout width, so the labels stay centred. The text-coloured line
   under the stripe keeps a stripe close to the tile's own fill visible. */
  .tile[data-sold-out][data-painted]::part(button) {
    box-shadow:
      inset var(--wt-space-1) 0 0 var(--tile-fill),
      inset calc(var(--wt-space-1) + 1px) 0 0 var(--wt-color-text);
  }

  .tile[data-sold-out] .price,
  .tile[data-sold-out] .sold-out {
    color: inherit;
  }
`;
