import { type TemplateResult, css, html } from "lit";
import { t } from "./i18n/t.js";
import type { StringKey } from "./i18n/strings.js";
import type { ProvisionBody } from "./api/client.js";

const MODE_NAMES = {
  demo: "mode_pill.demo",
  prepare: "mode_pill.prepare",
  live: "mode_pill.live",
} as const satisfies Record<ProvisionBody["mode"], StringKey>;

export const modePillStyles = css`
  .mode-pill {
    display: inline-block;
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-full);
    padding: var(--wt-space-1) var(--wt-space-3);
    background: var(--wt-color-surface-raised);
    font-weight: var(--wt-font-weight-bold);
  }
`;

export function modePill(mode: string | undefined, testId: string): TemplateResult {
  const label =
    mode === undefined
      ? "—"
      : Object.hasOwn(MODE_NAMES, mode)
        ? t(MODE_NAMES[mode as keyof typeof MODE_NAMES])
        : mode;
  return html`<span class="mode-pill" data-test=${testId}>${label}</span>`;
}
