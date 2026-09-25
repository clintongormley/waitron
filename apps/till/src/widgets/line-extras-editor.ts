import { css, html } from "lit";
import { t } from "../i18n/t.js";

/**
 * The free-text kitchen note field, shared by the modifier picker and the basket-line editor. A render
 * helper rather than a custom element: it renders into the host's shadow root, so the host owns the note
 * state and its tests reach `[data-test="line-note"]` without crossing a nested shadow boundary.
 */

/** The callback carries the raw field value; the host trims when it commits. */
export interface LineExtrasEditorProps {
  note: string;
  onNoteChange: (note: string) => void;
}

export const lineExtrasEditorStyles = css`
  .line-field {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-2);
    margin: 0 0 var(--wt-space-4);
  }

  .line-field-label {
    font-weight: var(--wt-font-weight-bold);
  }

  .line-note {
    min-height: var(--wt-tap-min);
    padding: var(--wt-space-2) var(--wt-space-3);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-surface);
    color: var(--wt-color-text);
    font: inherit;
    resize: vertical;
  }
`;

/** `maxlength` matches the server's 200-character note limit. */
export function renderLineExtrasEditor(props: LineExtrasEditorProps) {
  return html`
    <label class="line-field">
      <span class="line-field-label">${t("line.note.label")}</span>
      <textarea
        class="line-note"
        data-test="line-note"
        maxlength="200"
        placeholder=${t("line.note.placeholder")}
        .value=${props.note}
        @input=${(e: Event) => props.onNoteChange((e.target as HTMLTextAreaElement).value)}
      ></textarea>
    </label>
  `;
}
