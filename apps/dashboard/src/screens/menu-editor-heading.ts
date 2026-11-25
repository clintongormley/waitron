import { css, html, nothing, type TemplateResult } from "lit";
import { t } from "../i18n/t.js";
import { leftToBrowser } from "../navigation.js";

export const menuEditorHeadingStyles = css`
  .heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-1) var(--wt-space-3);
    min-block-size: var(--wt-tap-min);
    margin-bottom: var(--wt-space-4);
  }
  .heading .title {
    display: flex;
    align-items: center;
    min-inline-size: 0;
    gap: var(--wt-space-2);
  }
  .heading h1 {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .heading nav {
    display: flex;
    align-items: center;
    gap: var(--wt-space-1);
    color: var(--wt-color-primary-text);
    flex: none;
  }
  .heading .sep,
  .heading a {
    color: var(--wt-color-primary-text);
  }
  .heading a {
    display: inline-flex;
    align-items: center;
    min-block-size: var(--wt-tap-min);
  }
  .heading-status,
  .heading-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-1) var(--wt-space-3);
  }
  .heading-actions {
    margin-inline-start: auto;
    justify-content: end;
  }
  .heading-status {
    color: var(--wt-color-text-muted);
  }
  .heading-status .time {
    white-space: nowrap;
  }
  .heading-status .unpublished {
    color: var(--wt-color-warning);
  }
  .heading-status .unpublished::before {
    content: "";
    display: inline-block;
    inline-size: var(--wt-space-2);
    block-size: var(--wt-space-2);
    margin-inline-end: var(--wt-space-1);
    border-radius: var(--wt-radius-full);
    background: var(--wt-color-warning);
  }
  @media (max-width: 640px) {
    .heading-status {
      flex-basis: 100%;
    }
  }
`;

export function menuEditorHeading({
  href,
  parent,
  title,
  back,
  help,
  status,
  actions,
}: {
  href: string;
  parent: string;
  title: TemplateResult;
  back: () => void;
  help?: unknown;
  status?: unknown;
  actions?: unknown;
}) {
  return html`<div class="heading">
    <div class="title">
      <nav aria-label=${t("menus.menu_trail")} data-test="menu-breadcrumb">
        <a
          data-test="back"
          href=${href}
          @click=${(event: MouseEvent) => {
            if (leftToBrowser(event)) return;
            event.preventDefault();
            back();
          }}
          >${parent}</a
        ><span class="sep" aria-hidden="true">›</span>
      </nav>
      ${title} ${help ?? nothing}
    </div>
    ${status ? html`<div class="heading-status">${status}</div>` : nothing}
    ${actions && actions !== nothing ? html`<div class="heading-actions">${actions}</div>` : nothing}
  </div>`;
}
