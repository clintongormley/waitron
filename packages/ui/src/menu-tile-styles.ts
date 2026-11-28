import { css, unsafeCSS, type CSSResult } from "lit";
import { HOME_GRID_COLUMNS, tileFill } from "@waitron/shared";
import { visuallyHiddenStyles } from "./base-styles.js";
import { readableTextColor } from "./category-color.js";

const paints = new Map<string, string>();

/** A painted tile's `style`, `--tile-fill` and a black or white `--tile-ink` for contrast, or
 * undefined for a colour `tileFill` leaves neutral. Worked out once per colour, not on every render
 * of every tile. */
export function menuTilePaint(color: string | null | undefined): string | undefined {
  const fill = tileFill(color);
  if (fill.kind !== "color") return undefined;
  let paint = paints.get(fill.color);
  if (paint === undefined)
    paints.set(
      fill.color,
      (paint = `--tile-fill:${fill.color};--tile-ink:${readableTextColor(fill.color)}`),
    );
  return paint;
}

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
    --count-outside: calc(var(--wt-space-3) / 2);
    --count-ring: var(--wt-menu-count-ring-width);
    padding-block-start: calc(var(--count-outside) + var(--count-ring));
    padding-inline-end: calc(var(--count-outside) + var(--count-ring));
    --menu-tile-height: calc(var(--wt-tap-min) + var(--wt-space-6));
    /* 15 px on a phone, as drawn: no font-size token holds it. The till's side-by-side tiles are
       narrower than drawn, where 15 px would cut a name a tile showing a count holds whole. */
    --menu-name-size: calc((3 * var(--wt-font-size-md) + var(--wt-font-size-lg)) / 4);
  }

  /* A viewport query, not a size container: containment would stop the browser's content counting
     toward the width a screen's layout gives it. */
  @media (width >= 720px) {
    .grid {
      --menu-tile-height: calc(2 * var(--wt-tap-min) - var(--wt-space-1));
      --menu-name-size: var(--wt-font-size-md);
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
  }

  /* A centred column item is as wide as its longest word, so without this a word wider than the
     tile would widen the name past the tile instead of ending in "…". */
  .label > * {
    max-width: 100%;
  }

  /* Two lines at most, so a tile never grows; the whole name stays in the text that screen readers
     and the information window read. A word is never broken: one too wide for a line ends in "…". */
  .name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    text-overflow: ellipsis;
    /* Chromium centres a cut line without its "…", which then reaches up to half its width past
       the line; even room on both sides keeps it inside and the name centred. */
    --name-ellipsis-room: calc(var(--menu-name-size, var(--wt-font-size-md)) / 2);
    padding-inline: var(--name-ellipsis-room);
    font-size: var(--menu-name-size, var(--wt-font-size-md));
    font-weight: var(--wt-font-weight-bold);
  }

  /* With the end padding, the count's reach into the tile, from the width the count publishes,
     beside the first line only; the tile's own padding covers the ring. */
  .tile[data-in-order] .name::before {
    content: "";
    float: inline-end;
    width: max(
      0px,
      var(--count-badge-width, var(--wt-space-5)) - var(--count-outside) - var(--name-ellipsis-room)
    );
    height: 1lh;
  }

  /* Something for the first line to hold, so a first word too wide to sit beside the count starts
     the second line instead of pushing every line below the count. */
  .name-start {
    display: inline-block;
    vertical-align: top;
  }

  /* A set leading, not the font's own, which is taller in some fonts (Noto Sans's is 1.36 of the
     size): a section the diet filter emptied stacks its icon, name and a two-line notice in the
     fixed tile height. */
  .price,
  .kind,
  .sold-out {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
    line-height: 1.2;
  }

  /* 13 px: no font-size token holds it. */
  .price {
    font-size: calc((var(--wt-font-size-sm) + var(--wt-font-size-md)) / 2);
    font-weight: var(--wt-font-weight-medium);
  }

  .tile[data-kind="section"] wt-icon,
  .tile[data-kind="set_menu"] wt-icon {
    width: var(--wt-font-size-xl);
    height: var(--wt-font-size-xl);
    margin-block-end: var(--wt-space-1);
    color: var(--wt-color-text-muted);
  }

  /* An emptied section also stacks a two-line notice, which leaves no room in the tile's fixed
     height for the full-size folder. */
  .tile[data-filtered] wt-icon {
    width: var(--wt-font-size-md);
    height: var(--wt-font-size-md);
    margin-block-end: 0;
  }

  .in-order {
    position: absolute;
    inset-block-start: calc(-1 * var(--count-outside));
    inset-inline-end: calc(-1 * var(--count-outside));
  }

  .in-order::part(badge) {
    box-shadow: 0 0 0 var(--count-ring) var(--wt-color-bg);
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
