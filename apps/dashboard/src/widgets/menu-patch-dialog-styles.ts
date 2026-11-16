import { css } from "lit";
import { baseStyles, visuallyHiddenStyles } from "@waitron/ui";

export const menuPatchDialogStyles = [
  baseStyles,
  css`
    .layout {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: var(--wt-space-5);
    }
    wt-modal[wide-edit]::part(body) {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .layout.wide {
      flex: 1;
      min-height: 0;
      flex-wrap: nowrap;
      align-items: stretch;
    }
    .wide .side {
      grid-template-rows: auto minmax(0, 1fr);
    }
    .wide nav {
      min-height: 0;
      max-block-size: none;
    }
    .wide .form {
      overflow: auto;
      align-content: start;
      scrollbar-gutter: stable;
      /* Keep keyboard rings and help badges inside the scrolling box. */
      padding: var(--wt-space-2) calc(var(--wt-help-badge-target) / 2);
      scroll-padding: var(--wt-space-2);
      margin-block: calc(-1 * var(--wt-space-2));
      margin-inline: calc(-1 * var(--wt-help-badge-target) / 2);
    }
    .side {
      display: grid;
      gap: var(--wt-space-3);
      flex: 1 1 calc(var(--wt-field-max-width) / 2);
      min-width: 0;
    }
    .form {
      display: grid;
      gap: var(--wt-space-4);
      flex: 2 1 var(--wt-field-max-width);
      min-width: 0;
      /* Scrolled to with its heading focused, whose focus ring would otherwise sit on the
           scrolling area's edge and lose its top line. */
      scroll-margin-block-start: var(--wt-space-2);
    }
    h3 {
      margin: 0;
      font-size: var(--wt-font-size-lg);
    }
    h4 {
      margin: 0;
      font-size: var(--wt-font-size-md);
    }
    ul {
      list-style: none;
      margin: 0;
      padding-inline-start: var(--wt-space-4);
    }
    nav > ul {
      padding-inline-start: 0;
    }
    nav {
      max-block-size: calc(var(--wt-tap-min) * 12);
      overflow: auto;
      scrollbar-gutter: stable;
      /* Room for a row's focus ring, which the scrolling box would otherwise clip, also when a
           row is scrolled to its edge. */
      padding: var(--wt-space-1);
      scroll-padding: var(--wt-space-1);
      margin-inline: calc(-1 * var(--wt-space-1));
    }
    .group {
      display: block;
      padding: var(--wt-space-2);
      color: var(--wt-color-text-muted);
      font-weight: var(--wt-font-weight-medium);
    }
    .node,
    .link {
      display: flex;
      align-items: center;
      gap: var(--wt-space-2);
      min-height: var(--wt-tap-min);
      padding: 0 var(--wt-space-2);
      border: 0;
      border-radius: var(--wt-radius-sm);
      background: none;
      color: var(--wt-color-text);
      font: inherit;
      text-align: start;
      cursor: pointer;
    }
    .node {
      width: 100%;
    }
    .node[aria-current="true"] {
      background: var(--wt-color-surface-sunken);
      font-weight: var(--wt-font-weight-bold);
    }
    .link {
      color: var(--wt-color-primary-text);
      text-decoration: underline;
    }
    .variant {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      column-gap: var(--wt-space-2);
    }
    .variant-values {
      color: var(--wt-color-text-muted);
    }
    .dot {
      flex: none;
      width: var(--wt-space-2);
      height: var(--wt-space-2);
      border-radius: var(--wt-radius-full);
      background: var(--wt-color-primary);
    }
    .flag {
      color: var(--wt-color-danger);
      font-weight: var(--wt-font-weight-bold);
    }
    .hidden {
      ${visuallyHiddenStyles}
    }
    .note,
    .message {
      margin: 0;
      color: var(--wt-color-text-muted);
    }
    .locked {
      display: grid;
      gap: var(--wt-space-1);
    }
    .locked-note {
      margin: 0;
      color: var(--wt-color-text-muted);
      font-size: var(--wt-font-size-sm);
    }
    .review {
      display: grid;
      gap: var(--wt-space-3);
    }
    .changes {
      display: grid;
      gap: var(--wt-space-2);
      padding-inline-start: var(--wt-space-5);
      list-style: disc;
    }
    .error {
      display: grid;
      justify-items: start;
      gap: var(--wt-space-3);
      margin: 0;
      color: var(--wt-color-danger);
    }
  `,
];
