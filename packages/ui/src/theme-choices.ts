import { css, html, type TemplateResult } from "lit";
import { THEME_CHOICES, type ThemeChoice } from "./theme-choice.js";
import type { WtThemeLabels } from "./components/wt-theme-chooser.js";
// Registers the `theme-*` icons the choices draw.
import "./components/wt-theme-chooser.js";
import "./components/wt-icon.js";

/** Styles for `themeChoices`; the host's shadow root must adopt them. */
export const themeChoicesStyles = css`
  .theme-choices {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: var(--wt-space-1);
    padding-inline-start: var(--wt-space-4);
  }

  .theme-choices-label {
    flex: 1;
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }

  .theme-choice {
    box-sizing: border-box;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    min-width: var(--wt-tap-min);
    min-height: var(--wt-tap-min);
    padding: var(--wt-space-2);
    border: 1px solid transparent;
    border-radius: var(--wt-radius-md);
    background: transparent;
    color: var(--wt-color-text);
    cursor: pointer;
  }
  .theme-choice:hover {
    border-color: var(--wt-color-primary-text);
  }
  .theme-choice[aria-pressed="true"] {
    border-color: var(--wt-color-primary);
    background: var(--wt-color-primary);
    color: var(--wt-color-on-primary);
  }
  .theme-choice > wt-icon {
    color: inherit;
  }
  .theme-choice:focus-visible {
    outline: var(--wt-focus-ring);
    outline-offset: var(--wt-focus-offset);
  }
`;

/**
 * Never changes the theme itself: `onPick` decides what a pick means. Its label has a fixed id,
 * so a shadow root holds one at most.
 */
export function themeChoices(options: {
  active: ThemeChoice;
  labels: WtThemeLabels;
  onPick: (choice: ThemeChoice) => void;
}): TemplateResult {
  const { active, labels, onPick } = options;
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
