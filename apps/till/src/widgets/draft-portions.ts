import { addDecimal, decimal } from "@waitron/shared";
import { type TemplateResult, html, nothing } from "lit";
import { t } from "../i18n/t.js";
import { takesExtras } from "../state/order-line.js";
import type { OrderLine, WorkingOrderStore } from "../state/working-order.js";
import { quantityText } from "./dish-format.js";
import { draftSplitChevron } from "./draft-row.js";
import { lineProductName } from "./product-name.js";

/** A dish taking extras, in a whole count above one, can be split into portions of one. */
export function splitsIntoPortions(line: OrderLine): boolean {
  return (
    takesExtras(line.product) &&
    Number.isInteger(Number(line.quantity)) &&
    Number(line.quantity) > 1
  );
}

/**
 * The header drawn before a split family's first portion, in `before-<n>`; tapping it folds the
 * family. `current` is the screen's check that the row may still be changed.
 */
export function draftFamilyHeader(
  store: WorkingOrderStore,
  line: OrderLine,
  index: number,
  current: () => boolean,
  onFold: () => void,
): TemplateResult | typeof nothing {
  const family = store.splitFamily(line);
  if (family?.[0] !== line) return nothing;
  return html`<button
    type="button"
    slot=${`before-${index}`}
    class="option draft-family-header"
    data-fold-draft-family
    aria-expanded="true"
    ?disabled=${!current()}
    @click=${() => {
      if (current()) onFold();
    }}
  >
    <span
      >${lineProductName(line.product)}
      ×${quantityText(family.reduce((total, member) => addDecimal(total, decimal(member.quantity)), decimal("0")))}</span
    >
    <span aria-hidden="true">⌃</span>
  </button>`;
}

/** The arrow on a row of several, in `end-<n>`, that splits it into portions of one. */
export function draftSplitArrow(
  line: OrderLine,
  index: number,
  current: () => boolean,
  onSplit: () => void,
): TemplateResult | typeof nothing {
  if (!splitsIntoPortions(line)) return nothing;
  return html`<button
    type="button"
    slot=${`end-${index}`}
    class="draft-row-split"
    data-split-draft-line=${index}
    aria-label=${`${t("table.split_group_line")} · ${lineProductName(line.product)}`}
    ?disabled=${!current()}
    @click=${() => {
      if (current()) onSplit();
    }}
  >
    ${draftSplitChevron()}
  </button>`;
}

/** Splits the line into portions of one, unless the store refuses changes or it cannot split. */
export function splitDraftLine(store: WorkingOrderStore, line: OrderLine): void {
  const index = store.lines.indexOf(line);
  if (index < 0 || store.sending || store.editsLocked || !splitsIntoPortions(line)) return;
  store.splitLine(index);
}

/**
 * Folds the line's split family back into one row. When it folded, the selection follows: the
 * folded row is selected only if every portion was. Answers whether the selection changed.
 */
export function foldDraftFamily(
  store: WorkingOrderStore,
  line: OrderLine,
  selection: WeakSet<OrderLine>,
): boolean {
  if (store.sending || store.editsLocked) return false;
  const family = store.splitFamily(line);
  if (family === undefined) return false;
  const selected = family.every((member) => selection.has(member));
  store.foldSplitFamily(line);
  if (
    !store.lines.includes(family[0]!) ||
    family.slice(1).some((member) => store.lines.includes(member))
  )
    return false;
  for (const member of family) selection.delete(member);
  if (selected) selection.add(family[0]!);
  return true;
}
