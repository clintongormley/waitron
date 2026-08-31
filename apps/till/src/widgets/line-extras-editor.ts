import { css, html, nothing } from "lit";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import type { Doneness, TillProduct } from "../api/client.js";

/**
 * The per-line CUSTOMISATION editor (order-line customisation) — the free-text kitchen note plus the
 * meat-gated doneness `<select>` — factored out of the modifier picker so BOTH surfaces that let an
 * operator annotate a line render the SAME field group: the modifier picker (a product WITH option
 * groups) and the basket-line editor (EVERY line, including a plain no-modifier dish fast-added with one
 * tap). Extracting it is what makes the note/doneness reachable on every line, not only the ones that
 * open the picker.
 *
 * It is a RENDER HELPER, not a custom element, deliberately: the returned template renders directly into
 * the HOST's shadow root, so each host's own tests keep querying `[data-test="line-note"]` /
 * `[data-test="line-doneness"]` in its shadow root (a child element would hide them behind a nested
 * shadow boundary), and the host keeps ownership of the note/doneness state. The host passes the current
 * `note`/`doneness` and two change callbacks; nothing here holds state.
 */

/** The meat-doneness values, in cooking order, as the gated `<select>` offers them. Mirrors the
 * server's `DONENESS` tuple; each maps to a `doneness.<value>` i18n key. */
export const DONENESS: readonly Doneness[] = [
  "rare",
  "medium_rare",
  "medium",
  "medium_well",
  "well_done",
];

/** Whether the doneness picker applies to a product: only when its published diet asserts it contains
 * meat. Fish, unreviewed and diet-less products never show it — the SAME gate the picker used inline. */
export function isMeatProduct(product: TillProduct): boolean {
  return product.diet?.contains.includes("meat") ?? false;
}

/** What a host passes to render the editor: the product (for the meat gate), the current values, and a
 * change callback per field. The host trims/omits when it commits (the store's `setLineExtras` and the
 * picker's `#confirm` both do), so the callbacks carry the raw field value. */
export interface LineExtrasEditorProps {
  product: TillProduct;
  note: string;
  doneness: Doneness | "";
  onNoteChange: (note: string) => void;
  onDonenessChange: (doneness: Doneness | "") => void;
}

/**
 * The shared field styles for the note textarea + doneness field group. A host adds this to its `static
 * styles` array ALONGSIDE `selectStyles` (`../select-styles.js`), which supplies the token styling for
 * the native `<select>` — kept separate because most hosts already import `selectStyles` for other
 * pickers.
 */
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

/** The always-shown free-text note field, capped at 200 chars to match the server's limit. A visible
 * `<label>` wraps the textarea so it carries an accessible name. */
function renderNote(props: LineExtrasEditorProps) {
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

/** The meat-gated doneness picker — rendered only when {@link isMeatProduct}. A blank "no preference"
 * default keeps doneness OPTIONAL; picking one calls back with the chosen value. */
function renderDoneness(props: LineExtrasEditorProps) {
  return html`
    <label class="line-field">
      <span class="line-field-label">${t("doneness.label")}</span>
      <select
        data-test="line-doneness"
        .value=${props.doneness}
        @change=${(e: Event) =>
          props.onDonenessChange((e.target as HTMLSelectElement).value as Doneness | "")}
      >
        <option value="">${t("doneness.none")}</option>
        ${DONENESS.map((d) => html`<option value=${d}>${t(`doneness.${d}` as StringKey)}</option>`)}
      </select>
    </label>
  `;
}

/**
 * The note textarea plus (for a meat product) the doneness select, as one template block. The note comes
 * first and shows for every product; the doneness select follows only when the product contains meat.
 */
export function renderLineExtrasEditor(props: LineExtrasEditorProps) {
  return html`
    ${renderNote(props)} ${isMeatProduct(props.product) ? renderDoneness(props) : nothing}
  `;
}
