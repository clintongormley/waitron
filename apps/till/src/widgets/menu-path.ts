import { css, html, type TemplateResult } from "lit";
import { t } from "../i18n/t.js";

export interface MenuPathStep {
  name: string;
  open: () => void;
}

export const menuPathStyles = css`
  .breadcrumb {
    /* 15 px, then 16 px from 720 px: no font-size token holds either. */
    --wt-action-font-size: calc((3 * var(--wt-font-size-md) + var(--wt-font-size-lg)) / 4);
    font-size: var(--wt-action-font-size);
    font-weight: var(--wt-font-weight-bold);
  }

  @media (width >= 720px) {
    .breadcrumb {
      --wt-action-font-size: calc((var(--wt-font-size-md) + var(--wt-font-size-lg)) / 2);
    }
  }

  .breadcrumb[inert] {
    opacity: var(--wt-opacity-disabled);
  }

  .breadcrumb ol {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .breadcrumb li {
    display: flex;
    align-items: center;
    gap: var(--wt-space-1);
    overflow-wrap: anywhere;
  }

  .breadcrumb wt-button {
    --wt-action-text: var(--wt-color-primary-text);
    --wt-button-padding-inline: var(--wt-space-2);
  }

  .breadcrumb [aria-current] {
    display: flex;
    align-items: center;
    min-block-size: var(--wt-tap-min);
    padding-inline: var(--wt-space-2);
    color: var(--wt-color-text);
  }

  .breadcrumb .sep {
    color: var(--wt-color-text-muted);
    font-weight: var(--wt-font-weight-normal);
  }
`;

/** Home as an icon, the sections on the way, then the section being shown, which is not a step. */
export function menuPath(
  home: () => void,
  earlier: readonly MenuPathStep[],
  current: string,
  inert: boolean,
): TemplateResult {
  const separator = html`<span class="sep" aria-hidden="true">›</span>`;
  return html`<nav class="breadcrumb" aria-label=${t("menu.breadcrumb")} ?inert=${inert}>
    <ol>
      <li>
        <wt-button
          variant="ghost"
          icon="home"
          aria-label=${t("menu.home")}
          @click=${home}
        ></wt-button>
        ${separator}
      </li>
      ${earlier.map(
        (step) =>
          html`<li>
            <wt-button variant="ghost" @click=${step.open}>${step.name}</wt-button>${separator}
          </li>`,
      )}
      <li><span aria-current="location">${current}</span></li>
    </ol>
  </nav>`;
}
