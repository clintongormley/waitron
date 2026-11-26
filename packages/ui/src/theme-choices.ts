import { css, html, type TemplateResult } from "lit";
import { THEME_CHOICES, type ThemeChoice } from "./theme-choice.js";
import type { WtThemeLabels } from "./components/wt-theme-chooser.js";
// Registers the `theme-*` icons the choices draw.
import "./components/wt-theme-chooser.js";
import "./components/wt-icon.js";

/** Styles for `themeChoices`; the host's shadow root must adopt them. */
export const themeChoicesStyles = css`
  .theme-choices {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--wt-space-1);
    padding-inline: var(--wt-space-3);
  }

  .theme-choices-label {
    grid-column: 1 / -1;
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }

  .theme-choice {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--wt-space-1);
    min-width: var(--wt-tap-min);
    min-height: var(--wt-tap-min);
    padding: var(--wt-space-1);
    border: var(--wt-field-line-width) solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: transparent;
    color: var(--wt-color-text);
    font: inherit;
    font-size: var(--wt-font-size-sm);
    cursor: pointer;
  }
  .theme-choice:hover {
    border-color: var(--wt-color-primary-text);
  }
  .theme-choice[aria-pressed="true"] {
    border-color: var(--wt-color-primary);
    background: var(--wt-color-surface-lifted);
  }
  .theme-choice > wt-icon {
    color: inherit;
    flex: none;
  }
  .theme-choice:focus-visible {
    outline: var(--wt-focus-ring);
    outline-offset: var(--wt-focus-offset);
  }
  @media (forced-colors: active) {
    .theme-choice[aria-pressed="true"] {
      border-color: Highlight;
    }
  }
`;

/**
 * Never changes the theme itself: `onPick` decides what a pick means. Its label has a fixed id,
 * so a shadow root holds one at most.
 */
export function themeChoices(options: {
  active: ThemeChoice;
  labels: WtThemeLabels;
  shortDeviceLabel: string;
  onPick: (choice: ThemeChoice) => void;
}): TemplateResult {
  const { active, labels, onPick, shortDeviceLabel } = options;
  return html`<div
    class="theme-choices"
    role="group"
    aria-labelledby="theme-choices-label"
    data-test="theme-choices"
  >
    <span id="theme-choices-label" class="theme-choices-label">${labels.theme}</span>
    ${THEME_CHOICES.map(
      (choice) =>
        html`<button
          type="button"
          class="theme-choice"
          aria-pressed=${String(choice === active)}
          aria-label=${labels[choice]}
          data-test="theme-choice-${choice}"
          @click=${() => onPick(choice)}
        >
          <wt-icon name="theme-${choice}"></wt-icon>
          ${choice === "device" ? shortDeviceLabel : labels[choice]}
        </button>`,
    )}
  </div>`;
}

/** Lit compares `.labels` by identity, so a fresh object every render redraws the chooser. */
export function themeLabelsPerLocale(
  build: () => WtThemeLabels,
): (locale: string) => WtThemeLabels {
  let built: { locale: string; labels: WtThemeLabels } | undefined;
  return (locale) => {
    if (built?.locale !== locale) built = { locale, labels: build() };
    return built.labels;
  };
}
