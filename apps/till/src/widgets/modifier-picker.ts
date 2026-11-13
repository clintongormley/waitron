import { ContentLanguageController, currentContentLanguages } from "@waitron/ui";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { trackDialog } from "./track-dialog.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  formatDecimalInput,
  saveActionState,
} from "@waitron/ui";
import { assertQuantityPrecision } from "@waitron/catalogue/src/unit-validation.js";
import "@waitron/ui/src/components/wt-input.js";
import type {
  ComboboxOption,
  DraftScope,
  LeaveCoordinator,
  LeaveReason,
  WtDialog,
} from "@waitron/ui";
import type { OptionSelection, OptionSnapshot } from "@waitron/shared";
import { compareDecimal, decimal, formatMoney, toScale } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import {
  lineGross,
  offeredListsOf,
  productAsVariant,
  quantityPlaces,
} from "../state/order-line.js";
import { optionSnapshotOf } from "../state/held-options.js";
import { sameExtraSelections } from "../state/held-extras.js";
import { productName, productUnit } from "./product-name.js";
import { lineNutrition } from "./line-nutrition.js";
import { extraNutrition } from "./diet-badges.js";
import { optionAnswers } from "./option-snapshot.js";
import { allowsAllergenChoice, EMPTY_MENU_FILTERS, type MenuFilters } from "../menu-filter.js";
import type { LineNutrition } from "../api/client.js";
import { unitPresentation } from "@waitron/catalogue/src/unit-presentation.js";
import { lineExtrasEditorStyles, renderLineExtrasEditor } from "./line-extras-editor.js";
import type { LineSelection, OrderLine, SelectedExtra } from "../state/working-order.js";
import type {
  OfferedExtraItem,
  OfferedExtrasList,
  OfferedOptionsList,
  TillProduct,
} from "../api/client.js";

interface ModifierDraft {
  quantity: string;
  variantId: string;
  picks: Record<string, number>;
  answers: Record<string, string>;
  note: string;
  courseId: string | null;
}

export type StagedRemoval = "note" | { listId: string; productId: string };

export interface ModifierConfirmDetail extends LineSelection {
  quantity?: string;
  product: TillProduct;
  courseId?: string;
}

/** What an inline picker tells its host after any update that moves one of these. `quantity` and
 * `extras` are what a confirm would send now; the rest of the selection arrives with the confirm. */
export interface ModifierChangeDetail extends Pick<ModifierConfirmDetail, "quantity" | "extras"> {
  /** The draft differs from what it opened with, or from what it last confirmed; always true for a
   * picker opened with no `initialSelections`, as a new dish may be added unchanged. */
  changed: boolean;
  /** The windowed Save would be enabled now. */
  savable: boolean;
  /** The windowed footer would show `form.fix_fields` now. */
  fixFields: boolean;
}

/**
 * One pick's identity while the dialog is open. A product can be offered by two of a dish's lists at
 * two prices, so the list has to be part of the key: counting by product alone would make one
 * stepper move both rows.
 */
function pickKey(listId: string, productId: string): string {
  return `${listId}\u0000${productId}`;
}

/** "+€1.50" for a variant dearer than its parent, "−€0.50" (a minus sign) for a cheaper one. */
function priceDifference(difference: string): string {
  return difference.startsWith("-")
    ? `\u2212${formatMoney(difference.slice(1), currentLocale())}`
    : `+${formatMoney(difference, currentLocale())}`;
}

/**
 * Walks the dish's offered lists in the order the offer gives them, which nothing here re-sorts.
 *
 * It reads the STAFF name of every list, label and offered product. The till is a staff surface; the
 * diner's and the cook's wordings belong to the receipt and the kitchen ticket.
 */
@customElement("till-modifier-picker")
export class TillModifierPicker extends LitElement {
  constructor() {
    super();
    new ContentLanguageController(this);
  }

  static override styles = [
    baseStyles,
    lineExtrasEditorStyles,
    css`
      :host {
        --wt-line-course-field-height: var(--wt-field-height);
      }
      wt-combobox[name="course"] {
        --wt-field-height: max(var(--wt-tap-min), var(--wt-line-course-field-height));
      }
      h3 {
        margin: var(--wt-space-3) 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
      }
      ul {
        margin: 0 0 var(--wt-space-3);
        padding-inline-start: var(--wt-space-4);
      }
      wt-input[name="quantity"] {
        display: block;
        margin-block-end: var(--wt-space-3);
      }
      .min-quantity-action {
        margin-block: calc(-1 * var(--wt-space-2)) var(--wt-space-3);
      }
      .picker-actions {
        width: 100%;
      }
      .picker-action-row {
        display: flex;
        justify-content: flex-end;
        gap: var(--wt-space-2);
      }
      .request-refusal {
        margin: 0 0 var(--wt-space-2);
        color: var(--wt-color-danger);
      }
      .group {
        margin: 0 0 var(--wt-space-4);
      }

      .group-name {
        margin: 0 0 var(--wt-space-2);
        font-weight: var(--wt-font-weight-bold);
      }

      /* The per-list counter reads OUT the list's state; it is not another choice in it. A size down
         and muted keeps the eye walking the item names from stopping on it. Without a rule of its own
         a <p> also keeps the user agent's 1em margins, which is em-derived spacing no token governs. */
      .selected-total {
        margin: 0 0 var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      /* A refusal is the reason Add is shut, so it has to be what the operator's eye lands on: the
         emphasis the basket gives .allergen-pending, in the danger colour because this one stops the
         dish being added rather than cautioning about it. */
      .refusal {
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-danger);
        font-weight: var(--wt-font-weight-bold);
      }

      .option {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-1) 0;
        cursor: pointer;
      }

      .option input:disabled {
        cursor: not-allowed;
      }

      /* An unavailable variant stays listed so the operator sees it is sold out, not missing. */
      .option:has(input[name="product-variant"]:disabled) .option-name {
        color: var(--wt-color-text-muted);
      }

      /* A stepper row is a plain container, not a single-control label, so it is not pointer-cued. */
      .stepper-option {
        cursor: default;
      }

      .option-name {
        flex: 1;
      }

      .option-label {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
      }

      .extra-nutrition,
      .extra-allergens {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-1) var(--wt-space-2);
      }

      .extra-nutrition {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }

      .allergen-chip {
        display: inline-block;
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full);
      }

      .option-delta,
      .price-difference {
        color: var(--wt-color-text-muted);
        font-variant-numeric: tabular-nums;
      }

      .stepper {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
      }

      .stepper-count {
        min-width: var(--wt-space-5);
        text-align: center;
        font-variant-numeric: tabular-nums;
        font-weight: var(--wt-font-weight-bold);
      }

      .running {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding-top: var(--wt-space-3);
        border-top: 1px solid var(--wt-color-border);
      }

      .running-label {
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-bold);
      }

      .running-amount {
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  @property({ attribute: false }) product!: TillProduct;

  /** How many of the dish the line holds — the count the running price multiplies every pick by. */
  @property() quantity = "1";

  @property({ type: Boolean }) showTotal = true;

  /** The answers a line already carries, when the dialog was opened to EDIT one. Present also when
   * it is empty, which is how "the operator deliberately picked nothing" is told from a fresh open:
   * a fresh open seeds the offer's defaults, a reopen never does. */
  @property({ attribute: false }) initialSelections?: LineSelection;
  @property({ attribute: false }) lockedExtras: readonly { listId: string; productId: string }[] =
    [];

  @property({ attribute: false }) filters: MenuFilters = EMPTY_MENU_FILTERS;
  @state() private removedDefaults: string[] = [];

  @property({ type: Boolean }) withNote = false;

  @property({ attribute: false }) initialCourse?: string;
  @property() coursePlaceholder = "";
  @property({ attribute: false }) courseChoices: readonly ComboboxOption[] = [];
  @property({ type: Boolean }) disabled = false;
  @property({ attribute: false }) refusal: unknown = nothing;
  @property({ type: Boolean }) lineDetails = false;
  /** With {@link lineDetails}, the line's quantity is neither drawn nor sent. */
  @property({ type: Boolean }) quantityReadOnly = false;
  /** With {@link lineDetails}, the lowest quantity Save accepts; below it the field shows
   * {@link minQuantityMessage} and the `min-quantity-action` slot. */
  @property() minQuantity?: string;
  @property() minQuantityMessage = "";
  @property({ type: Boolean }) readOnly = false;
  @property({ attribute: false }) nutrition: LineNutrition | null = null;
  @property({ type: Boolean }) recordedWhenSent = false;
  @property({ attribute: false }) stagedRemoval?: StagedRemoval;
  #removalStaged = false;
  /** What the fields show once open, in place of {@link initialSelections}, which stays what a
   * change is measured from: a change the server refused, put back as it was left. */
  @property({ attribute: false }) restoredSelection?: ModifierConfirmDetail;
  @property({ attribute: false }) draftParent?: object;
  /** Draws only the fields, for a host window to hold: no window, actions, variants, course or
   * total. The host saves through {@link confirm}, guards leaving through {@link requestLeave} and
   * follows `wt-modifier-change`. */
  @property({ type: Boolean }) inline = false;
  #reported?: ModifierChangeDetail;
  @state() private courseId = "";
  @state() private editedQuantity = "1";
  @state() private attempted = false;

  /** How many of each offered product is taken, keyed by {@link pickKey}. */
  @state() private picks: Record<string, number> = {};

  /** The label chosen per options list, keyed by list id. */
  @state() private answers: Record<string, string> = {};

  @state() private note = "";
  @state() private noteExpanded = false;

  @state() private variantId = "";

  #seeded = false;

  @state() private active = true;
  #connection = 0;
  #scope?: DraftScope<ModifierDraft>;
  #leave?: LeaveCoordinator;
  #baseline?: ModifierDraft;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  #draft(): ModifierDraft {
    return {
      quantity: this.editedQuantity,
      variantId: this.variantId,
      picks: { ...this.picks },
      answers: { ...this.answers },
      note: this.note.trim(),
      courseId: this.#hasCourse ? this.courseId : null,
    };
  }

  get #hasCourse(): boolean {
    return this.initialCourse !== undefined && !this.inline;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Keep the draft across reconnects while creating a fresh native modal opening.
    if (this.hasUpdated) this.#connection++;
    this.requestUpdate();
  }

  /** The checks one update's render and change report share. */
  #checks!: {
    stale: SelectedExtra[];
    totals: Map<string, number>;
    saveAction: ReturnType<typeof saveActionState>;
    satisfied: boolean;
  };

  override willUpdate(): void {
    this.#prepareDraft();
    const stale = this.#stalePicks();
    const totals = this.#listTotals();
    this.#checks = {
      stale,
      totals,
      saveAction: this.#saveAction(),
      satisfied: this.#satisfied(stale, totals),
    };
  }

  #prepareDraft(): void {
    if (!this.product || !this.active) return;
    if (!this.#seeded) this.#seedSelections();
    if (!this.isConnected || this.#scope) return;
    this.#baseline ??= this.#draft();
    const { coordinator, scope } = draftScopeFor<ModifierDraft>(this, {
      id: this,
      parent: this.draftParent,
      current: () => this.#draft(),
      snapshot: (value) => ({ ...value, picks: { ...value.picks }, answers: { ...value.answers } }),
      equal: (a, b) =>
        a.quantity === b.quantity &&
        a.variantId === b.variantId &&
        a.note === b.note &&
        a.courseId === b.courseId &&
        Object.keys(a.picks).length === Object.keys(b.picks).length &&
        Object.entries(a.picks).every(([key, count]) => b.picks[key] === count) &&
        Object.keys(a.answers).length === Object.keys(b.answers).length &&
        Object.entries(a.answers).every(([key, label]) => b.answers[key] === label),
      restore: (value) => {
        this.editedQuantity = value.quantity;
        this.variantId = value.variantId;
        this.picks = { ...value.picks };
        this.answers = { ...value.answers };
        this.note = value.note;
        this.courseId = value.courseId ?? "";
      },
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit(this.#baseline);
    if (this.stagedRemoval !== undefined && !this.#removalStaged && !this.readOnly) {
      this.#removalStaged = true;
      if (this.stagedRemoval === "note") this.note = "";
      else this.#setCount(this.stagedRemoval.listId, this.stagedRemoval.productId, 0);
      scope.changed();
    }
    if (this.restoredSelection !== undefined && !this.readOnly) {
      this.#restore(this.restoredSelection);
      scope.changed();
    }
  }

  #restore(selection: ModifierConfirmDetail): void {
    if (selection.quantity !== undefined) this.editedQuantity = selection.quantity;
    if (this.withNote) {
      this.note = selection.note ?? "";
      this.noteExpanded = this.note !== "";
    }
    this.picks = Object.fromEntries(
      (selection.extras ?? []).map((extra) => [
        pickKey(extra.listId, extra.productId),
        extra.quantity,
      ]),
    );
    this.answers = Object.fromEntries(
      (selection.options ?? []).map((answer) => [answer.listId, answer.labelId]),
    );
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  #seedSelections(): void {
    this.#seeded = true;
    this.editedQuantity = this.quantity;
    this.courseId = this.initialCourse ?? "";
    if (this.initialSelections !== undefined) {
      if (this.withNote) this.note = this.initialSelections.note ?? "";
      this.noteExpanded = this.note !== "";
      for (const extra of this.initialSelections.extras ?? [])
        this.picks[pickKey(extra.listId, extra.productId)] = extra.quantity;
      for (const answer of this.initialSelections.options ?? [])
        this.answers[answer.listId] = answer.labelId;
      return;
    }
    this.removedDefaults = offeredListsOf(this.product).flatMap((entry) =>
      entry.kind === "extras" && !this.inline
        ? entry.items
            .filter(
              (item) => item.preselected && !allowsAllergenChoice(item.addAllergens, this.filters),
            )
            .map((item) => item.name)
        : [],
    );
    this.variantId = this.#variants.find((variant) => variant.available)?.id ?? "";
    for (const entry of this.#offered) {
      if (entry.kind === "options") {
        if (entry.defaultLabelId !== null) this.answers[entry.id] = entry.defaultLabelId;
        continue;
      }
      for (const item of entry.items) {
        if (item.preselected) this.picks[pickKey(entry.id, item.productId)] = 1;
      }
    }
  }

  /** The lists the till offers on this dish (`offeredListsOf`), in offer order. A product the till synthesised (a retrieved line
   * with no live offer) carries none, and then the dialog has only its variants to ask about. */
  get #offered() {
    const entries = offeredListsOf(this.product);
    return this.initialSelections !== undefined || this.inline
      ? entries
      : entries.map((entry) =>
          entry.kind === "extras"
            ? {
                ...entry,
                items: entry.items.filter((item) =>
                  allowsAllergenChoice(item.addAllergens, this.filters),
                ),
              }
            : entry,
        );
  }

  get #variants() {
    if (this.inline) return [];
    const variants = this.product.variants ?? [];
    return this.initialSelections !== undefined
      ? variants
      : variants.filter((variant) => allowsAllergenChoice(variant.allergens, this.filters));
  }

  get #chosenVariant() {
    return this.#variants.find((variant) => variant.id === this.variantId && variant.available);
  }

  /** The product as chosen: the dish itself, or the chosen variant of it. */
  get #selectedProduct(): TillProduct {
    const variant = this.#chosenVariant;
    return variant === undefined ? this.product : productAsVariant(this.product, variant);
  }

  #countOf(listId: string, productId: string): number {
    return this.picks[pickKey(listId, productId)] ?? 0;
  }

  #listTotal(list: OfferedExtrasList): number {
    return list.items.reduce((sum, item) => sum + this.#countOf(list.id, item.productId), 0);
  }

  /**
   * Seeded picks the dish no longer offers — the list was withdrawn, or it dropped the product. They
   * are not silently discarded: the dialog says so and Add stays shut, because dropping one would
   * un-order something the kitchen may already have been told about.
   */
  #stalePicks(): SelectedExtra[] {
    return (this.initialSelections?.extras ?? []).filter(
      (extra) =>
        !this.#offered.some(
          (entry) =>
            entry.kind === "extras" &&
            entry.id === extra.listId &&
            entry.items.some((item) => item.productId === extra.productId),
        ),
    );
  }

  #listTotals(): Map<string, number> {
    const totals = new Map<string, number>();
    for (const entry of this.#offered) {
      if (entry.kind === "extras") totals.set(entry.id, this.#listTotal(entry));
    }
    return totals;
  }

  /**
   * Whether Add may be enabled. Takes the stale picks and the per-list counts rather than deriving
   * them, so one render computes each once and shares it with {@link #renderExtras}.
   */
  #satisfied(stale: readonly SelectedExtra[], totals: ReadonlyMap<string, number>): boolean {
    if (
      !this.inline &&
      (this.product.variants?.length ?? 0) > 0 &&
      this.#chosenVariant === undefined
    )
      return false;
    if (stale.length > 0 || this.removedDefaults.length > 0) return false;
    return this.#offered.every((entry) => {
      if (entry.kind === "options")
        return entry.labels.some((label) => label.id === this.answers[entry.id]);
      const total = totals.get(entry.id) ?? 0;
      return (
        (this.product.setLunch === true || total >= entry.minPicks) &&
        (entry.maxPicks === null || total <= entry.maxPicks) &&
        entry.items.every(
          (item) =>
            item.maxQuantity === null ||
            this.#countOf(entry.id, item.productId) <= item.maxQuantity,
        )
      );
    });
  }

  #selectedExtras(): SelectedExtra[] {
    return this.#offered.flatMap((entry) =>
      entry.kind === "extras"
        ? entry.items.flatMap((item): SelectedExtra[] => {
            const quantity = this.#countOf(entry.id, item.productId);
            return quantity < 1
              ? []
              : [
                  {
                    listId: entry.id,
                    productId: item.productId,
                    name: item.name,
                    price: item.price,
                    quantity,
                  },
                ];
          })
        : [],
    );
  }

  #selectedOptions(): OptionSelection[] {
    return this.#answeredLists().map(({ list, labelId }) => ({ listId: list.id, labelId }));
  }

  /** Built here so the basket renders a line the operator has just answered through the same reader
   * as a line read back from a held order. */
  #selectedSnapshots(): OptionSnapshot[] {
    return this.#answeredLists().map(({ list, labelId }) =>
      optionSnapshotOf(
        list,
        list.labels.find((candidate) => candidate.id === labelId)!,
      ),
    );
  }

  /** Each offered options list that holds an answer naming one of its own labels, in offer order. */
  #answeredLists(): { list: OfferedOptionsList; labelId: string }[] {
    return this.#offered.flatMap((entry) => {
      if (entry.kind !== "options") return [];
      const labelId = this.answers[entry.id];
      return entry.labels.some((label) => label.id === labelId)
        ? [{ list: entry, labelId: labelId! }]
        : [];
    });
  }

  get #runningPrice(): string {
    if (this.lineDetails && this.#quantityInvalid()) return "—";
    const previewLine: OrderLine = {
      product: this.#selectedProduct,
      quantity: this.lineDetails ? this.editedQuantity : this.quantity,
      extras: this.#selectedExtras(),
    };
    return formatMoney(lineGross(previewLine), currentLocale());
  }

  #locked(listId: string, productId: string): boolean {
    return this.lockedExtras.some((pick) => pick.listId === listId && pick.productId === productId);
  }

  #setCount(listId: string, productId: string, quantity: number): void {
    if (this.#locked(listId, productId)) return;
    if (!this.isConnected || !this.active) return;
    const next = { ...this.picks };
    if (quantity >= 1) {
      next[pickKey(listId, productId)] = quantity;
    } else {
      delete next[pickKey(listId, productId)];
    }
    this.picks = next;
    this.#scope?.changed();
  }

  /**
   * Step one item's count, held inside BOTH bounds: the item's own `maxQuantity` and what is left of
   * the list's `maxPicks`. Clamping here and not only in {@link #satisfied} matters because a
   * click on a disabled `wt-button` still reaches this handler — the host takes the click, the
   * disabled inner `<button>` never sees it — so without the clamp a forced tap would show a count
   * the list does not allow.
   */
  #step(list: OfferedExtrasList, item: OfferedExtraItem, delta: number): void {
    const current = this.#countOf(list.id, item.productId);
    const listRoom =
      list.maxPicks === null ? null : current + list.maxPicks - this.#listTotal(list);
    const room =
      item.maxQuantity === null
        ? listRoom
        : listRoom === null
          ? item.maxQuantity
          : Math.min(item.maxQuantity, listRoom);
    this.#setCount(
      list.id,
      item.productId,
      Math.max(0, room === null ? current + delta : Math.min(room, current + delta)),
    );
  }

  #confirm(e?: Event): void {
    e?.stopPropagation();
    if (!this.isConnected || !this.active || this.disabled || this.readOnly) return;
    if (this.#saveAction().unchanged) return;
    this.attempted = true;
    if (this.lineDetails && this.#quantityInvalid()) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    if (!this.#satisfied(this.#stalePicks(), this.#listTotals())) return;
    const submitted = this.#draft();
    const detail = this.#detail();
    // Consumers can leave during the event; a refused apply must restore this draft's baseline.
    const baseline = this.#baseline;
    this.#baseline = submitted;
    this.#scope?.commit(submitted);
    const accepted = this.dispatchEvent(
      new CustomEvent<ModifierConfirmDetail>("wt-modifier-confirm", {
        detail,
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    if (!accepted) {
      this.#baseline = baseline;
      if (baseline !== undefined) this.#scope?.commit(baseline);
    }
  }

  #detail(): ModifierConfirmDetail {
    const extras = this.#selectedExtras();
    const options = this.#selectedOptions();
    const detail: ModifierConfirmDetail = {
      product: this.#selectedProduct,
      ...(this.#editsQuantity ? { quantity: this.editedQuantity } : {}),
      ...(this.#hasCourse ? { courseId: this.courseId } : {}),
      ...(extras.length === 0 ? {} : { extras }),
      ...(options.length === 0 ? {} : { options, optionSnapshots: this.#selectedSnapshots() }),
    };
    const note = this.note.trim();
    if (note !== "") {
      detail.note = note;
    }
    return detail;
  }

  /** Saves as the windowed Save does: the same checks, the same cancelable `wt-modifier-confirm`. */
  confirm(): void {
    this.#confirm();
  }

  /** Asks the leave question when the draft changed; true when the host may close. Answers true
   * without asking while it has no leave coordinator: before its first connected update with a
   * product, and once disconnected. */
  async requestLeave(reason: LeaveReason): Promise<boolean> {
    return this.#leave ? this.#beforeClose(reason) : true;
  }

  override updated(): void {
    if (!this.inline || !this.product || !this.#scope) return;
    const { saveAction, satisfied } = this.#checks;
    const quantityRefused = this.attempted && this.lineDetails && this.#quantityInvalid();
    const extras = this.#selectedExtras();
    const report: ModifierChangeDetail = {
      changed: !saveAction.unchanged,
      savable:
        !this.disabled && !this.readOnly && !saveAction.unchanged && !quantityRefused && satisfied,
      fixFields: !this.readOnly && quantityRefused,
      ...(this.#editsQuantity ? { quantity: this.editedQuantity } : {}),
      ...(extras.length === 0 ? {} : { extras }),
    };
    const last = this.#reported;
    if (
      last !== undefined &&
      last.changed === report.changed &&
      last.savable === report.savable &&
      last.fixFields === report.fixFields &&
      last.quantity === report.quantity &&
      sameExtraSelections(last.extras ?? [], report.extras ?? [])
    )
      return;
    this.#reported = report;
    this.dispatchEvent(
      new CustomEvent<ModifierChangeDetail>("wt-modifier-change", {
        detail: report,
        bubbles: true,
        composed: true,
      }),
    );
  }

  #cancel(event: Event): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active) return;
    if (this.#leave) {
      void this.shadowRoot!.querySelector<WtDialog>("wt-modal")!.requestClose(
        this.lineDetails ? "navigation" : "cancel",
      );
      return;
    }
    this.#reportCancel();
  }

  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#reportCancel();
  }

  /** Adding a dish has no earlier choice to compare with, so Add never waits for a change; only an edit does. */
  #saveAction() {
    return saveActionState(this.#scope, { savableAtOpen: this.initialSelections === undefined });
  }

  #reportCancel(): void {
    this.dispatchEvent(
      new CustomEvent("wt-modifier-cancel", { detail: {}, bubbles: true, composed: true }),
    );
  }

  override render() {
    const { stale, totals, saveAction, satisfied } = this.#checks;
    const fields = html`<div ?inert=${this.disabled}>
      ${this.inline ? nothing : html`<slot name="line-details"></slot>${lineNutrition(this.nutrition, this.recordedWhenSent)}`}
      ${
        this.readOnly
          ? html`
              <p>${formatDecimalInput(this.quantity, currentLocale())}</p>
              ${(this.initialSelections?.extras ?? []).map((extra) => html`<p>${extra.name} ×${extra.quantity}</p>`)}
              ${
                this.initialSelections?.optionSnapshots !== undefined
                  ? optionAnswers(this.initialSelections.optionSnapshots, {
                      reads: "staff",
                    }).map((answer) => html`<p>${answer}</p>`)
                  : (this.initialSelections?.options ?? []).map(
                      (answer) =>
                        html`<p>
                          ${this.product.offeredModifiers?.flatMap((list) => (list.kind === "options" && list.id === answer.listId ? list.labels.filter((label) => label.id === answer.labelId).map((label) => label.name) : []))}
                        </p>`,
                    )
              }
              ${this.initialSelections?.note ? html`<p>${t("line.note.label")}: ${this.initialSelections.note}</p>` : nothing}
            `
          : html`
              ${
                this.#editsQuantity
                  ? html`<wt-input
                        name="quantity"
                        label=${t("table.split_quantity")}
                        required
                        decimal-locale=${currentLocale()}
                        .value=${this.editedQuantity}
                        .error=${!this.attempted || !this.#quantityInvalid() ? "" : this.#quantityBelowMinimum() ? this.minQuantityMessage : t("line.quantity_invalid")}
                        @wt-change=${(event: CustomEvent<{ value: string }>) => {
                          event.stopPropagation();
                          if (!this.isConnected || !this.active || this.disabled || this.readOnly)
                            return;
                          this.editedQuantity = event.detail.value;
                          this.#scope?.changed();
                        }}
                      ></wt-input
                      >${
                        this.attempted && this.#quantityBelowMinimum()
                          ? html`<div class="min-quantity-action">
                              <slot name="min-quantity-action"></slot>
                            </div>`
                          : nothing
                      }`
                  : nothing
              }
              ${
                !this.#hasCourse
                  ? nothing
                  : html`<wt-combobox
                      ?preserve-order=${true /* Preserve configured course position. */}
                      name="course"
                      label=${`${t("table.course_label")} · ${productName(this.product)}`}
                      placeholder=${this.coursePlaceholder || this.courseChoices.find((choice) => choice.value === "")?.label || ""}
                      search="auto"
                      searchPlaceholder=${t("form.combobox_search")}
                      noResultsLabel=${t("form.combobox_no_results")}
                      .options=${this.courseChoices}
                      .value=${this.courseId}
                      @wt-change=${(event: CustomEvent<{ value: string }>) => {
                        event.stopPropagation();
                        if (
                          !this.isConnected ||
                          !this.active ||
                          this.disabled ||
                          !this.courseChoices.some((choice) => choice.value === event.detail.value)
                        )
                          return;
                        this.courseId = event.detail.value;
                        this.#scope?.changed();
                      }}
                    ></wt-combobox>`
              }
              ${
                !this.inline &&
                (this.product.variants?.length ?? 0) > 0 &&
                this.#variants.length === 0
                  ? html`<p class="refusal" role="alert">${t("modifier.no_compatible_size")}</p>`
                  : nothing
              }
              ${
                this.#variants.length === 0
                  ? nothing
                  : html`<fieldset class="group">
                      <legend class="group-name">${t("modifier.variant")} *</legend>
                      ${this.#variants.map(
                        (variant) =>
                          html`<label class="option">
                            <input
                              type="radio"
                              name="product-variant"
                              value=${variant.id}
                              .checked=${this.variantId === variant.id}
                              ?disabled=${!variant.available}
                              @change=${(event: Event) => {
                                event.stopPropagation();
                                if (!this.isConnected || !this.active) return;
                                this.variantId = variant.id;
                                this.#scope?.changed();
                              }}
                            />
                            <span class="option-name">${variant.name}</span>
                            ${
                              variant.unitPriceDifference === null
                                ? nothing
                                : html`<span class="price-difference"
                                    >${priceDifference(variant.unitPriceDifference)}</span
                                  >`
                            }
                            <span class="option-delta"
                              >${formatMoney(variant.unitPrice, currentLocale())}</span
                            >
                          </label>`,
                      )}
                    </fieldset>`
              }
              ${
                this.removedDefaults.length === 0
                  ? nothing
                  : html`<div
                      class="allergen-removal"
                      role="group"
                      aria-label=${t("modifier.remove_extras_question")}
                    >
                      <p>${t("modifier.remove_extras_question")}</p>
                      <ul>
                        ${this.removedDefaults.map((name) => html`<li>${name}</li>`)}
                      </ul>
                      <wt-button
                        class="remove-extras"
                        variant="primary"
                        @click=${(event: Event) => {
                          event.stopPropagation();
                          this.removedDefaults = [];
                        }}
                        >${t("modifier.remove_extras_continue")}</wt-button
                      >
                      <wt-button
                        class="cancel-removal"
                        variant="secondary"
                        @click=${(event: Event) => this.#cancel(event)}
                        >${t("action.cancel")}</wt-button
                      >
                    </div>`
              }
              ${this.#offered.map((entry) =>
                entry.kind === "extras"
                  ? this.#renderExtras(entry, totals.get(entry.id) ?? 0)
                  : this.#renderOptions(entry),
              )}
              ${stale.map(
                (extra) =>
                  html`<p class="refusal" role="alert">
                    ${extra.name}: ${t("modifier.selection_changed")}
                  </p>`,
              )}
              ${
                this.initialSelections !== undefined && !this.withNote
                  ? nothing
                  : this.lineDetails && this.note === "" && !this.noteExpanded
                    ? html`<wt-button
                        class="add-note"
                        variant="secondary"
                        @click=${async (event: Event) => {
                          event.stopPropagation();
                          if (!this.isConnected || !this.active || this.disabled || this.readOnly)
                            return;
                          const connection = this.#connection;
                          this.noteExpanded = true;
                          await this.updateComplete;
                          const field = this.shadowRoot!.querySelector("wt-textarea");
                          await field?.updateComplete;
                          if (
                            connection === this.#connection &&
                            this.isConnected &&
                            this.active &&
                            !this.disabled &&
                            !this.readOnly
                          )
                            field?.focus();
                        }}
                        >${t("line.note.add")}</wt-button
                      >`
                    : renderLineExtrasEditor({
                        note: this.note,
                        onNoteChange: (note) => {
                          if (!this.isConnected || !this.active) return;
                          this.note = note;
                          this.#scope?.changed();
                        },
                      })
              }
              ${
                this.showTotal && !this.inline
                  ? html`<div class="running">
                      <span class="running-label">${t("label.total")}</span>
                      <span class="running-amount">${this.#runningPrice}</span>
                    </div>`
                  : nothing
              }
            `
      }
    </div>`;
    if (this.inline) return fields;
    const modal = html`<wt-modal
      ${trackDialog()}
      size="standard"
      .open=${this.active}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      .heading=${productName(this.product)}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      ${fields}
      <div slot="footer" class="picker-actions">
        ${this.refusal === nothing ? nothing : html`<p role="alert" class="request-refusal">${this.refusal}</p>`}
        ${!this.readOnly && this.attempted && this.lineDetails && this.#quantityInvalid() ? html`<p slot="footer" role="alert">${t("form.fix_fields")}</p>` : nothing}
        <div class="picker-action-row">
          <wt-button
            class="cancel"
            variant="secondary"
            @click=${(event: Event) => this.#cancel(event)}
          >
            ${t(this.lineDetails ? "table.submitted_close" : "action.cancel")}
          </wt-button>
          ${
            this.readOnly
              ? nothing
              : html`<wt-button
                  class="confirm"
                  variant=${this.initialSelections === undefined && !satisfied ? "secondary" : saveAction.variant}
                  ?disabled=${this.disabled || saveAction.unchanged || !satisfied || (this.attempted && this.lineDetails && this.#quantityInvalid())}
                  @click=${(e: Event) => this.#confirm(e)}
                >
                  ${t(this.initialSelections === undefined ? "action.add" : "modifier.save")}
                </wt-button>`
          }
        </div>
      </div>
    </wt-modal>`;
    return keyed(this.#connection, modal);
  }

  get #editsQuantity(): boolean {
    return this.lineDetails && this.initialSelections !== undefined && !this.quantityReadOnly;
  }

  #quantityInvalid(): boolean {
    return this.#quantityImprecise() || this.#quantityBelowMinimum();
  }

  #quantityImprecise(): boolean {
    if (this.quantityReadOnly) return false;
    try {
      assertQuantityPrecision(this.editedQuantity, productUnit(this.product).precision, {
        positive: true,
      });
    } catch {
      return true;
    }
    return false;
  }

  /** Only a quantity the dish's unit can take is measured against the minimum, so a fraction is
   * refused for its precision first. */
  #quantityBelowMinimum(): boolean {
    if (this.minQuantity === undefined || !this.#editsQuantity || this.#quantityImprecise())
      return false;
    try {
      return compareDecimal(decimal(this.editedQuantity), decimal(this.minQuantity)) < 0;
    } catch {
      return false;
    }
  }

  #renderExtras(list: OfferedExtrasList, total: number) {
    const atListMax = list.maxPicks !== null && total >= list.maxPicks;
    return html`
      <fieldset class="group">
        <legend class="group-name">
          ${list.name}${list.minPicks >= 1 && !this.product.setLunch ? " *" : ""}
        </legend>
        <p class="selected-total">
          ${t("modifier.selected_total")}:
          ${total}${list.maxPicks === null ? "" : ` / ${list.maxPicks}`}
        </p>
        ${this.product.setLunch && total < list.minPicks ? html`<p class="selected-total" data-lunch-open>${t("lunch.choose_later")}</p>` : nothing}
        ${list.items.map((item) =>
          item.maxQuantity === null || item.maxQuantity > 1
            ? this.#renderStepper(list, item, atListMax)
            : this.#renderPick(list, item, atListMax),
        )}
      </fieldset>
    `;
  }

  /** A free pick shows no price at all — "0,00" beside a bread roll reads as a charge. */
  #priceOf(item: OfferedExtraItem) {
    return Number(item.price) !== 0 ? formatMoney(item.price, currentLocale()) : nothing;
  }

  #extraName(item: OfferedExtraItem): string {
    if (item.portion === undefined || item.unit === undefined) return item.name;
    const places = Math.max(item.unit.precision, quantityPlaces(item.portion));
    const amount = formatDecimalInput(toScale(decimal(item.portion), places), currentLocale());
    const unit = unitPresentation(
      item.unit,
      currentLocale(),
      currentContentLanguages(),
    ).abbreviation;
    return `${item.name} · ${amount}${unit ? ` ${unit}` : ""}`;
  }

  /** Allergens only: the owner asked for declared-allergen labels, so no diet badge is drawn. */
  #extraLabel(list: OfferedExtrasList, item: OfferedExtraItem) {
    const test = `pick-${list.id}-${item.productId}`;
    return html`<span class="option-label">
      <span class="option-name">${this.#extraName(item)}</span>
      ${extraNutrition({ addAllergens: item.addAllergens }, `${test}-allergens`, `${test}-diet`)}
    </span>`;
  }

  #renderPick(list: OfferedExtrasList, item: OfferedExtraItem, atListMax: boolean) {
    const checked = this.#countOf(list.id, item.productId) >= 1;
    return html`
      <label class="option">
        <input
          id="pick-${list.id}-${item.productId}"
          type="checkbox"
          name=${`extras-${list.id}`}
          .checked=${checked}
          ?disabled=${this.#locked(list.id, item.productId) || (!checked && atListMax)}
          @change=${(e: Event) => {
            e.stopPropagation();
            this.#setCount(list.id, item.productId, (e.target as HTMLInputElement).checked ? 1 : 0);
          }}
        />
        ${this.#extraLabel(list, item)}
        <span class="option-delta">${this.#priceOf(item)}</span>
      </label>
    `;
  }

  #renderStepper(list: OfferedExtrasList, item: OfferedExtraItem, atListMax: boolean) {
    const count = this.#countOf(list.id, item.productId);
    const test = `pick-${list.id}-${item.productId}`;
    return html`
      <div class="option stepper-option">
        ${this.#extraLabel(list, item)}
        <span class="option-delta">${this.#priceOf(item)}</span>
        <span class="stepper">
          <wt-button
            class="step"
            size=${this.lineDetails ? "md" : "sm"}
            data-test="${test}-dec"
            aria-label=${`${t("modifier.decrease")} ${item.name}`}
            ?disabled=${this.#locked(list.id, item.productId) || count <= 0}
            @click=${() => this.#step(list, item, -1)}
          >
            −
          </wt-button>
          <span class="stepper-count" data-test="${test}-count">${count}</span>
          <wt-button
            class="step"
            size=${this.lineDetails ? "md" : "sm"}
            data-test="${test}-inc"
            aria-label=${`${t("modifier.increase")} ${item.name}`}
            ?disabled=${this.#locked(list.id, item.productId) || (item.maxQuantity !== null && count >= item.maxQuantity) || atListMax}
            @click=${() => this.#step(list, item, 1)}
          >
            +
          </wt-button>
        </span>
      </div>
    `;
  }

  #renderOptions(list: OfferedOptionsList) {
    return html`
      <fieldset class="group">
        <legend class="group-name">${list.name} *</legend>
        ${list.labels.map(
          (label) => html`
            <label class="option">
              <input
                id="label-${list.id}-${label.id}"
                type="radio"
                name=${`options-${list.id}`}
                .checked=${this.answers[list.id] === label.id}
                @change=${(event: Event) => {
                  event.stopPropagation();
                  if (!this.isConnected || !this.active) return;
                  this.answers = { ...this.answers, [list.id]: label.id };
                  this.#scope?.changed();
                }}
              />
              <span class="option-name">${label.name}</span>
            </label>
          `,
        )}
        ${
          list.labels.length === 0
            ? html`<p class="refusal" role="alert">
                ${list.name}: ${t("modifier.unavailable_choices")}
              </p>`
            : nothing
        }
      </fieldset>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-modifier-picker": TillModifierPicker;
  }
}
