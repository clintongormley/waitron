import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
// Value imports (not `import type`): pull in the child widget modules for their `@customElement`
// side effects, so `<dashboard-allergen-picker>` and `<dashboard-image-upload>` are registered
// before this form renders them (the `staff-screen.ts` widget-registration pattern).
import "./allergen-picker.js";
import "./image-upload.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { unitName, vatClassName } from "../i18n/domain.js";
import type { ImageUploader } from "./image-upload.js";
import type {
  AllergenDeclaration,
  AllergenEntry,
  CategorySummary,
  ContainsTag,
  Course,
  DietOverride,
  OptionGroup,
  PricingUnit,
  Product,
  ProductPatch,
  Station,
  VatClass,
} from "../api/client.js";

// Re-export so composing views (the a11y test, the catalogue screen) can name the category shape the
// form consumes without a second import path.
export type { CategorySummary } from "../api/client.js";

/** The VAT bands the form offers, in the `products.vat_class` CHECK-set order (`schema/catalogue.ts`). */
const VAT_CLASSES: readonly VatClass[] = ["general", "reduced", "super_reduced", "zero"];
/** The pricing bases the form offers, in the `products.pricing_unit` CHECK-set order. */
const PRICING_UNITS: readonly PricingUnit[] = ["each", "weight"];

/** The forced-diet labels the override sub-form offers, as tri-state controls (auto/yes/no). A LOCAL
 * copy of `@waitron/catalogue`'s `DietOverride` label keys (no runtime import — the #70 bundle rule);
 * halal/kosher have no derivation, so their meaningful states are auto/yes/no exactly like the others. */
const DIET_LABELS = ["vegan", "vegetarian", "halal", "kosher"] as const;
/** The contains-tags the override sub-form offers, as tri-state add/remove controls. A LOCAL copy of
 * `@waitron/catalogue`'s `CONTAINS_TAGS`; the tri-state (auto/add/remove) makes a tag impossible to
 * both add AND remove, so the disjointness the server enforces holds here by construction. */
const CONTAINS_TAGS: readonly ContainsTag[] = ["meat", "fish"];

/** A forced-label control's state: `""` = auto (key ABSENT from the override), else the forced value. */
type DietLabelState = "" | "yes" | "no";
/** A contains control's state: `""` = auto (in neither list), `"add"`/`"remove"` = the two lists. */
type DietContainsState = "" | "add" | "remove";

/** The contains-tag control state for `tag` given a stored override: `"add"` if the tag is in
 * `addContains`, `"remove"` if in `removeContains`, else `""` (auto). */
function containsStateOf(override: DietOverride | null, tag: ContainsTag): DietContainsState {
  if (override?.addContains?.includes(tag)) return "add";
  if (override?.removeContains?.includes(tag)) return "remove";
  return "";
}

/**
 * The `create-product` event detail — the whole form assembled. `allergens` is OMITTED (never sent as
 * `null`) when the picker is PENDING, because the server's `createProduct` throws `allergen.invalid_code`
 * on an explicit `allergens: null` (the create-vs-patch asymmetry); `image` is the same — it is
 * OMITTED when unset and never emitted as `null` (the POST route rejects a literal `null`), so it is
 * typed `string`, not `string | null`. `active` is always carried and threaded straight through the
 * create, so a product created INACTIVE is one atomic request (`createProduct` accepts `active`),
 * never a create-then-patch. `{}` is a REVIEWED-NONE declaration, distinct from PENDING, and IS sent.
 */
// `optionGroupIds` (Task 12) is ALWAYS present on this detail (never omitted, unlike `allergens`/
// `image`) — the attach section's ordered pick list is authoritative the moment the form renders it,
// so an untouched picker still sends `[]` rather than leaving the key out (the same shape as the PATCH
// below keeps one mental model for both modes).
export interface CreateProductDetail {
  catalogueId: string;
  categoryId: string | null;
  descriptions: Record<string, string>;
  unitPrice: string;
  vatClass: VatClass;
  pricingUnit: PricingUnit;
  allergens?: Record<string, AllergenEntry>;
  /** The staff diet override, or `null` for an EMPTY one (all labels auto, no contains edits) — ALWAYS
   * present, unlike `allergens`, because `dietOverride: null` is legal on create (no create-vs-patch
   * asymmetry). The screen threads it straight into the `ProductInput`. */
  dietOverride: DietOverride | null;
  image?: string;
  active: boolean;
  optionGroupIds: string[];
}

/** The `update-product` event detail: the product id + a patch of its mutable slice (`ProductPatch`). */
export interface UpdateProductDetail {
  id: string;
  patch: ProductPatch;
}

/**
 * The management dashboard's PRODUCT FORM: a `wt-dialog` (create + edit) composing the product's own
 * fields with the two landed catalogue widgets — `<dashboard-allergen-picker>` and
 * `<dashboard-image-upload>`. The catalogue screen (a later task) drives it by setting `.open`,
 * `.catalogueId`, `.categories`, `.api` and (for an edit) `.product`, and hears one of two events:
 * `create-product` (create mode) or `update-product { id, patch }` (edit mode). Like `person-form`,
 * the form does NOT call the API and does NOT close itself on confirm — the screen closes it on a
 * successful create/update, so a rejected write leaves the entered values in place.
 *
 * SEEDING. `willUpdate` reseeds every field from `product` whenever `product` changes or the dialog
 * opens, so opening the form for an edit pre-fills it and opening it for a create (`product` null)
 * starts it blank. The allergen picker is seeded through its `declaration` property (a separate
 * `seedAllergens` bound ONLY on reseed, never to the live value, so it does not fight the operator's
 * edits) and the image control through its `image` property; both children also announce their own
 * changes back through `allergens-changed` / `image-changed`, which this form captures (with
 * `stopPropagation`, the house pattern) into `allergens` / `image`.
 *
 * THE CREATE-VS-PATCH ALLERGEN ASYMMETRY is load-bearing. On CREATE a PENDING picker (`value === null`)
 * OMITS the `allergens` key entirely — an explicit `allergens: null` makes `createProduct` throw
 * `allergen.invalid_code`. On PATCH `allergens: null` is legal and clears the declaration back to
 * PENDING, so the edit patch always carries the current value, null included. `image` is omitted on
 * create when unset and always carried on patch (null clears the photo).
 *
 * A non-empty PRIMARY-locale (`locales[0]`) description is REQUIRED client-side — the column is NOT
 * NULL and a nameless product is a UI error — so confirm is blocked and a `role="alert"` shown when it
 * is empty. A single-flight `busy` property (set by the screen while a create/update round-trips)
 * makes confirm a no-op and disables the control, mirroring the staff screen's create guard — the
 * mutations are not server-idempotent.
 */
@customElement("dashboard-product-form")
export class ProductForm extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
      .option-groups {
        margin-bottom: var(--wt-space-4);
      }
      .option-groups-list {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin-bottom: var(--wt-space-3);
      }
      .option-group-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      .option-group-name {
        color: var(--wt-color-text);
        flex: 1;
      }
      .option-group-controls {
        display: flex;
        gap: var(--wt-space-2);
      }
      .option-group-pick {
        display: flex;
        align-items: flex-end;
        gap: var(--wt-space-3);
      }
      .diet-override {
        margin-bottom: var(--wt-space-4);
      }
      .diet-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
        gap: var(--wt-space-3);
      }
      .diet-grid label.field {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        margin-bottom: 0;
        color: var(--wt-color-text);
      }
    `,
  ];

  /** Whether the dialog is showing. The screen sets this to open the form; it clears on close. */
  @property({ type: Boolean, reflect: true }) open = false;

  /** The catalogue new products are created under — set by the screen (a create needs a catalogue). */
  @property() catalogueId = "";

  /** The categories the category `<select>` offers (loaded by the screen), plus a "— none —" option. */
  @property({ attribute: false }) categories: CategorySummary[] = [];

  /** The venue's active kitchen stations (from `DashboardApi.listStations`), the options the
   * EDIT-MODE station-override `<select>` offers (KDS-1). Empty by default; the screen assigns it. */
  @property({ attribute: false }) stations: Station[] = [];

  /** The venue's active kitchen courses (from `DashboardApi.listCourses`), the options the EDIT-MODE
   * product-course `<select>` offers (KDS-2). Empty by default; the screen assigns it. */
  @property({ attribute: false }) courses: Course[] = [];

  /** Every reusable option group (from `DashboardApi.listOptionGroups`), the attach section's picker
   * source (Task 12). Rendered in BOTH create and edit mode — unlike the station/course overrides, the
   * server accepts `optionGroupIds` on the create route too. Empty by default; the screen assigns it. */
  @property({ attribute: false }) optionGroups: OptionGroup[] = [];

  /**
   * The product's CURRENTLY-attached option group ids, in order (Task 12's read-back,
   * `DashboardApi.listProductOptionGroupIds`) — seeds the attach section's picked-and-ordered list.
   * Empty for a create (nothing to attach yet). Seeded on `product`/`open` like every other field, but
   * ALSO independently on its own change (see {@link willUpdate}): the screen's read-back is an ASYNC
   * call kicked off when the edit form opens, so this prop typically arrives on a LATER render than the
   * one that opens the form, and the attach list must pick it up then rather than only on open.
   */
  @property({ attribute: false }) attachedGroupIds: string[] = [];

  /** The locales a description field is rendered for; default `["es"]` (tenant-locale seeding deferred). */
  @property({ attribute: false }) locales: readonly string[] = ["es"];

  /** The product being edited, or null for a create. Setting it pre-fills every field on the next open. */
  @property({ attribute: false }) product: Product | null = null;

  /** The upload dependency threaded down to the image control (the `DashboardApi`, or a stub in tests). */
  @property({ attribute: false }) api?: ImageUploader;

  /** Single-flight gate: the screen sets it true while a create/update is in flight; confirm is a no-op. */
  @property({ type: Boolean }) busy = false;

  @state() private descriptions: Record<string, string> = {};
  @state() private unitPrice = "";
  @state() private vatClass: VatClass = "general";
  @state() private pricingUnit: PricingUnit = "each";
  @state() private categoryId: string | null = null;
  @state() private active = true;
  // The live allergen value (seeded, then updated by the picker's event). Kept SEPARATE from the
  // picker's `declaration` seed (`seedAllergens`) so a user edit — which changes this — never re-seeds
  // the picker and resets its per-code source inputs mid-typing.
  @state() private allergens: AllergenDeclaration = null;
  @state() private seedAllergens: AllergenDeclaration = null;
  // The diet-override sub-form's live state (Task 8b): a tri-state per forced label and per
  // contains-tag, seeded from the product's `dietOverride` on reseed. Kept as UI state (`""` = auto)
  // rather than a partial override so the "auto" option is a real selectable value, not a silent
  // absence — `#buildDietOverride` folds them back into a `DietOverride | null` on submit.
  @state() private dietLabels: Record<(typeof DIET_LABELS)[number], DietLabelState> = {
    vegan: "",
    vegetarian: "",
    halal: "",
    kosher: "",
  };
  @state() private dietContains: Record<ContainsTag, DietContainsState> = { meat: "", fish: "" };
  @state() private image: string | null = null;
  @state() private validationError: string | null = null;
  // The attach section's ordered pick list (Task 12) — seeded from `attachedGroupIds`, then mutated by
  // the add/move/remove controls. Kept SEPARATE from the prop so an operator's reordering survives an
  // unrelated re-render, exactly as `allergens` is kept separate from `seedAllergens` above.
  @state() private selectedGroupIds: string[] = [];
  // The attach picker's current choice; reconciled against the still-available groups in
  // `#availableGroups`/`#effectiveGroupChoice` (the add-picker pattern: the picker only offers
  // not-yet-attached groups, and its choice snaps to a still-available one).
  @state() private addGroupChoice = "";

  /**
   * Reseed every field from `product` on an open or a product change. Runs before render, so the
   * pre-filled values are in place for the first paint. A create (`product` null) resets to blanks +
   * defaults; an edit fills from the loaded product. Allergens are seeded from the MANUAL overlay
   * (`manualAllergens`), NOT the published `allergens` union: the published value folds in any
   * recipe-derived floor, so seeding — and re-saving — from it would double-count the derived
   * allergens into the manual overlay. Seeded into BOTH the live value (`allergens`, what a save
   * emits) and the picker's `declaration` seed (`seedAllergens`); the picker does not emit on seed,
   * so the form must seed its own live copy too, or an untouched edit would re-save the wrong value.
   *
   * The attach section's `selectedGroupIds` is reseeded from `attachedGroupIds` under a SEPARATE,
   * WIDER condition (also on `attachedGroupIds` changing alone) — deliberately not folded into the
   * guard above. The screen's read-back (`listProductOptionGroupIds`) is an ASYNC call kicked off when
   * an edit form opens, so `attachedGroupIds` typically arrives on a LATER render than the one that sets
   * `product`/`open`; if seeding were gated only on those two, that later arrival would never reach the
   * attach list. Were `attachedGroupIds` folded into the FIRST condition instead, its every later change
   * would re-trigger a full reseed of every other field too — discarding whatever the operator had
   * typed in the meantime, the exact bug `recipe-editor.ts`'s `willUpdate` comment warns against.
   */
  override willUpdate(changed: PropertyValues): void {
    if (changed.has("product") || (changed.has("open") && this.open)) {
      const p = this.product;
      this.descriptions = { ...(p?.descriptions ?? {}) };
      this.unitPrice = p?.unitPrice ?? "";
      this.vatClass = p?.vatClass ?? "general";
      this.pricingUnit = p?.pricingUnit ?? "each";
      this.categoryId = p?.categoryId ?? null;
      this.active = p?.active ?? true;
      this.allergens = p?.manualAllergens ?? null;
      this.seedAllergens = p?.manualAllergens ?? null;
      // Seed the diet sub-form from the MANUAL override alone (`dietOverride`), never the published
      // `diet` union — the same reasoning as seeding allergens from `manualAllergens`: seeding from the
      // recipe-folded profile would re-save the derived labels as manual on the next save.
      const ov = p?.dietOverride ?? null;
      this.dietLabels = {
        vegan: ov?.vegan ?? "",
        vegetarian: ov?.vegetarian ?? "",
        halal: ov?.halal ?? "",
        kosher: ov?.kosher ?? "",
      };
      this.dietContains = { meat: containsStateOf(ov, "meat"), fish: containsStateOf(ov, "fish") };
      this.image = p?.image ?? null;
      this.validationError = null;
    }
    if (
      changed.has("attachedGroupIds") ||
      changed.has("product") ||
      (changed.has("open") && this.open)
    ) {
      this.selectedGroupIds = [...this.attachedGroupIds];
      this.addGroupChoice = "";
    }
  }

  #onDescriptionChange(event: CustomEvent<{ value: string }>, locale: string): void {
    event.stopPropagation();
    this.descriptions = { ...this.descriptions, [locale]: event.detail.value };
    if (this.validationError) this.validationError = null;
  }

  #onUnitPriceChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.unitPrice = event.detail.value;
  }

  // Native `change` is `composed: false`, so `stopPropagation` on the three `<select>` handlers is
  // defensive consistency with the composed handlers, not a boundary guard (the person-form pattern).
  #onVatClassChange(event: Event): void {
    event.stopPropagation();
    this.vatClass = (event.target as HTMLSelectElement).value as VatClass;
  }

  #onPricingUnitChange(event: Event): void {
    event.stopPropagation();
    this.pricingUnit = (event.target as HTMLSelectElement).value as PricingUnit;
  }

  #onCategoryChange(event: Event): void {
    event.stopPropagation();
    const value = (event.target as HTMLSelectElement).value;
    this.categoryId = value === "" ? null : value;
  }

  /**
   * The station-override `<select>` changed (edit mode only, so `this.product` is set). The routing is
   * a SEPARATE server route from the product PATCH (`setProductStation`), so it fires its own live
   * event rather than joining the confirm patch — the floor screen's zone-assign shape. The empty
   * option maps to `null` (clear the override → inherit the category route), any other value to the
   * station id; emit `set-product-station { productId, stationId }` bubbles+composed for the screen.
   * `stopPropagation` is defensive consistency with the other composed `<select>` handlers.
   */
  #onStationChange(event: Event): void {
    event.stopPropagation();
    if (!this.product) return; // rendered only in edit mode; guards the non-null id read below
    const value = (event.target as HTMLSelectElement).value;
    this.dispatchEvent(
      new CustomEvent<{ productId: string; stationId: string | null }>("set-product-station", {
        detail: { productId: this.product.id, stationId: value === "" ? null : value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * The course `<select>` changed (edit mode only, so `this.product` is set). Like the station override,
   * the product course is a SEPARATE server route (`setProductCourse`), so it fires its own live event
   * rather than joining the confirm patch. The empty option maps to `null` (clear the default course),
   * any other value to the course id; emit `set-product-course { productId, courseId }` bubbles+composed
   * for the screen. `stopPropagation` is defensive consistency with the other composed `<select>` handlers.
   */
  #onCourseChange(event: Event): void {
    event.stopPropagation();
    if (!this.product) return; // rendered only in edit mode; guards the non-null id read below
    const value = (event.target as HTMLSelectElement).value;
    this.dispatchEvent(
      new CustomEvent<{ productId: string; courseId: string | null }>("set-product-course", {
        detail: { productId: this.product.id, courseId: value === "" ? null : value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #onActiveChange(event: CustomEvent<{ checked: boolean }>): void {
    event.stopPropagation();
    this.active = event.detail.checked;
  }

  /** Capture the picker's declaration; `stopPropagation` keeps its composed event inside this form. */
  #onAllergensChanged(event: CustomEvent<{ value: AllergenDeclaration }>): void {
    event.stopPropagation();
    this.allergens = event.detail.value;
  }

  /** A forced-label tri-state changed (vegan/vegetarian/halal/kosher). Native `change` is
   * `composed: false`, so `stopPropagation` is defensive consistency with the composed handlers. */
  #onDietLabelChange(event: Event, field: (typeof DIET_LABELS)[number]): void {
    event.stopPropagation();
    const value = (event.target as HTMLSelectElement).value as DietLabelState;
    this.dietLabels = { ...this.dietLabels, [field]: value };
  }

  /** A contains-tag tri-state changed (meat/fish → auto/add/remove). */
  #onDietContainsChange(event: Event, tag: ContainsTag): void {
    event.stopPropagation();
    const value = (event.target as HTMLSelectElement).value as DietContainsState;
    this.dietContains = { ...this.dietContains, [tag]: value };
  }

  /**
   * Fold the sub-form's tri-states back into a `DietOverride`, or `null` when it is EMPTY (every label
   * auto, no contains edits) — never `{}`. A forced label contributes its key only when not auto (the
   * leaf's key-absent = derivation-decides semantics); a contains-tag contributes to `addContains` /
   * `removeContains` only when set. The tri-state UI makes a tag impossible to add AND remove, so the
   * disjointness the server enforces holds by construction — no client-side conflict check needed.
   */
  #buildDietOverride(): DietOverride | null {
    const out: DietOverride = {};
    for (const field of DIET_LABELS) {
      const value = this.dietLabels[field];
      if (value !== "") out[field] = value;
    }
    const addContains: ContainsTag[] = [];
    const removeContains: ContainsTag[] = [];
    for (const tag of CONTAINS_TAGS) {
      const state = this.dietContains[tag];
      if (state === "add") addContains.push(tag);
      else if (state === "remove") removeContains.push(tag);
    }
    if (addContains.length > 0) out.addContains = addContains;
    if (removeContains.length > 0) out.removeContains = removeContains;
    return Object.keys(out).length === 0 ? null : out;
  }

  /** Capture the uploaded image reference; `stopPropagation` keeps its composed event inside this form. */
  #onImageChanged(event: CustomEvent<{ image: string }>): void {
    event.stopPropagation();
    this.image = event.detail.image;
  }

  // ── Option-group attach section (Task 12) ─────────────────────────────────────────────────────
  // Pick + ORDER which reusable option groups apply: an ordered list of picked rows (↑/↓/Remove) plus a
  // picker offering only the groups not yet picked. This state lives on the FORM (not a screen), because
  // the picked set is part of the SAME create/update body the confirm button sends — there is no
  // separate "save the attach set" route to call immediately, the way `set-product-station` is.

  /** The groups not yet in `selectedGroupIds` — the picker's option list, in `optionGroups` order. */
  #availableGroups(): OptionGroup[] {
    return this.optionGroups.filter((g) => !this.selectedGroupIds.includes(g.id));
  }

  /** The picker's effective selection: the current `addGroupChoice` if still available, else the first
   * available group (so a never-touched picker still adds a sensible group). */
  #effectiveGroupChoice(available: OptionGroup[]): string {
    if (this.addGroupChoice !== "" && available.some((g) => g.id === this.addGroupChoice)) {
      return this.addGroupChoice;
    }
    return available[0]?.id ?? "";
  }

  #onAddGroupChoiceChange(event: Event): void {
    event.stopPropagation();
    this.addGroupChoice = (event.target as HTMLSelectElement).value;
  }

  /** Append the picked group to the end of the attach list. */
  #addGroup(event: Event): void {
    event.stopPropagation();
    const id = this.#effectiveGroupChoice(this.#availableGroups());
    if (id === "") return;
    this.selectedGroupIds = [...this.selectedGroupIds, id];
    this.addGroupChoice = "";
  }

  /** Swap row `index` with its neighbour `delta` away (−1 up, +1 down). A move off either end is a
   * no-op — those buttons render disabled, this is the belt-and-braces guard. */
  #moveGroup(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= this.selectedGroupIds.length) return;
    const ids = [...this.selectedGroupIds];
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    this.selectedGroupIds = ids;
  }

  #removeGroup(index: number): void {
    this.selectedGroupIds = this.selectedGroupIds.filter((_, i) => i !== index);
  }

  /** The description map to emit: every locale whose value is non-empty (trimmed), value kept as typed. */
  #buildDescriptions(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [locale, text] of Object.entries(this.descriptions)) {
      if (text.trim() !== "") out[locale] = text;
    }
    return out;
  }

  /**
   * Assemble and emit the create/update event. `stopPropagation` keeps the confirm button's own
   * composed `click` inside this shadow boundary. Blocks (no event) on a `busy` gate and on an empty
   * primary-locale description (a `role="alert"` is shown instead). Then, for an edit, emits
   * `update-product { id, patch }` carrying every mutable field (allergens/image null included, both
   * legal to clear on a patch); for a create, emits `create-product` OMITTING `allergens` when the
   * picker is PENDING and `image` when unset (the create-vs-patch asymmetry).
   */
  #confirm(event: Event): void {
    event.stopPropagation();
    if (this.busy) return; // single-flight: a second confirm while one is in flight is ignored
    const primary = this.locales[0];
    if ((this.descriptions[primary] ?? "").trim() === "") {
      this.validationError = "product.description_required";
      return;
    }
    this.validationError = null;
    const descriptions = this.#buildDescriptions();

    if (this.product) {
      const patch: ProductPatch = {
        categoryId: this.categoryId,
        descriptions,
        unitPrice: this.unitPrice,
        vatClass: this.vatClass,
        pricingUnit: this.pricingUnit,
        allergens: this.allergens,
        dietOverride: this.#buildDietOverride(),
        image: this.image,
        active: this.active,
        optionGroupIds: [...this.selectedGroupIds],
      };
      this.dispatchEvent(
        new CustomEvent<UpdateProductDetail>("update-product", {
          detail: { id: this.product.id, patch },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }

    const body: CreateProductDetail = {
      catalogueId: this.catalogueId,
      categoryId: this.categoryId,
      descriptions,
      unitPrice: this.unitPrice,
      vatClass: this.vatClass,
      pricingUnit: this.pricingUnit,
      dietOverride: this.#buildDietOverride(),
      active: this.active,
      optionGroupIds: [...this.selectedGroupIds],
    };
    if (this.allergens !== null) body.allergens = this.allergens;
    if (this.image !== null) body.image = this.image;
    this.dispatchEvent(
      new CustomEvent<CreateProductDetail>("create-product", {
        detail: body,
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * The dialog closed. Drop our own `open` to stay self-consistent, and — like `person-form` —
   * deliberately do NOT `stopPropagation`: the composed `wt-close` must bubble on to the screen (the
   * owner of the open state). Fields are NOT reset here; `willUpdate` reseeds them on the next open.
   */
  #onClose(): void {
    this.open = false;
  }

  /** A group's PRIMARY-locale display name (`locales[0]`), falling back to any locale present in
   * `name`, falling back to the group's own id if `name` is somehow empty. Shared by the attach
   * section's pick list row and the picker `<option>` so the two never drift. */
  #groupLabel(group: OptionGroup): string {
    return group.name[this.locales[0]!] ?? Object.values(group.name)[0] ?? group.id;
  }

  /** One row of the attach section's ordered pick list: the group's name, ↑/↓ (disabled at the ends,
   * the belt-and-braces guard) and Remove. Falls back to the bare id if `optionGroups`
   * has not (yet) loaded the name for a seeded id — the read-back can resolve before the group list does. */
  #renderOptionGroupRow(id: string, index: number, total: number) {
    const group = this.optionGroups.find((g) => g.id === id);
    const name = group ? this.#groupLabel(group) : id;
    return html`
      <li class="option-group-row" data-test=${`option-group-attached-${id}`}>
        <span class="option-group-name">${name}</span>
        <div class="option-group-controls">
          <wt-button
            size="sm"
            aria-label=${`${t("action.move_up")} ${name}`}
            data-test=${`option-group-up-${id}`}
            ?disabled=${index === 0}
            @click=${() => this.#moveGroup(index, -1)}
            >↑</wt-button
          >
          <wt-button
            size="sm"
            aria-label=${`${t("action.move_down")} ${name}`}
            data-test=${`option-group-down-${id}`}
            ?disabled=${index === total - 1}
            @click=${() => this.#moveGroup(index, 1)}
            >↓</wt-button
          >
          <wt-button
            size="sm"
            variant="danger"
            data-test=${`option-group-remove-${id}`}
            @click=${() => this.#removeGroup(index)}
            >${t("action.remove")}</wt-button
          >
        </div>
      </li>
    `;
  }

  /** The whole attach section: the ordered pick list plus the picker that adds to it. Renders in BOTH
   * create and edit mode (Task 12 — unlike the station/course overrides above, `optionGroupIds` is
   * accepted on create too). */
  #renderOptionGroups() {
    const available = this.#availableGroups();
    const choice = this.#effectiveGroupChoice(available);
    return html`
      <section class="option-groups">
        <p class="field">${t("product.option_groups")}</p>
        <ol class="option-groups-list">
          ${this.selectedGroupIds.map((id, index) =>
            this.#renderOptionGroupRow(id, index, this.selectedGroupIds.length),
          )}
        </ol>
        ${
          available.length > 0
            ? html`<div class="option-group-pick">
                <label class="field"
                  >${t("product.option_groups_pick")}
                  <select
                    data-test="option-group-pick"
                    @change=${(e: Event) => this.#onAddGroupChoiceChange(e)}
                  >
                    ${available.map(
                      (g) =>
                        html`<option value=${g.id} .selected=${g.id === choice}>
                          ${this.#groupLabel(g)}
                        </option>`,
                    )}
                  </select>
                </label>
                <wt-button
                  variant="secondary"
                  data-test="option-group-add"
                  @click=${(e: Event) => this.#addGroup(e)}
                  >${t("product.option_groups_add")}</wt-button
                >
              </div>`
            : nothing
        }
      </section>
    `;
  }

  /** The diet-override sub-form (Task 8b): a tri-state `<select>` per forced label (auto/yes/no) and
   * per contains-tag (auto/add/remove), the diet twin of the allergen picker beside it. Each control is
   * labelled (its `t("diet.*")` name) so it is reachable in the accessibility tree. */
  #renderDietOverride() {
    return html`
      <section class="diet-override">
        <p class="field">${t("diet.section")}</p>
        <div class="diet-grid">
          ${DIET_LABELS.map(
            (field) => html`
              <label class="field"
                >${t(`diet.${field}`)}
                <select
                  data-test=${`diet-${field}`}
                  @change=${(e: Event) => this.#onDietLabelChange(e, field)}
                >
                  <option value="" .selected=${this.dietLabels[field] === ""}>
                    ${t("diet.auto")}
                  </option>
                  <option value="yes" .selected=${this.dietLabels[field] === "yes"}>
                    ${t("diet.yes")}
                  </option>
                  <option value="no" .selected=${this.dietLabels[field] === "no"}>
                    ${t("diet.no")}
                  </option>
                </select>
              </label>
            `,
          )}
          ${CONTAINS_TAGS.map(
            (tag) => html`
              <label class="field"
                >${t(`diet.contains_${tag}`)}
                <select
                  data-test=${`diet-contains-${tag}`}
                  @change=${(e: Event) => this.#onDietContainsChange(e, tag)}
                >
                  <option value="" .selected=${this.dietContains[tag] === ""}>
                    ${t("diet.contains_auto")}
                  </option>
                  <option value="add" .selected=${this.dietContains[tag] === "add"}>
                    ${t("diet.contains_add")}
                  </option>
                  <option value="remove" .selected=${this.dietContains[tag] === "remove"}>
                    ${t("diet.contains_remove")}
                  </option>
                </select>
              </label>
            `,
          )}
        </div>
      </section>
    `;
  }

  override render() {
    return html`
      <wt-dialog
        heading=${this.product ? t("product.edit") : t("product.new")}
        .open=${this.open}
        @wt-close=${() => this.#onClose()}
      >
        ${this.locales.map(
          (locale) => html`
            <wt-input
              class="field"
              data-test=${`description-${locale}`}
              label=${`${t("product.description")} (${locale})`}
              .value=${this.descriptions[locale] ?? ""}
              @wt-change=${(e: CustomEvent<{ value: string }>) =>
                this.#onDescriptionChange(e, locale)}
            ></wt-input>
          `,
        )}
        <wt-input
          class="field"
          data-test="unit-price"
          label=${t("product.price")}
          .value=${this.unitPrice}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onUnitPriceChange(e)}
        ></wt-input>
        <label class="field"
          >${t("product.vat")}
          <select data-test="vat-class" @change=${(e: Event) => this.#onVatClassChange(e)}>
            ${VAT_CLASSES.map(
              (v) =>
                html`<option value=${v} .selected=${v === this.vatClass}>
                  ${vatClassName(v)}
                </option>`,
            )}
          </select>
        </label>
        <label class="field"
          >${t("product.unit")}
          <select data-test="pricing-unit" @change=${(e: Event) => this.#onPricingUnitChange(e)}>
            ${PRICING_UNITS.map(
              (u) =>
                html`<option value=${u} .selected=${u === this.pricingUnit}>
                  ${unitName(u)}
                </option>`,
            )}
          </select>
        </label>
        <label class="field"
          >${t("product.category")}
          <select data-test="category" @change=${(e: Event) => this.#onCategoryChange(e)}>
            <option value="" .selected=${this.categoryId === null}>
              ${t("product.no_category")}
            </option>
            ${this.categories.map(
              (c) =>
                html`<option value=${c.id} .selected=${c.id === this.categoryId}>
                  ${c.name}
                </option>`,
            )}
          </select>
        </label>
        ${
          // Station override (KDS-1) — EDIT MODE ONLY: a new product has no id yet and inherits its
          // category route, so the override is offered only on an existing product (where the id is
          // known and the write route can address it). No persisted value is projected by the T7 read,
          // so it starts on "— inherit —" and is a write affordance.
          this.product
            ? html`<label class="field"
                >${t("product.station")}
                <select
                  data-test="product-station"
                  @change=${(e: Event) => this.#onStationChange(e)}
                >
                  <option value="">${t("product.no_station")}</option>
                  ${this.stations.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
                </select>
              </label>`
            : nothing
        }
        ${
          // Default course (KDS-2) — EDIT MODE ONLY, the sibling of the station override above: a new
          // product has no id yet, so the course write is offered only on an existing product. No
          // persisted value is projected by the read, so it starts on "— none —" and is a write affordance.
          this.product
            ? html`<label class="field"
                >${t("product.course")}
                <select data-test="product-course" @change=${(e: Event) => this.#onCourseChange(e)}>
                  <option value="">${t("product.no_course")}</option>
                  ${this.courses.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
                </select>
              </label>`
            : nothing
        }
        <wt-switch
          class="field"
          data-test="active"
          label=${t("product.active")}
          .checked=${this.active}
          @wt-change=${(e: CustomEvent<{ checked: boolean }>) => this.#onActiveChange(e)}
        ></wt-switch>
        ${this.#renderOptionGroups()}
        <dashboard-allergen-picker
          data-test="allergens"
          .declaration=${this.seedAllergens}
          @allergens-changed=${(e: CustomEvent<{ value: AllergenDeclaration }>) =>
            this.#onAllergensChanged(e)}
        ></dashboard-allergen-picker>
        ${this.#renderDietOverride()}
        <dashboard-image-upload
          data-test="image"
          .api=${this.api}
          .image=${this.image}
          @image-changed=${(e: CustomEvent<{ image: string }>) => this.#onImageChanged(e)}
        ></dashboard-image-upload>
        ${
          this.validationError
            ? html`<p class="error" role="alert" data-test="error">
                ${codeMessage(this.validationError)}
              </p>`
            : nothing
        }
        <wt-button
          slot="footer"
          variant="primary"
          data-test="confirm"
          ?disabled=${this.busy}
          @click=${(e: Event) => this.#confirm(e)}
          >${this.product ? t("action.save") : t("action.create")}</wt-button
        >
      </wt-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-product-form": ProductForm;
  }
}
