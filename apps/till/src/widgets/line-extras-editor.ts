import { css, html } from "lit";
import "@waitron/ui/src/components/wt-textarea.js";
import { t } from "../i18n/t.js";

/**
 * The free-text kitchen note field, shared by the modifier picker and the basket-line editor. A render
 * helper rather than a custom element: it renders into the host's shadow root, so the host owns the note
 * state and its tests find the field, `[data-test="line-note"]`, in the host's own shadow root.
 */

/** The callback carries the raw field value; the host trims when it commits. */
export interface LineExtrasEditorProps {
  note: string;
  onNoteChange: (note: string) => void;
}

export const lineExtrasEditorStyles = css`
  .line-note {
    margin: 0 0 var(--wt-space-4);
  }
`;

/** `maxlength` matches the server's 200-character note limit. */
export function renderLineExtrasEditor(props: LineExtrasEditorProps) {
  return html`
    <wt-textarea
      class="line-note"
      data-test="line-note"
      name="note"
      label=${t("line.note.label")}
      maxlength="200"
      placeholder=${t("line.note.placeholder")}
      .value=${props.note}
      @wt-change=${(e: CustomEvent<{ value: string }>) => {
        e.stopPropagation();
        props.onNoteChange(e.detail.value);
      }}
    ></wt-textarea>
  `;
}
