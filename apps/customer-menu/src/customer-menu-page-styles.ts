import { baseStyles } from "@waitron/ui/src/base-styles.js";
import { css } from "lit";

export const customerMenuPageStyles = [
  baseStyles,
  css`
    :host {
      display: block;
      container-type: inline-size;
    }
    article {
      --menu-padding: var(--wt-space-4);
      background: var(--wt-color-bg);
      color: var(--wt-color-text);
      font-family: var(--wt-font-family);
      font-size: var(--wt-font-size-md);
      padding: var(--menu-padding);
      border: 1px solid var(--wt-color-border);
      border-radius: var(--wt-radius-lg);
      overflow-wrap: anywhere;
    }
    :host([standalone]) article {
      min-block-size: 100dvb;
      padding-inline: max(var(--menu-padding), calc((100% - 1040px) / 2));
      border: 0;
      border-radius: 0;
    }
    header {
      display: grid;
      gap: var(--wt-space-3);
    }
    header .menu-title {
      margin: 0;
      font-size: calc(1.65 * var(--wt-font-size-xl));
    }
    .title-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--wt-space-2);
    }
    search {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--wt-space-2);
    }
    .filter-button {
      --wt-action-radius: var(--wt-radius-full);
    }
    .filter-fields {
      display: grid;
      gap: var(--wt-space-3);
    }
    .filter-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: var(--wt-space-2);
    }
    .choice-caution {
      grid-column: 1 / -1;
      font-size: var(--wt-font-size-sm);
    }
    wt-input::part(field) {
      border-radius: var(--wt-radius-full);
      background: var(--wt-color-surface);
    }
    nav {
      position: sticky;
      inset-block-start: 0;
      z-index: 1;
      display: flex;
      gap: var(--wt-space-4);
      overflow-x: auto;
      margin: var(--wt-space-2) 0 var(--wt-space-4);
      border-block-end: 1px solid var(--wt-color-border);
      background: var(--wt-color-bg);
    }
    nav a {
      flex: none;
      max-inline-size: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding-block: var(--wt-space-3);
      border-block-end: 3px solid transparent;
      color: var(--wt-color-text-muted);
      text-decoration: none;
    }
    nav a[aria-current] {
      border-block-end-color: var(--wt-color-primary);
      color: var(--wt-color-primary-text);
      font-weight: var(--wt-font-weight-bold);
    }
    @media (forced-colors: active) {
      nav a {
        border-block-end-color: Canvas;
      }
      nav a[aria-current] {
        border-block-end-color: Highlight;
      }
    }
    nav a:focus-visible {
      outline: var(--wt-focus-ring);
      outline-offset: calc(-1 * var(--wt-focus-offset));
    }
    .no-results {
      margin-block-start: calc(var(--wt-space-2) + var(--wt-space-3));
    }
    header + [role="status"] + .members {
      margin-block-start: var(--wt-space-4);
    }
    .menu-title,
    .section-title {
      margin: 0 0 var(--wt-space-4);
      color: var(--wt-color-primary-text);
      font-weight: var(--wt-font-weight-bold);
    }
    .section-title {
      font-size: calc(1.4 * var(--wt-font-size-lg));
    }
    .subheading {
      font-size: var(--wt-font-size-lg);
    }
    section section > .section-title {
      font-size: var(--wt-font-size-md);
    }
    .members {
      display: grid;
      gap: var(--wt-space-5);
    }
    section,
    .set-menu {
      grid-column: 1 / -1;
    }
    .set-menu {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--wt-space-2);
      padding: var(--wt-space-4);
      border: 1px solid var(--wt-color-primary);
      border-radius: var(--wt-radius-md);
      background: var(--wt-color-surface);
    }
    .set-menu .set-price {
      white-space: nowrap;
    }
    .dish {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-content: start;
      align-items: start;
      gap: var(--wt-space-3);
    }
    .entry-name,
    .set-price {
      font-size: var(--wt-font-size-lg);
      font-weight: var(--wt-font-weight-bold);
    }
    .entry-name {
      background: transparent;
      border: 0;
      padding: 0;
      font-family: inherit;
      color: inherit;
      text-align: start;
      cursor: pointer;
    }
    .entry-name:hover,
    .entry-name:focus-visible {
      text-decoration: underline;
    }
    .entry-name:focus-visible {
      outline: var(--wt-focus-ring);
      outline-offset: var(--wt-focus-offset);
    }
    .back {
      --wt-action-text: var(--wt-color-primary-text);
      --wt-action-radius: var(--wt-radius-full);
    }
    .back[variant="ghost"] {
      /* Align the inset chevron with the title and leave room inside the hover outline. */
      --wt-button-padding-inline: var(--wt-space-2);
      margin-inline-start: calc(-1 * var(--wt-space-3));
    }
    img {
      display: block;
      inline-size: min(84px, 24cqi);
      aspect-ratio: 1;
      object-fit: cover;
      border-radius: var(--wt-radius-md);
      background: var(--wt-color-field-fill);
    }
    :host([photos="small"]) .dish img {
      inline-size: min(60px, 18cqi);
      aspect-ratio: 1;
    }
    .detail-lead:has(img) {
      position: relative;
      margin-block-start: calc(-1 * var(--menu-padding));
      margin-inline: calc(-1 * var(--menu-padding));
      margin-block-end: var(--wt-space-4);
    }
    .detail-lead:has(img) .back {
      position: absolute;
      inset-block-start: var(--menu-padding);
      inset-inline-start: var(--menu-padding);
    }
    .detail-lead img {
      inline-size: 100%;
      max-block-size: 320px;
      aspect-ratio: 4 / 3;
      border-radius: calc(var(--wt-radius-lg) - 1px) calc(var(--wt-radius-lg) - 1px) 0 0;
    }
    :host([standalone]) .detail-lead img {
      border-radius: 0;
    }
    :host([photos="small"]) .detail-lead img {
      max-block-size: 160px;
    }
    .detail .menu-title {
      font-size: calc(1.4 * var(--wt-font-size-xl));
      margin-block-end: var(--wt-space-1);
    }
    .detail .set-price {
      margin: 0;
    }
    .detail .subheading {
      margin: var(--wt-space-4) 0 var(--wt-space-2);
      color: var(--wt-color-primary-text);
    }
    .description,
    .declarations,
    .dish .declarations wt-icon {
      color: var(--wt-color-text-muted);
    }
    .description,
    .price,
    .choices {
      margin: var(--wt-space-1) 0 0;
    }
    .declarations,
    .declarations > span,
    .key li {
      display: inline-flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--wt-space-1);
    }
    .detail .declarations {
      column-gap: var(--wt-space-2);
    }
    .detail div.declarations {
      column-gap: var(--wt-space-4);
    }
    .detail .declarations wt-icon[name^="allergen-"] {
      color: inherit;
    }
    .choices .declarations {
      margin-inline-start: var(--wt-space-1);
      vertical-align: text-bottom;
    }
    .choices {
      padding: 0;
      list-style: none;
    }
    .choices li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      column-gap: var(--wt-space-3);
      padding-block: var(--wt-space-2);
      border-block-end: 1px solid var(--wt-color-border);
    }
    .choices .description {
      grid-column: 1;
    }
    .choice-price {
      text-align: end;
    }
    footer {
      border-block-start: 1px solid var(--wt-color-border);
      margin-block-start: var(--wt-space-5);
      padding-block-start: var(--wt-space-3);
    }
    .key {
      display: flex;
      flex-wrap: wrap;
      gap: var(--wt-space-2) var(--wt-space-4);
      padding: 0;
    }
    @container (min-width: 640px) {
      article {
        --menu-padding: var(--wt-space-6);
      }
      header {
        grid-template-columns: minmax(0, 1fr) minmax(320px, 44%);
        align-items: center;
      }
      .members {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .dish {
        grid-template-columns: minmax(0, 1fr);
      }
      .dish-heading {
        display: flex;
        flex-wrap: wrap;
        column-gap: var(--wt-space-2);
        align-items: baseline;
      }
      .dish-name {
        flex: 1 1 50%;
      }
      .dish-heading > .price {
        margin-block-start: 0;
        margin-inline-start: auto;
        font-size: var(--wt-font-size-lg);
        text-align: end;
      }
      .dish-heading > .description {
        flex-basis: 100%;
        order: 1;
      }
      img {
        grid-row: 1;
        inline-size: 100%;
        aspect-ratio: 4 / 3;
      }
    }
  `,
];
