import {
  ReorderController,
  draftScopeFor,
  reorder,
  saveActionState,
  type ReorderModel,
} from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, submitOnEnter, type ComboboxOption, type SummaryField } from "@waitron/ui";
import { resolveContentText } from "@waitron/shared";
import { DIETARY_LABELS } from "@waitron/catalogue/src/dietary-declarations.js";
import { isProductPrice } from "@waitron/catalogue/src/modifier-limits.js";
import {
  VAT_CLASSES,
  localToday,
  vatRateOn,
  type VatClass,
} from "@waitron/catalogue/src/vat-rates.js";
import { PRODUCT_ORDERINGS } from "@waitron/catalogue/src/product-ordering.js";
import { categoryColor } from "@waitron/catalogue/src/color-inheritance.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-disclosure.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-lozenge.js";
import "@waitron/ui/src/components/wt-price-input.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-textarea.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "./allergen-dietary-picker.js";
import "./image-upload.js";
import "./variant-form.js";
import { EACH_CHOICE } from "./variant-table.js";
import { categoryPathField, categoryPathText } from "./classification-fields.js";
import { colorField, colorFieldStyles } from "./color-field.js";
import {
  defaultLanguageHint,
  languageText,
  namesLine,
  nonBlankNames,
  optionalTextFields,
  priceLabel,
  priceText,
  switchField,
  textField,
  withLanguageText,
  type FieldContext,
} from "./form-fields.js";
import type { CategorySummary, DashboardApi } from "../api/client.js";
import type { ProductModifierRef } from "@waitron/catalogue/src/product-types.js";
import type { ExtraOfferUsage } from "@waitron/catalogue/src/extra-usage.js";
import type {
  EditorVariant,
  ModifierListChoice,
  UnitChoice,
  LocalizedText,
  ProductEditorDraft,
  DietaryLabel,
  ProductRoutingChoice,
} from "./product-editor-model.js";
import {
  comparablePrice,
  modifierKey,
  modifierListName,
  modifierListNames,
  sameValue,
} from "./product-editor-model.js";
import type { ProductChildKind } from "../state/product-child-create.js";
import { t, currentLocale } from "../i18n/t.js";
import { allergenName, vatClassName } from "../i18n/domain.js";

const dietaryLabels: readonly DietaryLabel[] = DIETARY_LABELS;

const SUMMARY_SEPARATOR = " · ";

/** The two combobox rows that open a nested form instead of attaching a list that exists. Neither
 * can be mistaken for an attachment, whose value always carries a colon. */
const CREATE_EXTRA_LIST = "create-extras";
const CREATE_OPTION_LIST = "create-options";

const EDIT_COURSES = "edit-courses";

/** The word for each kind, taken from the Modifiers screen's own tab labels so a list is called the
 * same thing wherever it is named. */
const KIND_TITLE = { extras: "extras.title", options: "options.title" } as const;

function kindLabel(name: string, kind: ProductModifierRef["kind"]): string {
  return `${name}${SUMMARY_SEPARATOR}${t(KIND_TITLE[kind])}`;
}

/** Which field names each collapsed section holds, as PREFIXES. A section holding a validation
 * error cannot stay collapsed, and this is what its `has-error` is computed from. */
const SECTION_FIELDS = {
  kitchen: ["kitchen-name", "product-course"],
  descriptors: ["customer-name-", "description-"],
  price: ["tax", "unit"],
} as const;
type SectionName = keyof typeof SECTION_FIELDS;

/**
 * The field names the SERVER uses when it rejects a product body
 * (`packages/catalogue/src/product-editor-input.ts`), mapped onto this editor's field names, or a
 * key only the message above Save shows. A value ending in "-" names a translated field: the server
 * names such a field once for all of its languages, so there is no single language to point at and
 * the default content language's input is used.
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
  primaryCategoryId: "primary",
  color: "product-color",
  active: "active",
  ordering: "ordering",
  courseId: "product-course",
};

/**
 * The editor field a rejected product write's `field` belongs to, or null when this editor cannot
 * show it. A key with no input of its own (`active`) is shown in the message above Save alone.
 */
export function productEditorField(field: string, defaultLanguage: string): string | null {
  const variant = /^variants\.(\d+)\.(name|unitPrice|active)$/.exec(field);
  if (variant) return `variant-${variant[1]}-${variant[2] === "unitPrice" ? "price" : variant[2]}`;
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
 * (`packages/catalogue/src/content-languages.ts`), and one save carries several translated values:
 * the product's customer name and one per variant. This points at the first, and the next save
 * reports whatever is still missing.
 *
 * A variant's names are edited in its own window, so a variant's problem belongs to its ROW. The
 * server checks only the variants saved Active (`writeProductVariants`,
 * packages/catalogue/src/variants.ts), so an Inactive one is never blamed.
 */
export function productEditorTranslationField(
  value: {
    customerName: LocalizedText | null;
    variants: readonly { customerName: LocalizedText | null; active: boolean }[];
  },
  language: string,
): string | null {
  const missing = (text: LocalizedText | null) =>
    text !== null && !languageText(text, language).trim();
  if (missing(value.customerName)) return `customer-name-${language}`;
  const index = value.variants.findIndex(
    (variant) => variant.active && missing(variant.customerName),
  );
  return index === -1 ? null : `variant-${index}-name`;
}

const VARIANT_KEY = /^variant-(\d+)-(?:name|price|active)$/;

/** The error key a change to each draft field answers, so a refusal of that field goes once the
 * operator has changed it. A translated field's key is its prefix, completed per language. */
const DRAFT_ERROR_KEYS: Partial<Record<keyof ProductEditorDraft, string>> = {
  name: "name",
  customerName: "customer-name-",
  description: "description-",
  kitchenName: "kitchen-name",
  image: "image",
  unitId: "unit",
  unitPrice: "unit-price",
  vatClass: "tax",
  primaryCategoryId: "primary",
  color: "product-color",
  modifiers: "modifier",
  ordering: "ordering",
  courseId: "product-course",
};

function emptyDraft(defaultVatClass: VatClass = "general"): ProductEditorDraft {
  return {
    name: "",
    customerName: null,
    description: null,
    kitchenName: null,
    image: null,
    unitId: null,
    unitPrice: "0.00",
    active: true,
    available: true,
    ordering: "public",
    vatClass: defaultVatClass,
    variants: [],
    primaryCategoryId: null,
    color: null,
    modifiers: [],
    allergens: null,
    dietaryDeclarations: [],
    courseId: null,
  };
}

/**
 * The product's own name is the plain STAFF name. The translated customer-facing name and the
 * kitchen name are separate optional fields that fall back to it, and the fallback belongs to
 * `packages/catalogue/src/product-presentation.ts`, never to a screen. The kitchen course travels
 * in this form's own submitted value.
 *
 * Opened on a VARIANT (its read carries `inherited`), the same form is the variant's own page: every
 * field the variant may leave blank shows blank, with the parent's value as its hint except the
 * kitchen and customer-facing names, which hint the variant's own names, never the parent's; and
 * there is no Standalone ordering, Modifiers or Variants section.
 */
@customElement("dashboard-product-editor")
export class ProductEditor extends LitElement {
  static override styles = [
    baseStyles,
    ReorderController.styles,
    ReorderController.tableStyles,
    colorFieldStyles,
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
      .form > [data-section="descriptors"]:not([open]) + [data-section="nutrition"]:not([open]),
      .form > [data-section="nutrition"]:not([open]) + [data-section="price"]:not([open]) {
        margin-block-start: calc(-1 * var(--wt-space-4));
      }
      .form > [data-section="modifiers"] {
        margin-block-start: var(--wt-space-2);
      }
      .group-label {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        text-transform: uppercase;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }
      fieldset.group {
        min-inline-size: 0;
        margin: 0;
        padding: 0;
        border: 0;
      }
      fieldset.group > legend {
        padding: 0;
        margin-block-end: var(--wt-space-3);
      }
      .row,
      .chips {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
      wt-button.link::part(button) {
        font-weight: var(--wt-font-weight-normal);
        text-decoration: underline;
      }
      .error {
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
      wt-dialog[data-test="unit-chooser"] {
        --wt-dialog-max-width: min(90vw, var(--wt-modal-compact-width));
      }
      /* A wt-dialog is as wide as its content: asking for the form width grows the dialog to its
         compact cap, and the chooser then fills the dialog's body. */
      .unit-chooser {
        inline-size: var(--wt-form-max-width);
        max-inline-size: 100%;
      }
      .notice {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      /* As tall as the product page's Change link, so the form below starts at the same height. */
      .category-path {
        display: flex;
        align-items: center;
        min-height: var(--wt-tap-min);
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        overflow-wrap: anywhere;
      }
      .nutrition-hints {
        gap: var(--wt-space-1);
        margin-top: var(--wt-space-3);
      }
      .hint {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .nutrition-hints .hint {
        font-style: italic;
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
      /* The grip and the row menu are a tap target tall and the name and type are text, so the cells
         start at their top and each text cell is padded by half the difference: a one-line row
         reads as one line, and a wrapping name keeps the grip, type and menu on its first line.
         The --wt-space-2 term repeats the cell padding of ReorderController.tableStyles and must
         change with it. Guard: the one-line and wrapping-name row tests in product-editor.test.ts. */
      th {
        vertical-align: middle;
      }
      tbody td {
        vertical-align: top;
      }
      tbody td:is(:nth-child(2), :nth-child(3)) {
        padding-block-start: calc(var(--wt-space-2) + (var(--wt-tap-min) - 1lh) / 2);
      }
      /* The name column is the one that grows; capping it keeps the actions on screen at phone
         width. The token is used in three different directions across the dashboard, which
         packages/ui-core/src/tokens/structure.css describes. */
      td:nth-child(2) {
        max-width: var(--wt-cell-name-max-width);
      }
      /* The row's button lies over the whole row; the handle and the row menu are lifted above it
         so they keep their own clicks, and a dragged row above them, because the reorder
         controller's own lift of 1 would tie with them. */
      tbody tr {
        position: relative;
      }
      tbody tr:not([data-dragging]):hover td,
      tbody tr:not([data-dragging]):focus-within td {
        background: var(--wt-color-bg);
      }
      .row-activate {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: pointer;
        z-index: 0;
      }
      .row-activate:disabled {
        cursor: default;
      }
      .row-activate:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      td :is(.handle, wt-row-actions) {
        position: relative;
        z-index: 1;
      }
      tbody tr[data-dragging] {
        z-index: 2;
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) childOpen = false;
  @property({ attribute: false }) locales: string[] = [];
  @property({ attribute: false }) defaultVatClass: VatClass = "general";
  @property({ attribute: false }) newCategoryId: string | null = null;
  @property({ attribute: false }) value: ProductEditorDraft | null = null;
  @property({ attribute: false }) units: UnitChoice[] = [];
  @property({ attribute: false }) categories: CategorySummary[] = [];
  @property({ attribute: false }) extraLists: ModifierListChoice[] = [];
  @property({ attribute: false }) optionLists: ModifierListChoice[] = [];
  @property({ attribute: false }) courses: ProductRoutingChoice[] = [];
  @property({ attribute: false }) taxChoices?: {
    id: ProductEditorDraft["vatClass"];
    rate: string;
    label: string;
  }[];
  @property({ attribute: false }) fieldErrors: Record<string, string> = {};
  @property({ attribute: false }) api?: DashboardApi;
  @state() private draft: ProductEditorDraft = emptyDraft();
  /** Set by the first press of Save; from then on the form re-checks itself on every change. */
  @state() private attempted = false;
  /** Refusal keys the operator has since changed the field of, or submitted past. */
  @state() private dismissed: ReadonlySet<string> = new Set();
  @property() initialField = "";
  @state() private imageOpen = false;
  @state() private unitPickerOpen = false;
  /** Which button opened the unit chooser, where focus goes back once it shuts. */
  #unitOpener: "price" | "heading" = "price";
  /** The attached row, and which of its controls, that asked for the list editor now open. */
  #relatedOpener: { key: string; via: "row" | "menu" } | null = null;
  @state() private unitUsage: ExtraOfferUsage[] = [];
  @state() private unitUsageUnavailable = false;
  #unitUsageGeneration = 0;
  #variantReturn: { index: number | null; row: boolean; scrollTop: number } | null = null;
  @state() private variantOpen = false;
  /** Which variant the variant window is editing, or null while it is adding a new one. */
  @state() private variantIndex: number | null = null;
  /** Whether the variants table shows the Inactive variants as well. */
  @state() private showInactive = false;
  /** Whether the Pricing fold starts open: on a product never saved, whose price and VAT are still
   * being set. Read once per product, so a fold the person closes stays closed. */
  #pricingStartsOpen = false;
  private submitted = false;
  private generation = 0;
  /** The field to put focus in once the update that reported an error has rendered. */
  #focusField: string | null = null;
  /** The standing messages, keyed by field, as of this render; what `error` reads. */
  #errorsNow: Record<string, string> = {};
  /** The keys of `#errorsNow` shown under a field, as of this render. */
  #fieldKeysNow: readonly string[] = [];
  /** The variant rows marked as of this render. */
  #rowsNow: Record<number, string> = {};
  #listNames: ReadonlyMap<string, string> = new Map();
  #categoryNodes: ReadonlyMap<string, CategorySummary> = new Map();

  #draftScope?: DraftScope<ProductEditorDraft>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.suspended) return false;
    return (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";
  };

  override disconnectedCallback(): void {
    this.#draftScope?.dispose();
    this.#draftScope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  readonly #reorder = new ReorderController(
    this,
    {
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
    } satisfies ReorderModel,
    { announce: () => t("action.reordered") },
  );

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("extraLists") || changed.has("optionLists"))
      this.#listNames = modifierListNames(this.extraLists, this.optionLists);
    if (changed.has("categories"))
      this.#categoryNodes = new Map(this.categories.map((category) => [category.id, category]));
    if (changed.has("value") || (changed.has("open") && this.open)) {
      this.#unitUsageGeneration++;
      this.unitUsage = [];
      this.unitUsageUnavailable = false;
      this.draft = this.value
        ? structuredClone(this.value)
        : { ...emptyDraft(this.defaultVatClass), primaryCategoryId: this.newCategoryId };
      this.generation++;
      this.imageOpen = false;
      this.attempted = false;
      this.dismissed = new Set();
      this.submitted = false;
      this.unitPickerOpen = false;
      this.variantOpen = false;
      this.variantIndex = null;
      this.showInactive = false;
      this.#pricingStartsOpen = !this.value?.id;
      this.#variantProblems = new Map();
      if (this.open && this.initialField === "image") this.#focusField = this.initialField;
      this.#draftScope?.dispose();
      this.#draftScope = undefined;
    }
    if (!this.open) {
      this.#draftScope?.dispose();
      this.#draftScope = undefined;
      this.#leave = undefined;
    } else if (!this.#draftScope) {
      const { coordinator, scope } = draftScopeFor(this, {
        id: this,
        current: () => this.currentValue,
        snapshot: (value) => structuredClone(value),
        equal: (a, b) => sameValue(this.comparisonValue(a), this.comparisonValue(b)),
        restore: (value) => {
          this.draft = value;
        },
      });
      this.#leave = coordinator;
      this.#draftScope = scope;
    }
    if ((changed.has("busy") && !this.busy) || changed.has("fieldErrors")) this.submitted = false;
    // A field error the SERVER reported is surfaced the same way a local one is: its section opens
    // and focus goes to it, so a rejected save never hides its reason behind a folded header.
    if (changed.has("fieldErrors")) {
      this.dismissed = new Set();
      // A refused unit opens the chooser once, so its message is on screen beside the dropdown.
      if (this.inherited === null && this.fieldErrors.unit) {
        this.#unitOpener = "price";
        this.unitPickerOpen = true;
      }
      this.recordVariantProblems();
      const shown = this.shownFields();
      this.#focusField =
        Object.keys(this.fieldErrors).find(
          (key) => shown.has(key) || this.#variantRefusalKeys.has(key),
        ) ?? null;
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
    if (name === "image") {
      await this.focusImage();
      return;
    }
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

  /** The photo control has no input of its own; its button is where a refused photo puts focus. */
  private async focusImage(): Promise<void> {
    const upload = this.shadowRoot?.querySelector<LitElement>("dashboard-image-upload");
    if (!upload) return;
    await upload.updateComplete;
    await this.shadowRoot?.querySelector<LitElement>("wt-modal")?.updateComplete;
    upload.shadowRoot?.querySelector<HTMLElement>("[data-test=choose-image]")?.focus();
  }

  /** A variant has no input of its own in this form — its fields live in the window the row's Edit
   * action opens — so that action is where a problem reported against a variant puts focus. */
  private async focusVariantRow(name: string): Promise<void> {
    const row = /^variant-(\d+)-/.exec(name);
    const table = this.shadowRoot?.querySelector("dashboard-variant-table");
    if (!row || !table) return;
    await table.updateComplete;
    await table.focusRow(Number(row[1]));
  }

  get currentValue(): ProductEditorDraft {
    return structuredClone(this.draft);
  }
  private get suspended() {
    return this.busy || this.childOpen || this.imageOpen || this.variantOpen;
  }
  private error(name: string) {
    return this.#errorsNow[name] ?? "";
  }
  private sectionHasError(section: SectionName): boolean {
    return this.#fieldKeysNow.some((key) =>
      SECTION_FIELDS[section].some((field) => key.startsWith(field)),
    );
  }
  /** The keys this form shows a message under a field for. A variant's problems are shown on its
   * row, which `variantRows` covers. */
  private shownFields(): ReadonlySet<string> {
    const keys = [
      "name",
      "kitchen-name",
      "tax",
      "unit-price",
      "product-course",
      ...this.locales.flatMap((locale) => [`customer-name-${locale}`, `description-${locale}`]),
    ];
    if (this.api) keys.push("image");
    if (this.inherited === null)
      keys.push("primary", "product-color", "unit", "ordering", "modifier");
    return new Set(keys);
  }
  private dismiss(...keys: string[]): void {
    if (keys.every((key) => this.dismissed.has(key))) return;
    this.dismissed = new Set([...this.dismissed, ...keys]);
  }
  /** Refusals not yet dismissed, over the form's own checks for everything but a variant row. A
   * refusal wins where both name one field. */
  private standingErrors(local: Record<string, string>): Record<string, string> {
    const own = Object.fromEntries(Object.entries(local).filter(([key]) => !VARIANT_KEY.test(key)));
    const refused = Object.fromEntries(
      Object.entries(this.fieldErrors).filter(
        ([key, message]) =>
          Boolean(message) && !this.dismissed.has(key) && !this.#variantRefusalKeys.has(key),
      ),
    );
    return { ...own, ...refused };
  }
  /** What the form says now: the messages under fields, the rows marked, and the one sentence
   * above Save. */
  private assess(local: Record<string, string>) {
    const errors = this.standingErrors(local);
    const rows = this.variantRows(local);
    const shown = this.shownFields();
    const fieldKeys = Object.keys(errors).filter((key) => shown.has(key));
    const formMessages = Object.entries(errors)
      .filter(([key]) => !shown.has(key))
      .map(([, message]) => message);
    const marked = fieldKeys.length > 0 || Object.keys(rows).length > 0;
    const bottom = [...formMessages, ...(marked ? [t("form.fix_fields")] : [])].join(" ");
    return { errors, fieldKeys, rows, bottom };
  }
  /**
   * The reported problems that belong to a variant ROW, against the variant OBJECT rather than its
   * position: a reorder rewrites the array without revalidating, so a problem held against an index
   * would move onto whichever variant landed there and leave the offending one unmarked.
   *
   * Editing or toggling a variant replaces its object and so drops its mark, which is right: that
   * verdict was about the value the row no longer holds.
   */
  #variantProblems = new Map<EditorVariant, string>();
  /** The refusal keys held against a variant row; a key naming no variant stays a form message. */
  #variantRefusalKeys: ReadonlySet<string> = new Set();
  private recordVariantProblems(): void {
    const problems = new Map<EditorVariant, string>();
    const keys = new Set<string>();
    for (const [key, message] of Object.entries(this.fieldErrors)) {
      const match = VARIANT_KEY.exec(key);
      const variant = match ? this.draft.variants[Number(match[1])] : undefined;
      if (!variant || !message) continue;
      keys.add(key);
      if (!problems.has(variant)) problems.set(variant, message);
    }
    this.#variantProblems = problems;
    this.#variantRefusalKeys = keys;
  }
  /** The form's own checks run on the variants as they now stand, so they follow a reorder. */
  private variantRows(local: Record<string, string>): Record<number, string> {
    const rows: Record<number, string> = {};
    this.draft.variants.forEach((variant, index) => {
      const message =
        this.#variantProblems.get(variant) ??
        local[`variant-${index}-name`] ??
        local[`variant-${index}-price`];
      if (message !== undefined) rows[index] = message;
    });
    return rows;
  }
  private get taxes() {
    return (
      this.taxChoices ??
      VAT_CLASSES.map((id) => ({
        id,
        rate: vatRateOn(id, localToday()),
        label: vatClassName(id),
      }))
    );
  }
  private get language() {
    return this.locales[0] ?? "en";
  }
  /** The parent's values, on a variant's own page; null on a product of its own. */
  private get inherited() {
    return this.value?.inherited ?? null;
  }
  private hint(test: string, text: string) {
    return html`<p class="hint" data-test=${test}>${text}</p>`;
  }
  private taxLabel(tax: { label: string; rate: string }) {
    return `${tax.label} (${tax.rate.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1")}%)`;
  }
  private text(value: LocalizedText) {
    return resolveContentText(value, this.language, this.language);
  }
  private unitLabel(unit: UnitChoice) {
    const name = this.text(unit.name);
    const abbr = this.text(unit.abbreviation);
    return abbr ? `${name} (${abbr})` : name;
  }
  /** Empty for a product with no unit; callers choose the no-unit wording from the empty string. */
  private get unitShortLabel(): string {
    const unitId = this.inherited ? this.inherited.unitId : this.draft.unitId;
    if (!unitId) return "";
    const unit = this.units.find((unit) => unit.id === unitId);
    if (!unit) return t("editor.missing_choice");
    return this.text(unit.abbreviation) || this.text(unit.name);
  }
  /** Only while the editor itself is open, and on a product's own page: a variant's unit is its
   * product's. */
  private get unitsShown(): boolean {
    return this.open && this.inherited === null && this.unitPickerOpen;
  }
  private openUnits(opener: "price" | "heading"): void {
    if (this.suspended) return;
    this.#unitOpener = opener;
    this.unitPickerOpen = true;
  }
  private closeUnits(): void {
    this.unitPickerOpen = false;
    void this.returnUnitFocus();
  }
  /** The dialog's own return goes to whatever had focus when it opened, which need not be the
   * opener: a refused unit opens it with no button pressed. */
  private async returnUnitFocus(): Promise<void> {
    await this.updateComplete;
    await this.shadowRoot!.querySelector<LitElement>("wt-dialog[data-test=unit-chooser]")
      ?.updateComplete;
    if (this.#unitOpener === "heading") {
      await this.shadowRoot!.querySelector("dashboard-variant-table")?.focusUnit();
      return;
    }
    const price = this.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-price-input"]>(
      "wt-price-input[name=unit-price]",
    );
    await price?.updateComplete;
    price?.focusUnit();
  }
  private fields(): FieldContext {
    return { busy: this.busy, locales: this.locales, error: (key) => this.error(key) };
  }
  private change<K extends keyof ProductEditorDraft>(key: K, value: ProductEditorDraft[K]) {
    const errorKey = DRAFT_ERROR_KEYS[key];
    if (errorKey?.endsWith("-")) {
      const before = (this.draft[key] ?? {}) as LocalizedText;
      const after = (value ?? {}) as LocalizedText;
      this.dismiss(
        ...[...new Set([...Object.keys(before), ...Object.keys(after)])]
          .filter((locale) => before[locale] !== after[locale])
          .map((locale) => `${errorKey}${locale}`),
      );
    } else if (errorKey !== undefined) this.dismiss(errorKey);
    this.draft = { ...this.draft, [key]: value };
    this.#draftScope?.changed();
    if (key === "unitId") void this.readUnitUsage();
  }

  private async readUnitUsage(): Promise<void> {
    const generation = ++this.#unitUsageGeneration;
    this.unitUsage = [];
    this.unitUsageUnavailable = false;
    const id = this.value?.id;
    if (!id || !this.api || this.draft.unitId === this.value?.unitId) return;
    try {
      const usage = await this.api.getProductExtraUsage(id);
      if (generation === this.#unitUsageGeneration && this.open && this.value?.id === id)
        this.unitUsage = usage;
    } catch {
      if (generation === this.#unitUsageGeneration && this.open && this.value?.id === id)
        this.unitUsageUnavailable = true;
    }
  }
  private changeVariant(index: number, next: (variant: EditorVariant) => EditorVariant): void {
    this.change(
      "variants",
      this.draft.variants.map((variant, i) => (i === index ? next(variant) : variant)),
    );
  }
  private related(event: Event, kind: ProductChildKind) {
    event.stopPropagation();
    if (this.suspended) return;
    this.#relatedOpener = null;
    this.dispatchEvent(
      new CustomEvent("wt-create-related", { detail: { kind }, bubbles: true, composed: true }),
    );
  }
  /** A nested create returns through the composing screen, without reseeding the product. */
  selectRelated(kind: ProductChildKind, id: string): void {
    if (kind === "unit") {
      this.change("unitId", id);
      this.unitPickerOpen = false;
    }
    if (kind === "courses") this.change("courseId", id);
    if (kind === "extras" || kind === "options") {
      if (this.draft.modifiers.some((ref) => ref.kind === kind && ref.id === id)) return;
      this.change("modifiers", [...this.draft.modifiers, { kind, id }]);
    }
  }
  clearCourse(): void {
    this.change("courseId", null);
  }
  /** A modifier list edited from an attached row returns focus to that row: to its button, or to
   * its menu when the menu's Edit opened the list. A new list, or one whose row is gone, returns
   * it to the combobox both kinds are added from. A unit goes back to Add unit while the chooser is
   * still open, and to the chooser's opener once a new unit has been chosen and the chooser shut. */
  returnRelatedFocus(kind: ProductChildKind): void {
    if (kind === "unit" && !this.unitPickerOpen) {
      void this.returnUnitFocus();
      return;
    }
    if (kind === "courses") {
      this.shadowRoot!.querySelector<HTMLElement>("[name=product-course]")?.focus();
      return;
    }
    if (kind === "extras" || kind === "options") {
      const opener = this.#relatedOpener;
      this.#relatedOpener = null;
      const attached = () =>
        [...this.shadowRoot!.querySelectorAll<HTMLElement>("tr[data-test=attached-modifier]")]
          .find((tr) => tr.dataset.modifier === opener?.key)
          ?.querySelector<HTMLElement>(opener?.via === "row" ? ".row-activate" : "wt-row-actions");
      if (attached()) {
        void this.focusOnceEnabled(attached);
        return;
      }
    }
    const control = kind === "extras" || kind === "options" ? "modifier" : kind;
    void this.focusOnceEnabled(() =>
      this.shadowRoot!.querySelector<HTMLElement>(`[data-test=add-${control}]`),
    );
  }
  /** The nested form's screen may hand focus back before this editor has drawn the control enabled
   * again, and a disabled control does not take focus; then it waits for that update. It gives up if
   * focus has moved meanwhile, even to the page body. */
  private async focusOnceEnabled(find: () => HTMLElement | null | undefined): Promise<void> {
    const target = find();
    target?.focus();
    if (!target || this.shadowRoot!.activeElement === target) return;
    const before = deepActiveElement();
    await this.updateComplete;
    const now = deepActiveElement();
    if (now === before) find()?.focus();
  }
  /** `restore` also makes an Inactive product Active again. Nothing else on the form changes
   * `active`, so a plain Save of an Inactive product keeps it Inactive. */
  private save(event: Event, restore = false) {
    event.stopPropagation();
    if (this.suspended || this.submitted) return;
    const errors = this.validate();
    if (this.attempted && Object.keys(errors).length) return;
    this.attempted = true;
    this.dismiss(...Object.keys(this.fieldErrors));
    this.#variantProblems = new Map();
    if (Object.keys(errors).length) {
      this.#focusField = Object.keys(errors)[0]!;
      return;
    }
    this.submitted = true;
    const value = this.submissionValue(this.currentValue, restore);
    this.dispatchEvent(
      new CustomEvent("wt-submit", { detail: { value }, bubbles: true, composed: true }),
    );
  }
  private submissionValue(draft: ProductEditorDraft, restore = false): ProductEditorDraft {
    const value = structuredClone(draft);
    delete value.inherited;
    if (draft.inherited != null) {
      if (!(value.unitPrice ?? "").trim()) value.unitPrice = null;
      // A variant always has its product's category, unit and colour; the server refuses its own.
      value.primaryCategoryId = null;
      value.unitId = null;
      value.color = null;
    }
    if (restore) value.active = true;
    value.name = value.name.trim();
    value.kitchenName = value.kitchenName?.trim() || null;
    value.customerName = blankToNull(value.customerName);
    value.description = blankToNull(value.description);
    return value;
  }

  private comparisonValue(draft: ProductEditorDraft): ProductEditorDraft {
    const value = this.submissionValue(draft);
    value.unitPrice = comparablePrice(value.unitPrice);
    value.variants = value.variants.map((variant) => ({
      ...variant,
      unitPrice: comparablePrice(variant.unitPrice),
    }));
    value.dietaryDeclarations =
      value.dietaryDeclarations === null ? null : [...value.dietaryDeclarations].sort();
    return value;
  }

  commitSaved(submitted: ProductEditorDraft): void {
    this.#draftScope?.commit(submitted);
  }

  closeSaved(submitted: ProductEditorDraft): void {
    this.commitSaved(submitted);
    this.open = false;
    this.shadowRoot!.querySelector("wt-modal")!.closeAfter("saved");
  }

  /** The form's own checks, keyed in the order the fields are rendered, so the first key is the
   * field focus lands in. */
  private validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!this.draft.name.trim()) errors.name = t("editor.name_required");
    const variantPage = this.inherited !== null;
    // On a variant a blank VAT class and a blank price read the parent's; set, they must be valid.
    const blankPrice = !(this.draft.unitPrice ?? "").trim();
    if (
      !(variantPage && this.draft.vatClass === null) &&
      !this.taxes.some((tax) => tax.id === this.draft.vatClass)
    )
      errors.tax = t("editor.tax_required");
    if (!(variantPage && blankPrice) && !isProductPrice(this.draft.unitPrice ?? ""))
      errors["unit-price"] = t("editor.price_invalid");
    for (const [index, variant] of this.draft.variants.entries()) {
      if (!variant.name.trim()) errors[`variant-${index}-name`] = t("editor.variant_name_required");
      // A variant with no price of its own sells at the product's.
      if (variant.unitPrice !== null && !isProductPrice(variant.unitPrice))
        errors[`variant-${index}-price`] = t("editor.price_invalid");
    }
    return errors;
  }
  private cancel(event: Event) {
    event.stopPropagation();
    if (this.suspended) return;
    if (this.#leave) void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
    else this.reportCancel();
  }

  private reportCancel(): void {
    this.dispatchEvent(new CustomEvent("wt-cancel", { detail: {}, bubbles: true, composed: true }));
  }

  private addVariant(event: Event) {
    event.stopPropagation();
    if (this.suspended) return;
    this.openVariant(null, "menu");
  }

  private openVariant(index: number | null, via: "row" | "menu"): void {
    const body = this.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector(".body")!;
    this.#variantReturn = {
      index,
      row: via === "row",
      scrollTop: body.scrollTop,
    };
    this.variantIndex = index;
    this.variantOpen = true;
  }

  private async returnVariantFocus(): Promise<void> {
    const opener = this.#variantReturn;
    this.#variantReturn = null;
    if (!opener) return;
    await this.updateComplete;
    const form = this.shadowRoot!.querySelector("dashboard-variant-form")!;
    await form.updateComplete;
    await form.shadowRoot!.querySelector("wt-modal")!.updateComplete;
    const table = this.shadowRoot!.querySelector("dashboard-variant-table");
    const target =
      opener.index === null
        ? this.shadowRoot!.querySelector<HTMLElement>("[data-test=add-variant]")
        : table?.shadowRoot!.querySelector<HTMLElement>(
            `[data-test=${opener.row ? "edit-row" : "actions"}-${opener.index}]`,
          );
    if (target instanceof LitElement) await target.updateComplete;
    if (!this.isConnected || !this.open || this.variantOpen) return;
    // Suspension disables the opener before the child opens; an edited row is replaced on Save.
    target?.focus({ preventScroll: true });
    this.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector(".body")!.scrollTop =
      opener.scrollTop;
  }

  /** After a Disable or Remove: a table left with no row on screen cannot keep the focus itself, so
   * it goes to what follows it — Show disabled while hidden variants remain, Add variant when none
   * do. */
  private async focusAfterRemove(): Promise<void> {
    const { variants } = this.draft;
    if (variants.length && (this.showInactive || variants.some((variant) => variant.active)))
      return;
    await this.updateComplete;
    this.shadowRoot!.querySelector<HTMLElement>(
      variants.length ? "[data-test=show-inactive]" : "[data-test=add-variant]",
    )?.focus();
  }

  private closeVariant(): void {
    this.variantOpen = false;
    this.variantIndex = null;
    void this.returnVariantFocus();
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
    this.change("variants", variants);
    this.shadowRoot!.querySelector("dashboard-variant-form")!.closeSaved(event.detail.value);
    void this.returnVariantFocus();
  }

  /** The product's category as a path, with Change; a variant's page shows its product's path,
   * which it cannot change. */
  private renderCategories() {
    const parent = this.inherited;
    if (parent) {
      const path = parent.primaryCategoryId
        ? categoryPathText(parent.primaryCategoryId, this.categories, t("editor.missing_choice"))
        : t("categories.none");
      return html`<div class="group" data-section="categories">
        <p class="category-path" data-test="category-path">
          <span class="visually-hidden">${t("editor.classification")}: </span>${path}
        </p>
      </div>`;
    }
    return html`<div class="group" data-section="categories">
      ${categoryPathField({
        name: "primary",
        label: t("editor.classification"),
        actionLabel: t("editor.change_category"),
        categories: this.categories,
        value: this.draft.primaryCategoryId,
        noneLabel: t("categories.none"),
        missingLabel: t("editor.missing_choice"),
        error: this.error("primary"),
        disabled: this.suspended,
        change: (id) => this.change("primaryCategoryId", id),
      })}
    </div>`;
  }

  private foldedValue(label: string, own: string | null, inherited: () => string): SummaryField {
    if (own !== null) return { label, value: own };
    if (this.inherited === null) return { label, value: t("modifiers.none_specified") };
    return { label, value: inherited(), placeholder: true };
  }

  private renderKitchen() {
    const { courseId } = this.draft;
    const summary = [
      // A variant's blank kitchen name falls back to its own Name, never the parent's.
      {
        label: t("editor.kitchen_name"),
        value: this.draft.kitchenName?.trim() || t("modifiers.none_specified"),
      },
      this.foldedValue(
        t("editor.summary_course"),
        courseId === null
          ? null
          : (this.courses.find(({ id }) => id === courseId)?.name ?? t("editor.missing_choice")),
        () =>
          this.blankChoice(t("modifiers.none_specified"), this.courses, this.inherited?.courseId),
      ),
    ];
    return html`<wt-disclosure
      data-section="kitchen"
      heading=${t("editor.section_kitchen")}
      .summaryFields=${summary}
      ?has-error=${this.sectionHasError("kitchen")}
    >
      <div class="group">
        ${textField(
          this.fields(),
          "kitchen-name",
          t("editor.kitchen_name"),
          this.draft.kitchenName ?? "",
          (value) => this.change("kitchenName", value),
          false,
          this.draft.name,
        )}
        ${this.renderCourse()}
      </div>
    </wt-disclosure>`;
  }

  /** What a routing dropdown's empty choice means: none, on a product of its own; the parent's
   * choice, on a variant. */
  private blankChoice(
    none: string,
    choices: ProductRoutingChoice[],
    parentId: string | null | undefined,
  ): string {
    if (this.inherited === null || !parentId) return none;
    return choices.find(({ id }) => id === parentId)?.name ?? t("editor.missing_choice");
  }

  private renderCourse() {
    const noneLabel = this.blankChoice(
      t("product.no_course"),
      this.courses,
      this.inherited?.courseId,
    );
    return html`<wt-combobox
      name="product-course"
      label=${t("product.course")}
      search="auto"
      searchPlaceholder=${t("categories.combobox_search")}
      noResultsLabel=${t("categories.combobox_no_results")}
      placeholder=${noneLabel}
      ?show-empty-option=${this.inherited === null}
      .options=${[
        { value: "", label: noneLabel },
        ...this.courses.map((choice) => ({ value: choice.id, label: choice.name })),
        { value: EDIT_COURSES, label: t("editor.edit_courses"), action: true, primary: true },
      ]}
      .value=${this.draft.courseId ?? ""}
      error=${this.error("product-course")}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.change("courseId", event.detail.value || null);
      }}
      @wt-combobox-action=${(event: Event) => this.related(event, "courses")}
    ></wt-combobox>`;
  }

  private languagesLine(value: LocalizedText | null): string {
    const none = t("modifiers.none_specified");
    const text = value ?? {};
    if (!namesLine(this.locales, text).length) return none;
    return this.locales
      .map((locale) => `${locale.toUpperCase()}: ${languageText(text, locale).trim() || none}`)
      .join(SUMMARY_SEPARATOR);
  }

  private renderName(fields: FieldContext) {
    const name = textField(
      fields,
      "name",
      t("editor.name"),
      this.draft.name,
      (value) => this.change("name", value),
      true,
    );
    if (!this.api) return html`<div class="group" data-section="name">${name}</div>`;
    return html`<div class="group" data-section="name">
      <dashboard-image-upload
        .draftParent=${this}
        thumbnail
        .api=${this.api}
        .image=${this.draft.image}
        .inheritedImage=${this.inherited?.image ?? null}
        .invalid=${!!this.error("image")}
        @image-changed=${(event: CustomEvent<{ image: string | null }>) => {
          event.stopPropagation();
          this.change("image", event.detail.image);
        }}
        @image-picker-state=${(event: CustomEvent<{ open: boolean }>) => {
          event.stopPropagation();
          this.imageOpen = event.detail.open;
        }}
        >${name}</dashboard-image-upload
      >
      ${
        this.error("image")
          ? html`<span class="error" data-test="image-error">${this.error("image")}</span>`
          : nothing
      }
    </div>`;
  }

  private renderColor() {
    return html`<div class="group" data-section="color">
      ${colorField({
        color: this.draft.color,
        name: "product-color",
        errorId: "product-color-error",
        categoryColor: categoryColor(this.draft.primaryCategoryId, this.#categoryNodes),
        error: this.error("product-color"),
        busy: this.suspended,
        change: (color) => this.change("color", color),
      })}
    </div>`;
  }

  private renderDescriptors() {
    const described = Object.keys(nonBlankNames(this.draft.description ?? {}));
    // Storage inherits a variant's description as one value across every language, so a parent's
    // text is a hint only while the variant describes itself in none of them.
    const hintSource =
      this.inherited === null || described.length
        ? this.draft.description
        : this.inherited.description;
    const descriptionHint = (locale: string) => {
      if (!hintSource || languageText(this.draft.description ?? {}, locale).trim()) return "";
      return languageText(hintSource, locale).trim()
        ? languageText(hintSource, locale)
        : defaultLanguageHint(hintSource, locale, this.language);
    };
    const summary = [
      { label: t("editor.name"), value: this.languagesLine(this.draft.customerName), lines: 1 },
      {
        ...this.foldedValue(
          t("editor.description"),
          described.length ? this.languagesLine(this.draft.description) : null,
          () => this.languagesLine(this.inherited!.description),
        ),
        lines: 2,
      },
    ];
    return html`<wt-disclosure
      data-section="descriptors"
      heading=${t("editor.section_descriptors")}
      .summaryRows=${summary}
      ?has-error=${this.sectionHasError("descriptors")}
    >
      <div class="group">
        ${optionalTextFields(
          this.fields(),
          "customer-name",
          t("editor.customer_name"),
          this.draft.customerName ?? {},
          (value) => this.change("customerName", value),
          this.draft.name,
          this.language,
        )}
        ${this.locales.map((locale) => {
          return html`<wt-textarea
            name=${`description-${locale}`}
            label=${`${t("editor.description")} (${locale})`}
            placeholder=${descriptionHint(locale)}
            .value=${languageText(this.draft.description ?? {}, locale)}
            error=${this.error(`description-${locale}`)}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              this.change(
                "description",
                withLanguageText(this.draft.description ?? {}, locale, event.detail.value),
              );
            }}
          ></wt-textarea>`;
        })}
      </div>
    </wt-disclosure>`;
  }

  private nutritionHints() {
    const parent = this.inherited;
    if (!parent) return nothing;
    return html`<div class="group nutrition-hints">
      ${
        this.draft.allergens === null
          ? this.hint(
              "allergens-hint",
              `${t("modifiers.allergens")}: ${
                parent.allergens === null
                  ? t("editor.allergens_unreviewed")
                  : Object.keys(parent.allergens)
                      .map((code) => allergenName(code))
                      .join(", ") || t("editor.allergens_none")
              }`,
            )
          : nothing
      }${
        this.draft.dietaryDeclarations === null
          ? this.hint(
              "dietary-hint",
              `${t("modifiers.dietary_preferences")}: ${
                parent.dietaryDeclarations.map((label) => t(`editor.diet.${label}`)).join(", ") ||
                t("editor.diet_none")
              }`,
            )
          : nothing
      }
    </div>`;
  }

  private renderNutrition() {
    const none = t("modifiers.none_specified");
    const allergens = (value: Record<string, unknown>) =>
      Object.keys(value)
        .map((code) => allergenName(code))
        .join(", ") || none;
    const dietary = (labels: readonly DietaryLabel[]) =>
      labels.map((label) => t(`editor.diet.${label}`)).join(", ") || none;
    const { allergens: ownAllergens, dietaryDeclarations: ownDietary } = this.draft;
    const parent = this.inherited;
    const summary = [
      // On a product's own page a list never reviewed reads as the open line reads it.
      this.foldedValue(
        t("modifiers.allergens"),
        ownAllergens === null ? null : allergens(ownAllergens),
        () =>
          parent!.allergens === null
            ? t("editor.allergens_unreviewed")
            : allergens(parent!.allergens),
      ),
      this.foldedValue(
        t("modifiers.dietary_preferences"),
        ownDietary === null ? null : dietary(ownDietary),
        () => dietary(parent!.dietaryDeclarations),
      ),
    ];
    return html`<wt-disclosure
      data-section="nutrition"
      heading=${t("editor.section_nutrition")}
      .summaryFields=${summary}
    >
      <dashboard-allergen-dietary-picker
        .busy=${this.suspended}
        .dietaryOptions=${dietaryLabels}
        .value=${{
          allergens: Object.keys(this.draft.allergens ?? {}),
          dietary: this.draft.dietaryDeclarations ?? [],
        }}
        @wt-change=${(
          event: CustomEvent<{
            value: { allergens: string[]; dietary: DietaryLabel[] };
          }>,
        ) => {
          event.stopPropagation();
          const { allergens: codes, dietary } = event.detail.value;
          const allergens = Object.fromEntries(
            codes.map((code) => [
              code,
              this.draft.allergens?.[code] ??
                this.value?.allergens?.[code] ?? { presence: "contains" as const },
            ]),
          );
          // On a variant an empty choice is blank, which reads the parent's: saved as an empty
          // overlay it would declare the variant free of every allergen its parent contains.
          const variantPage = this.inherited !== null;
          this.draft = {
            ...this.draft,
            allergens: variantPage && !codes.length ? null : allergens,
            dietaryDeclarations: variantPage && !dietary.length ? null : dietary,
          };
          this.#draftScope?.changed();
        }}
      ></dashboard-allergen-dietary-picker>
      ${this.nutritionHints()}
    </wt-disclosure>`;
  }

  /** Who may order the product on its own. A variant is only ever ordered under its dish, so its
   * page does not offer the choice. */
  private renderOrdering() {
    return html`<div class="group" data-section="ordering">
      <wt-combobox
        name="ordering"
        label=${t("product.ordering")}
        search="auto"
        searchPlaceholder=${t("categories.combobox_search")}
        noResultsLabel=${t("categories.combobox_no_results")}
        ?disabled=${this.suspended}
        .options=${PRODUCT_ORDERINGS.map((ordering) => ({
          value: ordering,
          label: t(`product.ordering_${ordering}`),
          description: t(`product.ordering_${ordering}_hint`),
        }))}
        .value=${this.draft.ordering}
        error=${this.error("ordering")}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.change("ordering", event.detail.value as ProductEditorDraft["ordering"]);
        }}
      ></wt-combobox>
    </div>`;
  }

  private renderTax() {
    const parent = this.inherited;
    const parentTax = parent && this.taxes.find((tax) => tax.id === parent.vatClass);
    const inheritedTax = parent ? (parentTax ? this.taxLabel(parentTax) : parent.vatClass) : null;
    const taxes = this.taxes.map((tax) => ({ value: tax.id, label: this.taxLabel(tax) }));
    return html`<wt-combobox
      name="tax"
      label=${t("product.vat")}
      ?required=${!parent}
      search="auto"
      searchPlaceholder=${t("categories.combobox_search")}
      noResultsLabel=${t("categories.combobox_no_results")}
      placeholder=${inheritedTax ?? t("editor.choose")}
      .options=${inheritedTax === null ? taxes : [{ value: "", label: inheritedTax }, ...taxes]}
      .value=${this.draft.vatClass ?? ""}
      error=${this.error("tax")}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        const value = event.detail.value;
        this.change(
          "vatClass",
          parent && value === "" ? null : (value as NonNullable<ProductEditorDraft["vatClass"]>),
        );
      }}
    ></wt-combobox>`;
  }

  /** The unit dropdown and Add unit, drawn only while the chooser is open. */
  private renderUnit() {
    const each = t("editor.unit_each");
    return html`<wt-combobox
        name="unit"
        label=${t("product.unit")}
        search="auto"
        searchPlaceholder=${t("categories.combobox_search")}
        noResultsLabel=${t("categories.combobox_no_results")}
        placeholder=${each}
        .options=${[
          { value: EACH_CHOICE, label: each },
          ...this.units.map((unit) => ({ value: unit.id, label: this.unitLabel(unit) })),
        ]}
        ?disabled=${this.suspended}
        .value=${this.draft.unitId ?? EACH_CHOICE}
        error=${this.error("unit")}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          if (this.suspended) return;
          const value = event.detail.value;
          this.change("unitId", value === EACH_CHOICE ? null : value);
          this.closeUnits();
        }}
      ></wt-combobox>
      <div class="row">
        <wt-button
          variant="secondary"
          data-test="add-unit"
          ?disabled=${this.suspended}
          @click=${(event: Event) => this.related(event, "unit")}
          >${t("editor.add_unit")}</wt-button
        >
      </div>`;
  }

  /** Beside the editor's window rather than in the Pricing section, which may be folded shut. */
  private renderUnitChooser() {
    return html`<wt-dialog
      data-test="unit-chooser"
      heading=${t("editor.pricing_unit")}
      .open=${this.unitsShown}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget && this.unitsShown) this.closeUnits();
      }}
    >
      ${this.unitsShown ? html`<div class="group unit-chooser">${this.renderUnit()}</div>` : nothing}
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          variant="secondary"
          data-test="close-unit-chooser"
          @click=${(event: Event) => {
            event.stopPropagation();
            this.closeUnits();
          }}
          >${t("action.close")}</wt-button
        ></wt-form-actions
      >
    </wt-dialog>`;
  }

  private get hasActiveVariant(): boolean {
    return this.draft.variants.some((variant) => variant.active);
  }

  private pricingSummary(amount: string, unitLabel: string) {
    const price = amount.trim();
    const tax = this.taxes.find((tax) => tax.id === this.draft.vatClass);
    return [
      ...(price
        ? [
            {
              label: t("editor.base_price"),
              value: unitLabel
                ? `${priceText(price)} ${t("editor.per_unit").replace("{unit}", unitLabel)}`
                : t("editor.price_each").replace("{price}", priceText(price)),
            },
          ]
        : []),
      ...(tax ? [{ label: t("product.vat"), value: this.taxLabel(tax) }] : []),
    ];
  }

  private renderPrice() {
    const unitLabel = this.unitShortLabel;
    const parent = this.inherited;
    const base = this.hasActiveVariant;
    const amount = this.draft.unitPrice ?? "";
    const fields = html`<wt-price-input
        name="unit-price"
        label=${
          !base
            ? priceLabel(unitLabel)
            : unitLabel
              ? t("editor.base_price_unit").replace("{unit}", unitLabel)
              : t("editor.base_price")
        }
        unit=${unitLabel ? t("editor.per_unit").replace("{unit}", unitLabel) : t("editor.unit_each")}
        ?fixed-unit=${parent !== null}
        locale=${currentLocale()}
        placeholder=${parent?.unitPrice ?? ""}
        ?required=${parent === null}
        ?disabled=${this.suspended}
        .value=${amount}
        .error=${[this.error("unit-price"), parent === null ? this.error("unit") : ""]
          .filter((message) => message !== "")
          .join(" ")}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.change("unitPrice", event.detail.value);
        }}
        @wt-unit-click=${(event: Event) => {
          event.stopPropagation();
          this.openUnits("price");
        }}
      ></wt-price-input>
      ${
        this.unitUsage.length
          ? html`<p data-test="unit-usage-warning">
              ${t("editor.unit_usage_warning")}
              ${this.unitUsage.map((product) =>
                product.lists.map(
                  (list) =>
                    html`${product.productName}:
                    ${list.name}${
                      list.menus.length
                        ? html` (${list.menus.map((menu) => menu.name).join(", ")})`
                        : nothing
                    } `,
                ),
              )}
            </p>`
          : nothing
      }
      ${
        this.unitUsageUnavailable
          ? html`<p data-test="unit-usage-unavailable">${t("editor.unit_usage_unavailable")}</p>`
          : nothing
      }
      ${this.renderTax()}`;
    if (!base)
      return html`<fieldset class="group" data-section="price">
        <legend class="group-label">${t("editor.pricing")}</legend>
        ${fields}
      </fieldset>`;
    return keyed(
      this.generation,
      html`<wt-disclosure
        data-section="price"
        heading=${t("editor.pricing")}
        .summaryFields=${this.pricingSummary(amount, unitLabel)}
        ?open=${this.#pricingStartsOpen}
        ?has-error=${this.sectionHasError("price")}
      >
        <div class="group">${fields}</div>
      </wt-disclosure>`,
    );
  }

  private renderVariants() {
    // Opening a variant's page replaces this form, so it waits until nothing here is unsaved.
    const unsaved = this.value !== null && !sameValue(this.draft, this.value);
    const { variants } = this.draft;
    const inactive = variants.filter((variant) => !variant.active).length;
    return html`<div class="group" data-section="variants">
      ${
        variants.length
          ? html`<span class="group-label">${t("editor.variants")}</span>
              <dashboard-variant-table
                .variants=${this.draft.variants}
                basePrice=${this.draft.unitPrice ?? ""}
                unitLabel=${this.unitShortLabel || t("editor.unit_each")}
                .busy=${this.suspended}
                .openBlocked=${unsaved}
                .errors=${this.#rowsNow}
                .showInactive=${this.showInactive}
                @wt-show-inactive=${(event: Event) => {
                  event.stopPropagation();
                  this.showInactive = true;
                }}
                @wt-unit-click=${(event: Event) => {
                  event.stopPropagation();
                  this.openUnits("heading");
                }}
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
                  this.changeVariant(event.detail.index, (variant) => ({
                    ...variant,
                    available: event.detail.available,
                  }));
                }}
                @wt-edit=${(event: CustomEvent<{ index: number; via: "row" | "menu" }>) => {
                  event.stopPropagation();
                  this.openVariant(event.detail.index, event.detail.via);
                }}
                @wt-open=${(event: CustomEvent<{ index: number }>) => {
                  event.stopPropagation();
                  const id = this.draft.variants[event.detail.index]?.id;
                  if (this.suspended || unsaved || id === undefined) return;
                  this.dispatchEvent(
                    new CustomEvent("wt-open-product", {
                      detail: { productId: id },
                      bubbles: true,
                      composed: true,
                    }),
                  );
                }}
                @wt-remove=${(event: CustomEvent<{ index: number }>) => {
                  event.stopPropagation();
                  const { index } = event.detail;
                  // Disable switches a saved variant off; one never saved has no row to keep, so
                  // Remove simply drops it from the draft.
                  if (this.draft.variants[index]?.id === undefined)
                    this.change(
                      "variants",
                      this.draft.variants.filter((_, i) => i !== index),
                    );
                  else this.changeVariant(index, (variant) => ({ ...variant, active: false }));
                  void this.focusAfterRemove();
                }}
                @wt-restore=${(event: CustomEvent<{ index: number }>) => {
                  event.stopPropagation();
                  this.changeVariant(event.detail.index, (variant) => ({
                    ...variant,
                    active: true,
                  }));
                }}
              ></dashboard-variant-table>`
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
        ${
          inactive
            ? html`<wt-button
                class="link"
                variant="ghost"
                data-test="show-inactive"
                @click=${(event: Event) => {
                  event.stopPropagation();
                  this.showInactive = !this.showInactive;
                }}
                >${
                  this.showInactive
                    ? t("editor.hide_disabled")
                    : inactive === 1
                      ? t("editor.show_disabled_one")
                      : t("editor.show_disabled").replace("{count}", String(inactive))
                }</wt-button
              >`
            : nothing
        }
      </div>
    </div>`;
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

  private editRelated(ref: ProductModifierRef, via: "row" | "menu"): void {
    if (this.suspended) return;
    this.#relatedOpener = { key: modifierKey(ref), via };
    this.dispatchEvent(
      new CustomEvent("wt-edit-related", {
        detail: { kind: ref.kind, id: ref.id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private renderModifierRow(ref: ProductModifierRef) {
    const key = modifierKey(ref);
    const name = this.modifierListName(ref);
    const kind = t(KIND_TITLE[ref.kind]);
    return html`<tr data-test="attached-modifier" data-modifier=${key}>
      <td>${this.#reorder.handle(key)}</td>
      <td data-test="modifier-name">
        <button
          type="button"
          class="row-activate"
          data-test=${`open-modifier-${key}`}
          aria-label=${`${t("action.edit")}: ${name}${SUMMARY_SEPARATOR}${kind}`}
          .disabled=${this.suspended}
          @click=${(event: Event) => {
            event.stopPropagation();
            this.editRelated(ref, "row");
          }}
        ></button
        >${name}
      </td>
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
              this.editRelated(ref, "menu");
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
   * One ordered list mixing both kinds, added to from a SINGLE combobox rather than one per kind:
   * every option's label and every attached row's Type cell name the kind already.
   */
  private renderModifiers() {
    const attached = this.draft.modifiers;
    const held = new Set(attached.map(modifierKey));
    const offered = (kind: ProductModifierRef["kind"]): ComboboxOption[] => {
      const group = t(KIND_TITLE[kind]);
      const create =
        kind === "extras"
          ? { value: CREATE_EXTRA_LIST, label: t("editor.create_extra_list") }
          : { value: CREATE_OPTION_LIST, label: t("editor.create_option_list") };
      return [
        ...(kind === "extras" ? this.extraLists : this.optionLists)
          .filter((list) => !held.has(modifierKey({ kind, id: list.id })))
          .map((list) => ({
            value: modifierKey({ kind, id: list.id }),
            label: kindLabel(list.name, kind),
            group,
          })),
        { ...create, group, icon: "plus", primary: true },
      ];
    };
    const options = [...offered("extras"), ...offered("options")];
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
    const local = this.attempted ? this.validate() : {};
    const { errors, fieldKeys, rows, bottom } = this.assess(local);
    const invalid = Object.keys(local).length > 0;
    const saveAction = saveActionState(this.#draftScope);
    this.#errorsNow = errors;
    this.#fieldKeysNow = fieldKeys;
    this.#rowsNow = rows;
    const fields = this.fields();
    return html`<wt-modal
        size="standard"
        .open=${this.open}
        .dismissible=${!this.suspended}
        .beforeClose=${this.#leave ? this.#beforeClose : undefined}
        heading=${
          this.inherited
            ? t("editor.edit_variant_of").replace("{name}", () => this.inherited!.name)
            : t(this.value?.id ? "product.edit" : "product.new")
        }
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
        @wt-close=${(event: Event) => {
          if (event.target === event.currentTarget && this.open) {
            event.stopPropagation();
            this.reportCancel();
          }
        }}
      >
        <div class="form">
          ${this.renderCategories()}
          ${
            this.draft.active
              ? nothing
              : html`<p class="notice" data-test="inactive-notice">
                  ${t("product.disabled_notice")}
                </p>`
          }
          ${keyed(this.generation, this.renderName(fields))}
          ${this.inherited ? nothing : this.renderColor()}
          <div class="group" data-section="available">
            ${switchField(
              fields,
              "available",
              t("editor.available"),
              this.draft.available,
              (value) => this.change("available", value),
            )}
          </div>
          ${this.inherited ? nothing : this.renderOrdering()}
          ${keyed(this.generation, this.renderKitchen())}
          ${keyed(this.generation, this.renderDescriptors())}
          ${keyed(this.generation, this.renderNutrition())} ${this.renderPrice()}
          ${this.inherited ? nothing : html`${this.renderVariants()} ${this.renderModifiers()}`}
        </div>
        <wt-form-actions slot="footer" .error=${bottom}
          ><wt-button
            slot="cancel"
            variant="secondary"
            ?disabled=${this.suspended}
            @click=${this.cancel}
            >${t("action.cancel")}</wt-button
          >
          ${
            this.draft.active
              ? nothing
              : html`<wt-button
                  slot="secondary"
                  variant="secondary"
                  data-test="restore"
                  .loading=${this.busy}
                  ?disabled=${this.suspended || invalid}
                  @click=${(event: Event) => this.save(event, true)}
                  >${t("product.enable")}</wt-button
                >`
          }
          <wt-button
            data-test="save"
            variant=${saveAction.variant}
            .loading=${this.busy}
            ?disabled=${saveAction.unchanged || this.suspended || invalid}
            @click=${this.save}
            >${t("action.save")}</wt-button
          ></wt-form-actions
        >
      </wt-modal>
      ${this.inherited === null ? this.renderUnitChooser() : nothing}
      <dashboard-variant-form
        .draftParent=${this}
        .open=${this.variantOpen}
        .locales=${this.locales}
        .value=${
          this.variantIndex === null ? null : (this.draft.variants[this.variantIndex] ?? null)
        }
        unitLabel=${this.unitShortLabel}
        basePrice=${this.draft.unitPrice ?? ""}
        .inheritedImage=${this.draft.image}
        .productName=${this.draft.name}
        .api=${this.api}
        @wt-submit=${this.submitVariant}
        @wt-cancel=${(event: Event) => {
          event.stopPropagation();
          this.closeVariant();
        }}
      ></dashboard-variant-form>`;
  }
}

/** A translated field with nothing but blanks in it is absent, not empty text. */
function blankToNull(value: LocalizedText | null): LocalizedText | null {
  const kept = nonBlankNames(value ?? {});
  return Object.keys(kept).length ? kept : null;
}

function deepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}
