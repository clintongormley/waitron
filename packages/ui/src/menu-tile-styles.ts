import { css, unsafeCSS, type CSSResult } from "lit";
import { HOME_GRID_COLUMNS } from "@waitron/shared";
import { visuallyHiddenStyles } from "./base-styles.js";

/**
 * The menu's tiles as the till draws them, shared with the dashboard's Device home preview. A tile is a `.tile` (a `wt-button`, or a `div` where it is not a
 * control) holding a `.label`; `[data-painted]` fills it from `--tile-fill` and `--tile-ink`.
 */
export const menuTileStyles: CSSResult = css`
  /* Room at the top and end for a count drawn outside a tile's corner, so a scroller never clips it. */
  .grid {
    display: grid;
    gap: var(--wt-space-2);
    grid-template-columns: ${unsafeCSS(HOME_GRID_COLUMNS)};
    padding-block-start: var(--wt-space-2);
    padding-inline-end: var(--wt-space-2);
    --menu-tile-height: calc(var(--wt-tap-min) + var(--wt-space-6));
  }

  /* A viewport query, not a size container: containment would stop the browser's content counting
     toward the width a screen's layout gives it. */
  @media (width >= 720px) {
    .grid {
      --menu-tile-height: calc(2 * var(--wt-tap-min) - var(--wt-space-1));
    }
  }

  .section-kind {
    ${visuallyHiddenStyles}
  }

  .tile,
  .slot {
    width: 100%;
    min-height: var(--menu-tile-height);
  }

  .tile {
    position: relative;
  }

  .tile::part(button),
  div.tile {
    height: 100%;
    min-height: var(--menu-tile-height);
    padding: var(--wt-space-1);
  }

  div.tile {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-surface);
    color: var(--wt-color-text);
  }

  .label {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
    text-align: center;
    overflow-wrap: break-word;
  }

  /* A centred column item is as wide as its longest word, so without this a word wider than the
     tile would spill out of it instead of breaking. */
  .label > * {
    max-width: 100%;
  }

  /* Two lines at most, so a tile never grows and its corner count never covers the name; the whole
     name stays in the text that screen readers and the information window read. */
  .name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    --name-ellipsis-room: calc(var(--wt-font-size-md) / 2);
    padding-inline-start: var(--name-ellipsis-room);
    font-size: var(--wt-font-size-md);
    font-weight: var(--wt-font-weight-bold);
  }

  /* Chromium centres a cut line without its "…", which then reaches up to half its width past the
     line; this strip and the start padding keep it inside (end padding would count as overflow). */
  .name::before {
    content: "";
    float: inline-end;
    width: var(--name-ellipsis-room);
    height: 100vh;
  }

  /* The count's reach into the tile (its width less the part drawn outside), on both sides so the
     name stays centred. */
  .tile[data-in-order] .name {
    --name-count-room: calc(var(--wt-space-5) - var(--wt-space-3) / 2);
    padding-inline: calc(var(--name-count-room) + var(--name-ellipsis-room)) var(--name-count-room);
  }

  .name[lang] {
    hyphens: auto;
    /* No hyphen in a word under 8 letters, so a short word that fits a line stays whole; a longer
       one can still be hyphenated where it would fit on the next line. */
    hyphenate-limit-chars: 8 auto auto;
  }

  .price,
  .kind,
  .sold-out {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }

  .tile[data-kind="section"] wt-icon,
  .tile[data-kind="set_menu"] wt-icon {
    color: var(--wt-color-text-muted);
  }

  .in-order {
    position: absolute;
    inset-block-start: calc(var(--wt-space-3) / -2);
    inset-inline-end: calc(var(--wt-space-3) / -2);
  }

  .in-order::part(badge) {
    box-shadow: 0 0 0 2px var(--wt-color-bg);
  }

  .in-order-words {
    ${visuallyHiddenStyles}
  }

  div.tile[data-painted],
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

  /* Inset shadows take no layout width, so the labels stay centred. The text-coloured line under
     the stripe keeps a stripe close to the tile's own fill visible. */
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
