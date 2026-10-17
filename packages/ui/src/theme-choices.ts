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
    flex-direction: column;
    gap: var(--wt-space-1);
  }

  .theme-choices-label {
    padding: var(--wt-space-2) var(--wt-space-4) 0;
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }

  /* The same box as a menu's wt-button variant="ghost" align="start". */
  .theme-choice {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--wt-space-2);
    width: 100%;
    min-height: var(--wt-tap-min);
    padding: var(--wt-space-2) var(--wt-space-4);
    border: 1px solid transparent;
    border-radius: var(--wt-radius-md);
    background: transparent;
    color: var(--wt-color-text);
    font: inherit;
    font-weight: var(--wt-font-weight-bold);
    text-align: start;
    cursor: pointer;
  }
  .theme-choice[aria-pressed="true"] {
    border-color: var(--wt-color-border);
  }
  .theme-choice:hover {
    border-color: var(--wt-color-primary-text);
  }
  .theme-choice:focus-visible {
    outline: var(--wt-focus-ring);
    outline-offset: var(--wt-focus-offset);
  }
`;

/**
 * The Theme choices for a person's own menu: a group named by `labels.theme` holding one
 * `aria-pressed` button per choice, `active` the pressed one. It never changes the theme itself:
 * `onPick` decides what a pick means. Its label has a fixed id, so a shadow root holds one at most.
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
          data-test="theme-choice-${choice}"
          @click=${() => onPick(choice)}
        >
          <wt-icon name="theme-${choice}"></wt-icon>${labels[choice]}
        </button>`,
    )}
  </div>`;
}
