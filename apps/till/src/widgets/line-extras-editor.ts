import { css, html } from "lit";
import { t } from "../i18n/t.js";

/**
 * The per-line CUSTOMISATION editor (order-line customisation) — the free-text kitchen note — factored
 * out of the modifier picker so BOTH surfaces that let an operator annotate a line render the SAME field
 * group: the modifier picker (a product WITH option groups) and the basket-line editor (EVERY line,
 * including a plain no-modifier dish fast-added with one tap). Extracting it is what makes the note
 * reachable on every line, not only the ones that open the picker.
 *
 * It is a RENDER HELPER, not a custom element, deliberately: the returned template renders directly into
 * the HOST's shadow root, so each host's own tests keep querying `[data-test="line-note"]` in its shadow
 * root (a child element would hide it behind a nested shadow boundary), and the host keeps ownership of
 * the note state. The host passes the current `note` and a change callback; nothing here holds state.
 */

/** What a host passes to render the editor: the current note and its change callback. The host
 * trims/omits when it commits (the store's `setLineExtras` and the picker's `#confirm` both do), so the
 * callback carries the raw field value. */
export interface LineExtrasEditorProps {
  note: string;
  onNoteChange: (note: string) => void;
}

/** The shared field styles for the note textarea's field group. */
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

/**
 * The free-text note field, capped at 200 chars to match the server's limit, shown for every product. A
 * visible `<label>` wraps the textarea so it carries an accessible name.
 */
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
