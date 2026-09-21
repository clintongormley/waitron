import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, currentContentLanguages, selectStyles, submitOnEnter } from "@waitron/ui";
import { resolveContentText } from "@waitron/shared";
import { DIETARY_LABELS } from "@waitron/catalogue/src/dietary-declarations.js";
import { isProductPrice } from "@waitron/catalogue/src/modifier-limits.js";
import { VAT_CLASSES, resolveVatRate } from "@waitron/catalogue/src/pricing.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-disclosure.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-lozenge.js";
import "@waitron/ui/src/components/wt-price-input.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "./allergen-dietary-picker.js";
import "./category-membership-picker.js";
import "./image-upload.js";
import "./variant-form.js";
import "./variant-table.js";
import { categoryPath } from "./category-form.js";
import {
  nonBlankNames,
  optionalTextFields,
  priceLabel,
  switchField,
  textField,
  type FieldContext,
} from "./form-fields.js";
import { reorder } from "./reorder.js";
import { ReorderController, type ReorderModel } from "./reorder-table.js";
import type { CategorySummary, DashboardApi, ProductCategories } from "../api/client.js";
import type { ProductModifierRef } from "@waitron/catalogue/src/product-types.js";
import type {
  EditorVariant,
  ModifierListChoice,
  UnitChoice,
  LocalizedText,
  ProductEditorDraft,
  DietaryLabel,
  ProductRoutingChoice,
} from "./product-editor-model.js";
import { modifierKey, modifierListName, modifierListNames } from "./product-editor-model.js";
import type { ProductChildKind } from "../state/product-child-create.js";
import { t, currentLocale } from "../i18n/t.js";
import { allergenName, vatClassName } from "../i18n/domain.js";

const dietaryLabels: readonly DietaryLabel[] = DIETARY_LABELS;

/** Separates the parts of a collapsed section's summary. This is NOT the product·variant name join,
 * which belongs to `packages/catalogue/src/product-presentation.ts` and is never re-implemented. */
const SUMMARY_SEPARATOR = " · ";

/** The two combobox rows that open a nested form instead of attaching a list that exists. Neither
 * can be mistaken for an attachment, whose value always carries a colon. */
const CREATE_EXTRA_LIST = "create-extras";
const CREATE_OPTION_LIST = "create-options";

/** The word for each kind, taken from the Modifiers screen's own tab labels so a list is called the
 * same thing wherever it is named. */
const KIND_TITLE = { extras: "extras.title", options: "options.title" } as const;

/** A list named for a control with room for one string: its name, then which kind it is. */
function kindLabel(name: string, kind: ProductModifierRef["kind"]): string {
  return `${name}${SUMMARY_SEPARATOR}${t(KIND_TITLE[kind])}`;
}

/** Which field names each collapsed section holds, as PREFIXES. A section holding a validation
 * error cannot stay collapsed, and this is what its `has-error` is computed from. */
const SECTION_FIELDS = {
  kitchen: ["kitchen-name", "product-station", "product-course"],
  descriptors: ["customer-name-", "description-", "image"],
  nutrition: ["allergens", "dietary"],
} as const;
type SectionName = keyof typeof SECTION_FIELDS;

/**
 * The field names the SERVER uses when it rejects a product body
 * (`packages/catalogue/src/product-editor-input.ts`), mapped onto this editor's own field names. A
 * value ending in "-" names a translated field: the server names such a field once for all of its
 * languages, so there is no single language to point at and the default content language's input is
 * used.
 */
const SERVER_FIELDS: Record<string, string> = {
  name: "name",
  customerName: "customer-name-",
  description: "description-",
  kitchenName: "kitchen-name",
  image: "image",
  unitId: "unit",
  unitPrice: "unit-price",
  vatClass: "tax",
  categoryIds: "primary",
  primaryCategoryId: "primary",
};

/**
 * The editor field a rejected product write's `field` belongs to, or null when nothing on this
 * screen holds it. The composing screen uses it to put the server's refusal beside the field it
 * names, which is also what opens the section that field is folded into.
 */
export function productEditorField(field: string, defaultLanguage: string): string | null {
  const variant = /^variants\.(\d+)\.(name|unitPrice)$/.exec(field);
  if (variant) return `variant-${variant[1]}-${variant[2] === "name" ? "name" : "price"}`;
  // A refused attachment (`modifiers.<n>.id`, thrown by packages/catalogue/src/product-modifiers.ts
  // when a list was deleted or is named twice) points at the Modifiers section's one control,
  // whatever position it names: the attached rows are a table with no input of their own.
  if (/^modifiers\.\d+\.id$/.test(field)) return "modifier";
  const mapped = SERVER_FIELDS[field];
  if (mapped === undefined) return null;
  return mapped.endsWith("-") ? `${mapped}${defaultLanguage}` : mapped;
}

/**
 * The editor field a refused TRANSLATION belongs to. `content.translation_required` names the
 * language whose text is missing and never the value that lacks it
 * (`packages/catalogue/src/content-languages.ts`; the shape is pinned by
 * `packages/catalogue/src/product-editor.test.ts`), and one save carries several translated values:
 * the product's customer name and one per variant. Each of them missing that language is a fault the
 * save has to clear, so this points at the first and the next save reports whatever is still missing.
 *
 * Focus goes to the input for the language the SERVER named, not the first one on screen: that is
 * the only input whose emptiness refused the save. A variant's names are edited in its own window,
 * so a variant's problem belongs to its ROW.
 */
export function productEditorTranslationField(
  value: {
    customerName: LocalizedText | null;
    variants: readonly { customerName: LocalizedText | null }[];
  },
  language: string,
): string | null {
  const missing = (text: LocalizedText | null) => text !== null && !(text[language] ?? "").trim();
  if (missing(value.customerName)) return `customer-name-${language}`;
  const index = value.variants.findIndex((variant) => missing(variant.customerName));
  return index === -1 ? null : `variant-${index}-name`;
}

function emptyDraft(): ProductEditorDraft {
  return {
    name: "",
    customerName: null,
    description: null,
    kitchenName: null,
    image: null,
    unitId: null,
    unitPrice: "0.00",
    available: true,
    soldAlone: true,
    vatClass: "general",
    variants: [],
    categoryIds: [],
    primaryCategoryId: null,
    modifiers: [],
    allergens: null,
    dietaryDeclarations: [],
    stationId: null,
    courseId: null,
  };
}

/**
 * The product editor: one short form whose optional detail folds away behind `wt-disclosure`
 * sections, over a draft nothing writes to the server until Save.
 *
 * The product's own name is the plain STAFF name. The translated customer-facing name and the
 * kitchen name are separate optional fields that fall back to it, and both the fallback and the
 * product·variant join belong to `packages/catalogue/src/product-presentation.ts`, never to a
 * screen. The kitchen routing (station and course) travels in this form's own submitted value, so
 * a station this venue does not have rolls the product back instead of leaving it half saved.
 */
@customElement("dashboard-product-editor")
export class ProductEditor extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    ReorderController.styles,
    ReorderController.tableStyles,
    css`
      :host {
        display: block;
      }
      .form,
      .group {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }
      .form {
        gap: var(--wt-space-4);
      }
      .group-label {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        text-transform: uppercase;
      }
      .bordered-group {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
        margin: 0;
        padding: var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      .bordered-group legend {
        padding-inline: var(--wt-space-1);
        color: var(--wt-color-text);
        font-weight: var(--wt-font-weight-bold);
      }
      label {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }
      .row,
      .chips {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .error {
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
      /* A chip is the lozenge's tap target, so the BUTTON carries the minimum size rather than
         stretching something inside it past its own box. */
      .chip {
        display: inline-flex;
        align-items: center;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
      }
      .chip:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      /* The reporting category is marked by a RING, not by its colour: a category's colour is
         optional, so a colour-only rule leaves two identical chips whenever the reporting one has
         none. The ring is drawn on the lozenge so it follows the pill rather than the 44px button. */
      .chip.reporting wt-lozenge {
        border-radius: var(--wt-radius-full);
        box-shadow: 0 0 0 2px var(--wt-color-primary);
      }
      textarea {
        box-sizing: border-box;
        width: 100%;
        min-height: calc(var(--wt-tap-min) * 2);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
      }
      textarea:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .badge {
        padding: var(--wt-space-1) var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        font-size: var(--wt-font-size-sm);
      }
      th {
        font-weight: var(--wt-font-weight-bold);
      }
      /* Every cell of the attached-lists table holds one line of text or one tap-target-tall
         control, so the shared block's top alignment — which suits the two modifier-list
         forms, whose cells stack labelled inputs — leaves the name and the type reading above their
         own grip and row menu. Centre them instead; the handle's own override then changes nothing
         here. Guard: the one-line row test in product-editor.test.ts. */
      th,
      td {
        vertical-align: middle;
      }
      /* The name column is the one that grows; capping it keeps the actions on screen at phone
         width. The token is used in three different directions across the dashboard, which
         packages/ui/src/tokens/structure.css describes. */
      td:nth-child(2) {
        max-width: var(--wt-cell-name-max-width);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) childOpen = false;
  @property({ attribute: false }) locales: string[] = [];
  @property({ attribute: false }) value: ProductEditorDraft | null = null;
  @property({ attribute: false }) units: UnitChoice[] = [];
  @property({ attribute: false }) categories: CategorySummary[] = [];
  /** Every extras list and every options list the composing screen has loaded — what the Modifiers
   * section can attach, and where an attached row reads its name from. */
  @property({ attribute: false }) extraLists: ModifierListChoice[] = [];
  @property({ attribute: false }) optionLists: ModifierListChoice[] = [];
  @property({ attribute: false }) stations: ProductRoutingChoice[] = [];
  @property({ attribute: false }) courses: ProductRoutingChoice[] = [];
  @property({ attribute: false }) taxChoices?: {
    id: ProductEditorDraft["vatClass"];
    rate: string;
    label: string;
  }[];
  @property({ attribute: false }) fieldErrors: Record<string, string> = {};
  @property({ attribute: false }) api?: DashboardApi;
  @state() private draft: ProductEditorDraft = emptyDraft();
  @state() private errors: Record<string, string> = {};
  @state() private imageOpen = false;
  @state() private unitPickerOpen = false;
  /** The memberships the categories modal opened with. Non-null exactly while it is open, and a
   * stable object so the picker's own draft is not reseeded by an unrelated re-render. */
  @state() private categoriesValue: ProductCategories | null = null;
  @state() private variantOpen = false;
  /** Which variant the variant window is editing, or null while it is adding a new one. */
  @state() private variantIndex: number | null = null;
  private submitted = false;
  private generation = 0;
  /** The field to put focus in once the update that reported an error has rendered. */
  #focusField: string | null = null;
  /** The loaded lists' names, ready to look up: the Modifiers section reads one per attached row
   * and the combobox offers every unattached list, on each of this form's renders. */
  #listNames: ReadonlyMap<string, string> = new Map();

  readonly #reorder = new ReorderController(this, {
    order: () => this.draft.modifiers.map(modifierKey),
    move: (key, to) => {
      const from = this.draft.modifiers.findIndex((ref) => modifierKey(ref) === key);
      if (from < 0 || from === to) return;
      this.change("modifiers", reorder(this.draft.modifiers, from, to));
    },
    label: (key) => {
      const ref = this.draft.modifiers.find((entry) => modifierKey(entry) === key);
      return ref ? this.modifierLabel(ref) : t("editor.missing_choice");
    },
    busy: () => this.suspended,
    get reorderLabel(): string {
      return t("editor.reorder_modifier");
    },
  } satisfies ReorderModel);

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("extraLists") || changed.has("optionLists"))
      this.#listNames = modifierListNames(this.extraLists, this.optionLists);
    if (changed.has("value") || (changed.has("open") && this.open)) {
      this.draft = this.value ? structuredClone(this.value) : emptyDraft();
      this.generation++;
      this.imageOpen = false;
      this.errors = {};
      this.submitted = false;
      this.unitPickerOpen = false;
      this.categoriesValue = null;
      this.variantOpen = false;
      this.variantIndex = null;
      this.#variantProblems = new Map();
    }
    if ((changed.has("busy") && !this.busy) || changed.has("fieldErrors")) this.submitted = false;
    // A field error the SERVER reported is surfaced the same way a local one is: its section opens
    // and focus goes to it, so a rejected save never hides its reason behind a folded header.
    if (changed.has("fieldErrors")) {
      this.aimFocus(this.fieldErrors);
      this.recordVariantProblems();
    }
  }

  override updated(): void {
    const name = this.#focusField;
    if (name === null) return;
    this.#focusField = null;
    void this.focusField(name);
  }
  /** Puts focus in the field an error names. A field inside a collapsed section is still HIDDEN
   * when this update finishes — the section opens itself on `has-error` during its own update —
   * and focusing a hidden element silently does nothing, so wait for that section first. */
  private async focusField(name: string): Promise<void> {
    await this.updateComplete;
    const field = this.shadowRoot?.querySelector<HTMLElement>(`[name="${name}"]`);
    if (!field) {
      await this.focusVariantRow(name);
      return;
    }
    const section = field.closest<HTMLElement & { updateComplete?: Promise<unknown> }>(
      "wt-disclosure",
    );
    await section?.updateComplete;
    field.focus();
  }

  /** A variant has no input of its own in this form — its fields live in the window the row's Edit
   * action opens — so that action is where a problem reported against a variant puts focus. */
  private async focusVariantRow(name: string): Promise<void> {
    const row = /^variant-(\d+)-/.exec(name);
    const table = this.shadowRoot?.querySelector("dashboard-variant-table");
    if (!row || !table) return;
    await table.updateComplete;
    table.focusRow(Number(row[1]));
  }

  get currentValue(): ProductEditorDraft {
    return structuredClone(this.draft);
  }
  private get suspended() {
    return (
      this.busy ||
      this.childOpen ||
      this.imageOpen ||
      this.variantOpen ||
      this.categoriesValue !== null
    );
  }
  private error(name: string) {
    return this.fieldErrors[name] ?? this.errors[name] ?? "";
  }
  /** The reported problems in the order the fields appear, which is the order the summary lists
   * them and the order the first-error focus follows. */
  private get allErrors(): Record<string, string> {
    return { ...this.errors, ...this.fieldErrors };
  }
  private aimFocus(errors: Record<string, string>): void {
    this.#focusField = Object.keys(errors)[0] ?? null;
  }
  private sectionHasError(section: SectionName): boolean {
    return Object.keys(this.allErrors).some((key) =>
      SECTION_FIELDS[section].some((field) => key.startsWith(field)),
    );
  }
  /**
   * The reported problems that belong to a variant ROW, against the variant OBJECT rather than its
   * position. A variant is edited in its own window, so the table is the only place in the editor
   * its problem can be shown — and a reorder rewrites the array without revalidating, so a problem
   * held against an index would move onto whichever variant landed there and leave the offending
   * one unmarked. `dashboard-variant-table` keys its rows by the same identity, so the two agree.
   *
   * Editing or toggling a variant replaces its object and so drops its mark, which is right: that
   * verdict was about the value the row no longer holds. The next Save re-reports whatever is still
   * wrong.
   */
  #variantProblems = new Map<EditorVariant, string>();
  private recordVariantProblems(): void {
    const problems = new Map<EditorVariant, string>();
    for (const [key, message] of Object.entries(this.allErrors)) {
      const match = /^variant-(\d+)-(?:name|price)$/.exec(key);
      const variant = match ? this.draft.variants[Number(match[1])] : undefined;
      if (variant && !problems.has(variant)) problems.set(variant, message);
    }
    this.#variantProblems = problems;
  }
  private get variantErrors(): Record<number, string> {
    const rows: Record<number, string> = {};
    this.draft.variants.forEach((variant, index) => {
      const message = this.#variantProblems.get(variant);
      if (message !== undefined) rows[index] = message;
    });
    return rows;
  }
  private get taxes() {
    return (
      this.taxChoices ??
      VAT_CLASSES.map((id) => ({ id, rate: resolveVatRate(id), label: vatClassName(id) }))
    );
  }
  private get language() {
    return this.locales[0] ?? "en";
  }
  private text(value: LocalizedText) {
    return resolveContentText(value, this.language, this.language);
  }
  private unitLabel(unit: UnitChoice) {
    const name = this.text(unit.name);
    const abbr = this.text(unit.abbreviation);
    return abbr ? `${name} (${abbr})` : name;
  }
  /** The pricing unit's short form — what the price field's button and the variants table's price
   * column header both show. Never empty: a product with no stored unit is sold by the each, and
   * that is what it reads as. */
  private get unitShortLabel(): string {
    const unit = this.units.find((unit) => unit.id === this.draft.unitId);
    if (!unit) return t("editor.unit_each");
    return this.text(unit.abbreviation) || this.text(unit.name);
  }
  /** The unit dropdown is a chooser behind the price field's button. It also has to be on screen
   * whenever the server has rejected the unit — a field carrying an error cannot hide behind a
   * button that gives no sign anything is wrong. Having no unit is NOT such a case: it means Each,
   * which the button names like any other unit. */
  private get unitOpen(): boolean {
    return this.unitPickerOpen || this.error("unit") !== "";
  }
  private fields(): FieldContext {
    return { busy: this.busy, locales: this.locales, error: (key) => this.error(key) };
  }
  private change<K extends keyof ProductEditorDraft>(key: K, value: ProductEditorDraft[K]) {
    this.draft = { ...this.draft, [key]: value };
  }
  /**
   * The draft never holds exactly ONE variant: a lone variant is just the product's own price, so
   * it folds back into `unitPrice` and its row disappears. The server refuses a single variant
   * outright (`product.variant_count_invalid`), so this is the invariant, not a convenience. Only the
   * price folds back — with no variants the product's own Available switch is what governs.
   */
  private setVariants(variants: EditorVariant[]): void {
    if (variants.length === 1) {
      this.draft = { ...this.draft, unitPrice: variants[0]!.unitPrice, variants: [] };
      return;
    }
    this.change("variants", variants);
  }
  private related(event: Event, kind: ProductChildKind) {
    event.stopPropagation();
    if (this.suspended) return;
    this.dispatchEvent(
      new CustomEvent("wt-create-related", { detail: { kind }, bubbles: true, composed: true }),
    );
  }
  /**
   * A nested create returns through the composing screen, without reseeding the product.
   *
   * The kinds are `ProductChildKind`'s (`apps/dashboard/src/state/product-child-create.ts`), which
   * is what the composing screen's controller calls this with.
   */
  selectRelated(kind: ProductChildKind, id: string): void {
    if (kind === "unit") this.change("unitId", id);
    if (kind === "category" && !this.draft.categoryIds.includes(id)) {
      this.draft = {
        ...this.draft,
        categoryIds: [...this.draft.categoryIds, id],
        primaryCategoryId: this.draft.primaryCategoryId ?? id,
      };
    }
    if (kind === "extras" || kind === "options") {
      if (this.draft.modifiers.some((ref) => ref.kind === kind && ref.id === id)) return;
      this.change("modifiers", [...this.draft.modifiers, { kind, id }]);
    }
  }
  /**
   * Put focus back on the control that opened a child form, once that form closes.
   *
   * Both kinds of modifier list are added from the ONE combobox the Modifiers section renders, so
   * both return focus there.
   */
  returnRelatedFocus(kind: ProductChildKind): void {
    const control = kind === "extras" || kind === "options" ? "modifier" : kind;
    this.shadowRoot!.querySelector<HTMLElement>(`[data-test=add-${control}]`)?.focus();
  }
  private save(event: Event) {
    event.stopPropagation();
    if (this.suspended || this.submitted) return;
    // Inserted in the order the fields are rendered, so the summary reads top to bottom and the
    // first entry is the field focus lands in.
    const errors: Record<string, string> = {};
    if (!this.draft.name.trim()) errors.name = t("editor.name_required");
    if (
      this.draft.primaryCategoryId !== null &&
      !this.draft.categoryIds.includes(this.draft.primaryCategoryId)
    )
      errors.primary = t("editor.reporting_category_invalid");
    if (!this.taxes.some((tax) => tax.id === this.draft.vatClass))
      errors.tax = t("editor.tax_required");
    if (this.draft.variants.length === 0 && !isProductPrice(this.draft.unitPrice))
      errors["unit-price"] = t("editor.price_invalid");
    for (const [index, variant] of this.draft.variants.entries()) {
      if (!variant.name.trim()) errors[`variant-${index}-name`] = t("editor.variant_name_required");
      if (!isProductPrice(variant.unitPrice))
        errors[`variant-${index}-price`] = t("editor.price_invalid");
    }
    this.errors = errors;
    this.recordVariantProblems();
    if (Object.keys(errors).length) {
      this.aimFocus(errors);
      return;
    }
    this.submitted = true;
    const value = this.currentValue;
    value.name = value.name.trim();
    value.kitchenName = value.kitchenName?.trim() || null;
    value.customerName = blankToNull(value.customerName);
    value.description = blankToNull(value.description);
    this.dispatchEvent(
      new CustomEvent("wt-submit", { detail: { value }, bubbles: true, composed: true }),
    );
  }
  private cancel(event: Event) {
    event.stopPropagation();
    if (this.suspended) return;
    this.dispatchEvent(new CustomEvent("wt-cancel", { detail: {}, bubbles: true, composed: true }));
  }

  private openCategories(event: Event) {
    event.stopPropagation();
    if (this.suspended) return;
    this.categoriesValue = {
      categoryIds: [...this.draft.categoryIds],
      primaryCategoryId: this.draft.primaryCategoryId,
    };
  }

  private addVariant(event: Event) {
    event.stopPropagation();
    if (this.suspended) return;
    // The first Add turns the plain price into a "Regular" variant; the window that opens is for
    // the SECOND one, so a product that gains variants always has at least two.
    if (this.draft.variants.length === 0) {
      // Check the price HERE, while its field is still on screen. Once it has been folded into a
      // variant the field is gone, and an invalid value would have nowhere left to be corrected.
      if (!isProductPrice(this.draft.unitPrice)) {
        this.errors = { ...this.errors, "unit-price": t("editor.price_invalid") };
        this.#focusField = "unit-price";
        return;
      }
      this.change("variants", [
        {
          name: t("editor.variant_regular"),
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: this.draft.unitPrice,
          available: this.draft.available,
        },
      ]);
    }
    this.variantIndex = null;
    this.variantOpen = true;
  }

  private closeVariant(): void {
    this.variantOpen = false;
    this.variantIndex = null;
    // A cancelled first Add leaves the lone "Regular" variant behind; folding it back here is what
    // makes cancelling a true undo.
    this.setVariants(this.draft.variants);
  }

  private submitVariant(event: CustomEvent<{ value: EditorVariant }>): void {
    event.stopPropagation();
    const index = this.variantIndex;
    const variants =
      index === null
        ? [...this.draft.variants, event.detail.value]
        : this.draft.variants.map((variant, i) => (i === index ? event.detail.value : variant));
    this.variantOpen = false;
    this.variantIndex = null;
    this.setVariants(variants);
  }

  private renderCategories() {
    const chips = this.draft.categoryIds.map((id) => {
      const category = this.categories.find((category) => category.id === id);
      return {
        id,
        reporting: id === this.draft.primaryCategoryId,
        color: category?.color ?? "",
        path: category
          ? categoryPath(category, this.categories, currentLocale(), currentContentLanguages())
          : t("editor.missing_choice"),
      };
    });
    return html`<div class="group" data-section="categories">
      <span class="group-label">${t("editor.categories")}</span>
      <div class="chips">
        ${chips.map(
          (chip) =>
            html`<button
              type="button"
              class=${chip.reporting ? "chip reporting" : "chip"}
              data-test="category-chip"
              data-category=${chip.id}
              aria-label=${`${chip.reporting ? t("editor.reporting_category") : t("editor.choose_categories")}: ${chip.path}`}
              ?disabled=${this.suspended}
              @click=${this.openCategories}
            >
              <wt-lozenge color=${chip.color}>${chip.path}</wt-lozenge>
            </button>`,
        )}
        <wt-button
          shape="round"
          variant="secondary"
          data-test="pick-categories"
          aria-label=${t("editor.choose_categories")}
          ?disabled=${this.suspended}
          @click=${this.openCategories}
          ><wt-icon name="plus"></wt-icon
        ></wt-button>
        <wt-button
          variant="secondary"
          data-test="add-category"
          ?disabled=${this.suspended}
          @click=${(event: Event) => this.related(event, "category")}
          >${t("editor.add_category")}</wt-button
        >
      </div>
      <span class="error" id="primary-error">${this.error("primary")}</span>
    </div>`;
  }

  private renderKitchen() {
    const station = this.stations.find(({ id }) => id === this.draft.stationId)?.name;
    const course = this.courses.find(({ id }) => id === this.draft.courseId)?.name;
    const summary = [this.draft.kitchenName?.trim(), station, course]
      .filter((part): part is string => !!part)
      .join(SUMMARY_SEPARATOR);
    return html`<wt-disclosure
      data-section="kitchen"
      heading=${t("editor.section_kitchen")}
      summary=${summary}
      ?has-error=${this.sectionHasError("kitchen")}
    >
      <div class="group">
        ${textField(
          this.fields(),
          "kitchen-name",
          t("editor.kitchen_name"),
          this.draft.kitchenName ?? "",
          (value) => this.change("kitchenName", value),
        )}
        ${this.renderRouting(
          "product-station",
          t("product.station"),
          t("product.no_station"),
          this.stations,
          this.draft.stationId,
          (id) => this.change("stationId", id),
        )}
        ${this.renderRouting(
          "product-course",
          t("product.course"),
          t("product.no_course"),
          this.courses,
          this.draft.courseId,
          (id) => this.change("courseId", id),
        )}
      </div>
    </wt-disclosure>`;
  }

  private renderRouting(
    name: string,
    label: string,
    noneLabel: string,
    choices: ProductRoutingChoice[],
    selected: string | null,
    change: (id: string | null) => void,
  ) {
    return html`<label
      >${label}<select
        name=${name}
        @change=${(event: Event) => {
          event.stopPropagation();
          change((event.target as HTMLSelectElement).value || null);
        }}
      >
        <option value="" .selected=${selected === null}>${noneLabel}</option>
        ${choices.map(
          (choice) =>
            html`<option value=${choice.id} .selected=${choice.id === selected}>
              ${choice.name}
            </option>`,
        )}
      </select></label
    >`;
  }

  private renderDescriptors() {
    const named = (value: LocalizedText | null) => Object.keys(nonBlankNames(value ?? {}));
    const customer = named(this.draft.customerName);
    const described = named(this.draft.description);
    const summary = [
      customer.length
        ? t("editor.summary_customer_name").replace("{languages}", customer.join(", "))
        : "",
      described.length
        ? t("editor.summary_description").replace("{languages}", described.join(", "))
        : "",
      this.draft.image ? t("editor.summary_image") : "",
    ]
      .filter(Boolean)
      .join(SUMMARY_SEPARATOR);
    return html`<wt-disclosure
      data-section="descriptors"
      heading=${t("editor.section_descriptors")}
      summary=${summary}
      ?has-error=${this.sectionHasError("descriptors")}
    >
      <div class="group">
        ${optionalTextFields(
          this.fields(),
          "customer-name",
          t("editor.customer_name"),
          this.draft.customerName ?? {},
          (value) => this.change("customerName", value),
        )}
        ${this.locales.map(
          (locale) =>
            html`<label
              >${t("editor.description")} (${locale})<textarea
                name=${`description-${locale}`}
                .value=${this.draft.description?.[locale] ?? ""}
                @input=${(event: Event) => {
                  event.stopPropagation();
                  this.change("description", {
                    ...this.draft.description,
                    [locale]: (event.target as HTMLTextAreaElement).value,
                  });
                }}
              ></textarea>
            </label>`,
        )}
        ${
          this.api
            ? html`<dashboard-image-upload
                .api=${this.api}
                .image=${this.draft.image}
                @image-changed=${(event: CustomEvent<{ image: string | null }>) => {
                  event.stopPropagation();
                  this.change("image", event.detail.image);
                }}
                @image-picker-state=${(event: CustomEvent<{ open: boolean }>) => {
                  event.stopPropagation();
                  this.imageOpen = event.detail.open;
                }}
              ></dashboard-image-upload>`
            : nothing
        }
      </div>
    </wt-disclosure>`;
  }

  private renderNutrition() {
    const summary = [
      ...Object.keys(this.draft.allergens ?? {}).map((code) => allergenName(code)),
      ...this.draft.dietaryDeclarations.map((label) => t(`editor.diet.${label}`)),
    ].join(SUMMARY_SEPARATOR);
    return html`<wt-disclosure
      data-section="nutrition"
      heading=${t("editor.section_nutrition")}
      summary=${summary}
      ?has-error=${this.sectionHasError("nutrition")}
    >
      <dashboard-allergen-dietary-picker
        .busy=${this.suspended}
        .dietaryOptions=${dietaryLabels}
        .value=${{
          allergens: Object.keys(this.draft.allergens ?? {}),
          dietary: this.draft.dietaryDeclarations,
        }}
        @wt-change=${(
          event: CustomEvent<{
            value: { allergens: string[]; dietary: ProductEditorDraft["dietaryDeclarations"] };
          }>,
        ) => {
          event.stopPropagation();
          const allergens = Object.fromEntries(
            event.detail.value.allergens.map((code) => [
              code,
              this.draft.allergens?.[code] ??
                this.value?.allergens?.[code] ?? { presence: "contains" as const },
            ]),
          );
          this.draft = {
            ...this.draft,
            allergens,
            dietaryDeclarations: event.detail.value.dietary,
          };
        }}
      ></dashboard-allergen-dietary-picker>
    </wt-disclosure>`;
  }

  private renderPrice() {
    const unitLabel = this.unitShortLabel;
    return html`<fieldset class="bordered-group" data-section="price">
      <legend>${t("editor.pricing")}</legend>
      <label
        >${t("product.vat")} *<select
          name="tax"
          aria-required="true"
          aria-invalid=${this.error("tax") ? "true" : "false"}
          aria-describedby="tax-error"
          @change=${(event: Event) => {
            event.stopPropagation();
            this.change(
              "vatClass",
              (event.target as HTMLSelectElement).value as ProductEditorDraft["vatClass"],
            );
          }}
        >
          <option value="">${t("editor.choose")}</option>
          ${this.taxes.map((tax) => html`<option value=${tax.id} .selected=${tax.id === this.draft.vatClass}>${tax.label} (${tax.rate.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1")}%)</option>`)}
        </select></label
      ><span class="error" id="tax-error">${this.error("tax")}</span>
      ${
        this.draft.variants.length === 0
          ? html`<wt-price-input
              name="unit-price"
              label=${priceLabel(unitLabel)}
              unit=${t("editor.per_unit").replace("{unit}", unitLabel)}
              required
              ?disabled=${this.suspended}
              .value=${this.draft.unitPrice}
              .error=${this.error("unit-price")}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                event.stopPropagation();
                this.change("unitPrice", event.detail.value);
              }}
              @wt-unit-click=${(event: Event) => {
                event.stopPropagation();
                this.unitPickerOpen = true;
              }}
            ></wt-price-input>`
          : html`<dashboard-variant-table
              .variants=${this.draft.variants}
              unitLabel=${unitLabel}
              .unitId=${this.draft.unitId}
              .unitOptions=${[
                { value: null, label: t("editor.unit_each") },
                ...this.units.map((unit) => ({
                  value: unit.id,
                  label: this.text(unit.abbreviation) || this.text(unit.name),
                })),
              ]}
              addUnitLabel=${t("editor.add_unit")}
              .busy=${this.suspended}
              .errors=${this.variantErrors}
              @wt-unit-change=${(event: CustomEvent<{ unitId: string | null }>) => {
                event.stopPropagation();
                this.change("unitId", event.detail.unitId);
              }}
              @wt-add-unit=${(event: Event) => this.related(event, "unit")}
              @wt-reorder=${(event: CustomEvent<{ from: number; to: number }>) => {
                event.stopPropagation();
                // The table has ALREADY moved the row on screen, so a host that does not apply the
                // same move leaves the draft silently out of step with what is displayed.
                this.change(
                  "variants",
                  reorder(this.draft.variants, event.detail.from, event.detail.to),
                );
              }}
              @wt-toggle-available=${(
                event: CustomEvent<{ index: number; available: boolean }>,
              ) => {
                event.stopPropagation();
                this.change(
                  "variants",
                  this.draft.variants.map((variant, index) =>
                    index === event.detail.index
                      ? { ...variant, available: event.detail.available }
                      : variant,
                  ),
                );
              }}
              @wt-edit=${(event: CustomEvent<{ index: number }>) => {
                event.stopPropagation();
                this.variantIndex = event.detail.index;
                this.variantOpen = true;
              }}
              @wt-remove=${(event: CustomEvent<{ index: number }>) => {
                event.stopPropagation();
                this.setVariants(
                  this.draft.variants.filter((_, index) => index !== event.detail.index),
                );
              }}
            ></dashboard-variant-table>`
      }
      ${
        this.draft.variants.length === 0 && this.unitOpen
          ? html`<label
                >${t("product.unit")}<select
                  name="unit"
                  aria-invalid=${this.error("unit") ? "true" : "false"}
                  aria-describedby="unit-error"
                  @change=${(event: Event) => {
                    event.stopPropagation();
                    this.change("unitId", (event.target as HTMLSelectElement).value || null);
                    this.unitPickerOpen = false;
                  }}
                >
                  <option value="" .selected=${this.draft.unitId === null}>
                    ${t("editor.unit_each")}
                  </option>
                  ${this.units.map((unit) => html`<option value=${unit.id} .selected=${unit.id === this.draft.unitId}>${this.unitLabel(unit)}</option>`)}
                </select></label
              ><span class="error" id="unit-error">${this.error("unit")}</span>
              <div class="row">
                <wt-button
                  variant="secondary"
                  data-test="add-unit"
                  ?disabled=${this.suspended}
                  @click=${(event: Event) => this.related(event, "unit")}
                  >${t("editor.add_unit")}</wt-button
                >
              </div>`
          : nothing
      }
      <div class="row">
        <wt-button
          variant="secondary"
          data-test="add-variant"
          ?disabled=${this.suspended}
          @click=${this.addVariant}
          >${t("editor.add_variant")}</wt-button
        >
      </div>
    </fieldset>`;
  }

  /** The list's own STAFF name. This surface shows exactly one of a list's three names and it is
   * the staff one (docs/developers/products.md). */
  private modifierListName(ref: ProductModifierRef): string {
    return modifierListName(ref, this.#listNames);
  }
  /** Name and kind together — what a control that has room for only one string says, so two lists
   * of different kinds sharing a name are still told apart. */
  private modifierLabel(ref: ProductModifierRef): string {
    return kindLabel(this.modifierListName(ref), ref.kind);
  }

  private renderModifierRow(ref: ProductModifierRef) {
    const key = modifierKey(ref);
    const name = this.modifierListName(ref);
    const kind = t(KIND_TITLE[ref.kind]);
    return html`<tr data-test="attached-modifier" data-modifier=${key}>
      <td>${this.#reorder.handle(key)}</td>
      <td data-test="modifier-name">${name}</td>
      <td data-test="modifier-kind">${kind}</td>
      <td>
        <wt-row-actions
          align="end"
          label=${`${t("editor.modifier_actions")}: ${name}${SUMMARY_SEPARATOR}${kind}`}
          ><wt-button
            variant="secondary"
            data-test=${`edit-modifier-${key}`}
            .disabled=${this.suspended}
            @click=${(event: Event) => {
              event.stopPropagation();
              if (this.suspended) return;
              this.dispatchEvent(
                new CustomEvent("wt-edit-related", {
                  detail: { kind: ref.kind, id: ref.id },
                  bubbles: true,
                  composed: true,
                }),
              );
            }}
            >${t("action.edit")}</wt-button
          ><wt-button
            variant="danger"
            data-test=${`remove-modifier-${key}`}
            .disabled=${this.suspended}
            @click=${(event: Event) => {
              event.stopPropagation();
              if (this.suspended) return;
              this.change(
                "modifiers",
                this.draft.modifiers.filter((entry) => modifierKey(entry) !== key),
              );
            }}
            >${t("action.remove")}</wt-button
          ></wt-row-actions
        >
      </td>
    </tr>`;
  }

  /**
   * One ordered list mixing both kinds (spec
   * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §5), added to from a SINGLE
   * combobox rather than one per kind: every option's label and every attached row's Type cell name
   * the kind already, so a second control would add chrome without adding anything to read.
   */
  private renderModifiers() {
    const attached = this.draft.modifiers;
    const held = new Set(attached.map(modifierKey));
    const offered = (kind: ProductModifierRef["kind"]) =>
      (kind === "extras" ? this.extraLists : this.optionLists)
        .filter((list) => !held.has(modifierKey({ kind, id: list.id })))
        .map((list) => ({
          value: modifierKey({ kind, id: list.id }),
          label: kindLabel(list.name, kind),
        }));
    const options = [
      { value: CREATE_EXTRA_LIST, label: t("editor.create_extra_list") },
      { value: CREATE_OPTION_LIST, label: t("editor.create_option_list") },
      ...offered("extras"),
      ...offered("options"),
    ];
    return html`<div class="group" data-section="modifiers">
      <span class="group-label">${t("editor.modifiers")}</span>
      ${
        attached.length
          ? html`<div
              class="table-wrap"
              tabindex="0"
              role="region"
              aria-label=${t("editor.modifiers")}
            >
              <table>
                <caption class="visually-hidden">
                  ${t("editor.modifiers")}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <span class="visually-hidden">${t("editor.reorder_modifier")}</span>
                    </th>
                    <th scope="col">${t("editor.name")}</th>
                    <th scope="col">${t("editor.modifier_kind")}</th>
                    <th scope="col">
                      <span class="visually-hidden">${t("editor.modifier_actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  ${repeat(attached, modifierKey, (ref) => this.renderModifierRow(ref))}
                </tbody>
              </table>
            </div>`
          : nothing
      }
      ${this.#reorder.liveRegion()}
      <wt-combobox
        name="modifier"
        data-test="add-modifier"
        label=${t("editor.add_modifier")}
        placeholder=${t("editor.choose")}
        searchPlaceholder=${t("editor.search_choices")}
        noResultsLabel=${t("editor.no_modifiers")}
        .disabled=${this.suspended}
        .options=${options}
        .value=${""}
        .error=${this.error("modifier")}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          const chosen = event.detail.value;
          // A chosen row is a command, spent where it is chosen: one opens a nested form, the rest
          // attach a list to the table above. So the control returns to its placeholder — and it
          // has to be told to ON the element, because `wt-combobox` sets its own `value` when a row
          // is picked and Lit never re-commits the unchanged constant bound above
          // (docs/developers/conventions-ui.md measured that). Assigning rather than replacing the
          // element keeps the focus the pick just returned to the trigger.
          (event.currentTarget as HTMLElement & { value: string }).value = "";
          if (chosen === "") return;
          if (chosen === CREATE_EXTRA_LIST) this.related(event, "extras");
          else if (chosen === CREATE_OPTION_LIST) this.related(event, "options");
          else {
            const [kind, ...rest] = chosen.split(":");
            if (kind === "extras" || kind === "options") this.selectRelated(kind, rest.join(":"));
          }
        }}
      ></wt-combobox>
    </div>`;
  }

  override render() {
    const fields = this.fields();
    return html`<wt-modal
        .open=${this.open}
        heading=${t(this.value?.id ? "product.edit" : "product.new")}
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
        @wt-close=${(event: Event) => {
          if (event.target === event.currentTarget) this.cancel(event);
        }}
      >
        <wt-form-error-summary
          heading=${t("form.error_heading")}
          .errors=${Object.values(this.allErrors)}
        ></wt-form-error-summary>
        <div class="form">
          <div class="group" data-section="name">
            ${textField(
              fields,
              "name",
              t("editor.name"),
              this.draft.name,
              (value) => this.change("name", value),
              true,
            )}
          </div>
          ${this.renderCategories()}
          <div class="group" data-section="available">
            ${switchField(
              fields,
              "available",
              t("editor.available"),
              this.draft.available,
              (value) => this.change("available", value),
            )}
          </div>
          ${keyed(this.generation, this.renderKitchen())}
          ${keyed(this.generation, this.renderDescriptors())}
          ${keyed(this.generation, this.renderNutrition())} ${this.renderPrice()}
          ${this.renderModifiers()}
        </div>
        <wt-form-actions slot="footer"
          ><wt-button
            slot="cancel"
            variant="secondary"
            ?disabled=${this.suspended}
            @click=${this.cancel}
            >${t("action.cancel")}</wt-button
          >
          <wt-button
            data-test="save"
            .loading=${this.busy}
            ?disabled=${this.suspended}
            @click=${this.save}
            >${t("action.save")}</wt-button
          ></wt-form-actions
        >
      </wt-modal>
      <dashboard-variant-form
        .open=${this.variantOpen}
        .locales=${this.locales}
        .value=${
          this.variantIndex === null ? null : (this.draft.variants[this.variantIndex] ?? null)
        }
        unitLabel=${this.unitShortLabel}
        .api=${this.api}
        @wt-submit=${this.submitVariant}
        @wt-cancel=${(event: Event) => {
          event.stopPropagation();
          this.closeVariant();
        }}
      ></dashboard-variant-form>
      ${
        this.categoriesValue
          ? html`<wt-modal
              .open=${true}
              heading=${t("editor.categories")}
              @wt-close=${(event: Event) => {
                if (event.target === event.currentTarget) this.categoriesValue = null;
              }}
              ><dashboard-category-membership-picker
                .categories=${this.categories}
                .languages=${currentContentLanguages()}
                .value=${this.categoriesValue}
                @wt-submit=${(event: CustomEvent<{ value: ProductCategories }>) => {
                  event.stopPropagation();
                  this.draft = {
                    ...this.draft,
                    categoryIds: [...event.detail.value.categoryIds],
                    primaryCategoryId: event.detail.value.primaryCategoryId,
                  };
                  this.categoriesValue = null;
                }}
                @wt-cancel=${(event: Event) => {
                  event.stopPropagation();
                  this.categoriesValue = null;
                }}
              ></dashboard-category-membership-picker
            ></wt-modal>`
          : nothing
      }`;
  }
}

/** A translated field with nothing but blanks in it is absent, not empty text. */
function blankToNull(value: LocalizedText | null): LocalizedText | null {
  const kept = nonBlankNames(value ?? {});
  return Object.keys(kept).length ? kept : null;
}
