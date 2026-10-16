import { css, html, nothing, type TemplateResult } from "lit";

/** A media query cannot read a custom property, so this repeats DRAWER_BREAKPOINT's literal. */
export const settingsCardStyles = css`
  .settings-card {
    background: var(--wt-color-surface);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-lg);
    padding: var(--wt-space-5);
    margin: 0 0 var(--wt-space-4);
    min-width: 0;
  }
  .settings-card[data-editing] {
    border-color: var(--wt-color-primary);
  }
  .settings-card > header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--wt-space-2) var(--wt-space-3);
    margin: 0 0 var(--wt-space-4);
  }
  .settings-card > header h2 {
    margin: 0;
    font-size: var(--wt-font-size-lg);
    font-weight: var(--wt-font-weight-bold);
  }
  .settings-rows {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    gap: var(--wt-space-3) var(--wt-space-4);
    margin: 0;
  }
  .settings-rows dt {
    color: var(--wt-color-text-muted);
  }
  .settings-rows dd {
    margin: 0;
    color: var(--wt-color-text);
    overflow-wrap: anywhere;
  }
  @media (max-width: 48rem) {
    .settings-rows {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--wt-space-1);
    }
    .settings-rows dd {
      margin: 0 0 var(--wt-space-2);
    }
  }
`;

export interface SettingsCardOptions {
  id: string;
  heading: string;
  action: TemplateResult | typeof nothing;
  editing: boolean;
  body: TemplateResult | typeof nothing;
  dataTest?: string;
}

export function settingsCard({
  id,
  heading,
  action,
  editing,
  body,
  dataTest,
}: SettingsCardOptions): TemplateResult {
  return html`<section
    class="settings-card"
    aria-labelledby=${id}
    ?data-editing=${editing}
    data-test=${dataTest ?? nothing}
  >
    <header>
      <h2 id=${id}>${heading}</h2>
      ${action}
    </header>
    ${body}
  </section>`;
}

export interface SettingsRow {
  label: string;
  value: TemplateResult | TemplateResult[] | string;
  dataTest: string;
}

export function settingsRows(rows: readonly SettingsRow[]): TemplateResult {
  return html`<dl class="settings-rows">
    ${rows.map(
      (row) =>
        html`<dt>${row.label}</dt>
          <dd data-test=${row.dataTest}>${row.value}</dd>`,
    )}
  </dl>`;
}
