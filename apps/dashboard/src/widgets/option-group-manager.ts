import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "./allergen-picker.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { ALLERGEN_CODES, allergenName, vatClassName } from "../i18n/domain.js";
import { DIETARY_ORIGINS } from "../api/client.js";
import type { AllergenDeclaration, OptionGroup, OptionGroupItem, VatClass } from "../api/client.js";

/** The VAT bands the item VAT-override select offers — mirrors `product-form.ts`'s `VAT_CLASSES` (the
 * `products.vat_class` CHECK-set order, `schema/catalogue.ts`). Duplicated locally rather than shared:
 * no domain-constants module exports it, and every other enum-token table in this codebase (the LOCAL
 * type copies throughout `api/client.ts`, the `NameTable`s in `i18n/domain.ts`) is likewise a small,
 * deliberately-duplicated copy rather than an import, to keep each file's dependency edges obvious. */
const VAT_CLASSES: readonly VatClass[] = ["general", "reduced", "super_reduced", "zero"];

/** Parse a `wt-input`'s typed text as an integer. Returns `undefined` for anything not a finite
 * integer (an empty field, a partial "-", stray letters) so a caller can treat that as "ignore this
 * edit" rather than emitting a patch with `NaN` — the operator is mid-typing, not making an error. */
function parseInteger(value: string): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) ? n : undefined;
}

/** Build the name map to emit from a per-locale draft: every locale whose value is non-empty
 * (trimmed), value kept as typed — mirrors `product-form.ts`'s `#buildDescriptions`. */
function buildName(draft: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [locale, text] of Object.entries(draft)) {
    if (text.trim() !== "") out[locale] = text;
  }
  return out;
}

/** A group or item's display name for its list row: the primary locale, falling back to any other
 * value, then the bare id — a name in the wrong language beats a blank row, and an id beats nothing
 * (the `recipe-screen.ts` `#productName` rule). */
function primaryName(name: Record<string, string>, primaryLocale: string, id: string): string {
  return name[primaryLocale] ?? Object.values(name)[0] ?? id;
}

/**
 * The management dashboard's OPTION-GROUP MANAGER (Task 12): CRUD the tenant's reusable option groups
 * and their items — the modifier-authoring surface the product form's attach section (Task 12) and the
 * till's modifier picker (feat/ordering-modifiers) build on. Sibling to `category-manager.ts`: it owns
 * NO `api` and never talks to the server — the catalogue screen owns `listOptionGroups` /
 * `createOptionGroup` / `updateOptionGroup` / `listOptionGroupItems` / `createOptionGroupItem` /
 * `updateOptionGroupItem`, reloads after each mutation, and re-passes the refreshed `groups`/`items`
 * down, exactly as `catalogue-screen.ts` owns `listCategories`/`createCategory` for
 * `dashboard-category-manager`. `stopPropagation` on every composed child event, then re-dispatch
 * `bubbles`+`composed` for the screen — the house pattern every widget in this directory follows.
 *
 * TWO INLINE ERROR SLOTS, not the screen's top-of-page banner. The screen sets `groupError`/`itemError`
 * from a caught `{ code }` (`options.group_invalid` on an inconsistent min/max/required, or any other
 * rejection) and this widget renders it, localised via `codeMessage`, next to the form it belongs to —
 * mirrors `product-form.ts`'s own client-side `validationError` slot, except the codes here can
 * originate on the SERVER (a business-rule check, not a client-only shape check), so the screen is
 * still the one catching the rejection; this widget only owns where the message is shown.
 *
 * ITEMS ARE PER EXPANDED GROUP. `expandedGroupId` + `items` are both screen-owned: clicking a row's
 * "Items" button emits `toggle-option-group-items { groupId }`, and the screen decides whether that
 * opens or closes the panel (toggling `expandedGroupId`) and, on open, loads that group's items. Only
 * ONE group's items are ever shown at a time — the one-active-editor shape (only one row's detail
 * panel is expanded at a time).
 *
 * FIELD EDITS ON AN EXISTING ROW ARE IMMEDIATE, one PATCH per field — the `category-manager.ts`
 * per-row `<select>` pattern (no local buffering, no separate confirm), because every group/item field
 * is independently patchable server-side. A non-integer min/max/sort edit (an in-progress or invalid
 * typed value) is DROPPED rather than emitted with `NaN` — the operator is mid-typing.
 *
 * NAMES ARE SET ONLY ON CREATE, never edited in place — the same posture `category-manager.ts` takes
 * for an existing category's name (no update route for it either). One `wt-input` per `locales` entry,
 * mirroring `product-form.ts`'s per-locale description fields; the create fields are NOT cleared on
 * submit (the screen owns success via a prop reload, and a rejected create should leave the typed
 * values in place for a retry — the `category-manager.ts` convention).
 */
@customElement("dashboard-option-group-manager")
export class OptionGroupManager extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }

      .list {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin-bottom: var(--wt-space-4);
      }

      .row {
        display: flex;
        align-items: flex-end;
        gap: var(--wt-space-3);
        flex-wrap: wrap;
      }

      .name {
        color: var(--wt-color-text);
        min-width: 8rem;
        flex: 1;
      }

      .field {
        width: 6rem;
      }

      .create {
        display: flex;
        align-items: flex-end;
        gap: var(--wt-space-3);
        flex-wrap: wrap;
      }

      .items {
        margin-top: var(--wt-space-3);
        padding-top: var(--wt-space-3);
        border-top: 1px solid var(--wt-color-border);
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }

      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }

      label.vat,
      label.adds,
      label.removes {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        color: var(--wt-color-text);
      }

      /* The allergen adds/removes editors carry a whole grid / 14-option list — let them break to a
         full-width line under the single-line fields rather than squeeze into a 6rem column. */
      label.adds,
      label.removes {
        flex-basis: 100%;
      }
    `,
  ];

  /** Every option group (active AND inactive), from `DashboardApi.listOptionGroups`. Screen-owned and
   * refreshed after each mutation; defaults empty so the widget renders safely before the screen loads. */
  @property({ attribute: false }) groups: OptionGroup[] = [];

  /** The EXPANDED group's items only (active AND inactive), from `listOptionGroupItems`. Screen-owned. */
  @property({ attribute: false }) items: OptionGroupItem[] = [];

  /** Which group's items panel is open, or null. Screen-owned (the one-expanded-row
   * pattern) — this widget only asks to toggle it via `toggle-option-group-items`. */
  @property({ attribute: false }) expandedGroupId: string | null = null;

  /** The locales a create-name field is rendered for; default `["es"]`, mirrors `product-form.ts`. */
  @property({ attribute: false }) locales: readonly string[] = ["es"];

  /** A raw `{ code }` for the group create/edit form's inline error slot (e.g. `options.group_invalid`
   * on an inconsistent min/max/required), or null. Screen-owned; localised here via `codeMessage`. */
  @property() groupError: string | null = null;

  /** A raw `{ code }` for the item create/edit form's inline error slot, or null. Screen-owned. */
  @property() itemError: string | null = null;

  @state() private newGroupName: Record<string, string> = {};
  @state() private newGroupMinSelect = 0;
  @state() private newGroupMaxSelect = 1;
  @state() private newGroupRequired = false;
  @state() private newGroupActive = true;
  @state() private newGroupSort = 0;

  @state() private newItemName: Record<string, string> = {};
  @state() private newItemPriceDelta = "0.00";
  @state() private newItemVatClass: VatClass | null = null;
  @state() private newItemSort = 0;
  @state() private newItemActive = true;
  /** The per-option quantity cap for the create-item draft; default 1 ("no per-option quantity" — a
   * plain single choice). An integer like {@link newItemSort}, so it shares `#applyInteger`. */
  @state() private newItemMaxQuantity = 1;

  /** Reset the create-ITEM draft whenever the expanded group changes, so switching groups (or closing
   * the panel) never carries stale typed values into a different group's create form. The create-GROUP
   * draft has no such reseed — it is not scoped to anything that changes underneath it. */
  override willUpdate(changed: PropertyValues): void {
    if (!changed.has("expandedGroupId")) return;
    this.newItemName = {};
    this.newItemPriceDelta = "0.00";
    this.newItemVatClass = null;
    this.newItemSort = 0;
    this.newItemActive = true;
    this.newItemMaxQuantity = 1;
  }

  #onNewGroupNameChange(event: CustomEvent<{ value: string }>, locale: string): void {
    event.stopPropagation();
    this.newGroupName = { ...this.newGroupName, [locale]: event.detail.value };
  }

  /** Generic `wt-change` handler for an integer field (min/max/sort, new-row or existing-row alike):
   * stop the composed event, parse the typed text, and invoke `apply` with the result — dropping a
   * mid-typing/invalid value (`parseInteger` returns `undefined`) rather than applying `NaN`. Replaces
   * what were ~8 near-identical handlers differing only in `apply`; each callsite below supplies its
   * own assignment or `#updateGroup`/`#updateItem` dispatch inline, preserving that handler's exact
   * parse-or-ignore semantics. */
  #applyInteger(event: CustomEvent<{ value: string }>, apply: (n: number) => void): void {
    event.stopPropagation();
    const n = parseInteger(event.detail.value);
    if (n !== undefined) apply(n);
  }

  /** Generic `wt-change` handler for a boolean toggle (required/active, new-row or existing-row alike):
   * stop the composed event and invoke `apply` with the new checked state. Replaces what were ~6
   * near-identical handlers differing only in `apply`. */
  #applyBoolean(event: CustomEvent<{ checked: boolean }>, apply: (checked: boolean) => void): void {
    event.stopPropagation();
    apply(event.detail.checked);
  }

  /** Emit `create-option-group` with the drafted, fully-specified input (every field, not only the
   * ones the operator touched — the create-GROUP form has no server-side default to fall back on that
   * differs from what is already shown). `stopPropagation` keeps the button's composed `click` inside
   * this shadow boundary. Does NOT clear the draft — the screen owns success via a prop reload. */
  #createGroup(event: Event): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("create-option-group", {
        detail: {
          name: buildName(this.newGroupName),
          minSelect: this.newGroupMinSelect,
          maxSelect: this.newGroupMaxSelect,
          required: this.newGroupRequired,
          sort: this.newGroupSort,
          active: this.newGroupActive,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Emit an immediate `update-option-group { id, patch }` for one field of an existing row — the
   * `category-manager.ts` per-row `<select>` pattern (no local buffering, one PATCH per edit). */
  #updateGroup(id: string, patch: Record<string, unknown>): void {
    this.dispatchEvent(
      new CustomEvent("update-option-group", {
        detail: { id, patch },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Ask the screen to open/close `groupId`'s items panel. `stopPropagation` keeps the button's
   * composed `click` inside this shadow boundary. */
  #toggleItems(groupId: string, event: Event): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("toggle-option-group-items", {
        detail: { groupId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #onNewItemNameChange(event: CustomEvent<{ value: string }>, locale: string): void {
    event.stopPropagation();
    this.newItemName = { ...this.newItemName, [locale]: event.detail.value };
  }

  #onNewItemPriceChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newItemPriceDelta = event.detail.value;
  }

  #onNewItemVatChange(event: Event): void {
    event.stopPropagation();
    const value = (event.target as HTMLSelectElement).value;
    this.newItemVatClass = value === "" ? null : (value as VatClass);
  }

  /** Emit `create-option-group-item` for the EXPANDED group (rendered only while one is open, so
   * `expandedGroupId` is non-null here) with the drafted, fully-specified input. Does NOT clear the
   * draft — the screen owns success via a prop reload. */
  #createItem(event: Event): void {
    event.stopPropagation();
    if (this.expandedGroupId === null) return; // the create-item form only renders when one is open
    this.dispatchEvent(
      new CustomEvent("create-option-group-item", {
        detail: {
          groupId: this.expandedGroupId,
          name: buildName(this.newItemName),
          priceDelta: this.newItemPriceDelta,
          vatClass: this.newItemVatClass,
          sort: this.newItemSort,
          active: this.newItemActive,
          maxQuantity: this.newItemMaxQuantity,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Emit an immediate `update-option-group-item { groupId, itemId, patch }` for one field of an
   * existing item row — the same one-PATCH-per-edit pattern as {@link #updateGroup}. */
  #updateItem(groupId: string, itemId: string, patch: Record<string, unknown>): void {
    this.dispatchEvent(
      new CustomEvent("update-option-group-item", {
        detail: { groupId, itemId, patch },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #onItemPriceChange(groupId: string, itemId: string, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.#updateItem(groupId, itemId, { priceDelta: event.detail.value });
  }

  #onItemVatChange(groupId: string, itemId: string, event: Event): void {
    event.stopPropagation();
    const value = (event.target as HTMLSelectElement).value;
    this.#updateItem(groupId, itemId, { vatClass: value === "" ? null : value });
  }

  /** An item's REMOVES multiselect changed: gather the picked codes and emit them, sending `null`
   * (not `[]`) for an empty pick so "removes nothing" is one value the server clears cleanly. Native
   * `change` is `composed: false`, so `stopPropagation` here is defensive consistency, not a boundary
   * guard (the `allergen-picker.ts` `#onPresence` convention). */
  #onItemRemoveChange(groupId: string, itemId: string, event: Event): void {
    event.stopPropagation();
    const selected = Array.from(
      (event.target as HTMLSelectElement).selectedOptions,
      (o) => o.value,
    );
    this.#updateItem(groupId, itemId, { removeAllergens: selected.length ? selected : null });
  }

  /** An item's ADD-ORIGINS or REMOVE-ORIGINS multiselect changed (Task 8b — the diet twin of the
   * allergen overlay), parametrised on which field it targets: gather the picked origin tokens and
   * emit them, sending `null` (not `[]`) for an empty pick so "adds/removes nothing" clears cleanly.
   * Native `change` is `composed: false`, so `stopPropagation` is defensive consistency, mirroring
   * `#onItemRemoveChange` above. */
  #onItemOriginsChange(
    groupId: string,
    itemId: string,
    field: "addOrigins" | "removeOrigins",
    event: Event,
  ): void {
    event.stopPropagation();
    const selected = Array.from(
      (event.target as HTMLSelectElement).selectedOptions,
      (o) => o.value,
    );
    this.#updateItem(groupId, itemId, { [field]: selected.length ? selected : null });
  }

  #renderItemRow(groupId: string, item: OptionGroupItem) {
    return html`
      <wt-card data-test=${`item-row-${item.id}`}>
        <div class="row">
          <span class="name">${primaryName(item.name, this.locales[0]!, item.id)}</span>
          <wt-input
            class="field"
            data-test=${`item-price-${item.id}`}
            label=${t("option_group.price_delta")}
            .value=${item.priceDelta}
            @wt-change=${(e: CustomEvent<{ value: string }>) =>
              this.#onItemPriceChange(groupId, item.id, e)}
          ></wt-input>
          <label class="vat"
            >${t("option_group.vat")}
            <select
              data-test=${`item-vat-${item.id}`}
              @change=${(e: Event) => this.#onItemVatChange(groupId, item.id, e)}
            >
              <option value="" .selected=${item.vatClass === null}>
                ${t("option_group.vat_inherit")}
              </option>
              ${VAT_CLASSES.map(
                (v) =>
                  html`<option value=${v} .selected=${v === item.vatClass}>
                    ${vatClassName(v)}
                  </option>`,
              )}
            </select>
          </label>
          <label class="adds">
            ${t("option_group.adds")}
            <dashboard-allergen-picker
              data-test=${`item-add-${item.id}`}
              .declaration=${item.addAllergens ?? null}
              @allergens-changed=${(e: CustomEvent<{ value: AllergenDeclaration }>) => {
                e.stopPropagation();
                this.#updateItem(groupId, item.id, { addAllergens: e.detail.value });
              }}
            ></dashboard-allergen-picker>
          </label>
          <label class="removes">
            ${t("option_group.removes")}
            <select
              multiple
              data-test=${`item-remove-${item.id}`}
              @change=${(e: Event) => this.#onItemRemoveChange(groupId, item.id, e)}
            >
              ${ALLERGEN_CODES.map(
                (code) =>
                  html`<option
                    value=${code}
                    .selected=${(item.removeAllergens ?? []).includes(code)}
                  >
                    ${allergenName(code)}
                  </option>`,
              )}
            </select>
          </label>
          <label class="adds">
            ${t("option_group.adds_origins")}
            <select
              multiple
              data-test=${`item-add-origins-${item.id}`}
              @change=${(e: Event) => this.#onItemOriginsChange(groupId, item.id, "addOrigins", e)}
            >
              ${DIETARY_ORIGINS.map(
                (origin) =>
                  html`<option
                    value=${origin}
                    .selected=${(item.addOrigins ?? []).includes(origin)}
                  >
                    ${t(`origin.${origin}`)}
                  </option>`,
              )}
            </select>
          </label>
          <label class="removes">
            ${t("option_group.removes_origins")}
            <select
              multiple
              data-test=${`item-remove-origins-${item.id}`}
              @change=${(e: Event) =>
                this.#onItemOriginsChange(groupId, item.id, "removeOrigins", e)}
            >
              ${DIETARY_ORIGINS.map(
                (origin) =>
                  html`<option
                    value=${origin}
                    .selected=${(item.removeOrigins ?? []).includes(origin)}
                  >
                    ${t(`origin.${origin}`)}
                  </option>`,
              )}
            </select>
          </label>
          <wt-input
            class="field"
            type="number"
            data-test=${`item-maxqty-${item.id}`}
            label=${t("option_group.max_quantity")}
            .value=${String(item.maxQuantity)}
            @wt-change=${(e: CustomEvent<{ value: string }>) =>
              this.#applyInteger(e, (n) => this.#updateItem(groupId, item.id, { maxQuantity: n }))}
          ></wt-input>
          <wt-input
            class="field"
            type="number"
            data-test=${`item-sort-${item.id}`}
            label=${t("option_group.sort")}
            .value=${String(item.sort)}
            @wt-change=${(e: CustomEvent<{ value: string }>) =>
              this.#applyInteger(e, (n) => this.#updateItem(groupId, item.id, { sort: n }))}
          ></wt-input>
          <wt-switch
            data-test=${`item-active-${item.id}`}
            label=${t("option_group.active")}
            .checked=${item.active}
            @wt-change=${(e: CustomEvent<{ checked: boolean }>) =>
              this.#applyBoolean(e, (checked) =>
                this.#updateItem(groupId, item.id, { active: checked }),
              )}
          ></wt-switch>
        </div>
      </wt-card>
    `;
  }

  #renderItemsPanel(groupId: string) {
    return html`
      <div class="items" data-test=${`items-${groupId}`}>
        ${this.items.map((item) => this.#renderItemRow(groupId, item))}
        <div class="create">
          ${this.locales.map(
            (locale) => html`
              <wt-input
                data-test=${`item-name-${locale}`}
                label=${`${t("option_group.name")} (${locale})`}
                .value=${this.newItemName[locale] ?? ""}
                @wt-change=${(e: CustomEvent<{ value: string }>) =>
                  this.#onNewItemNameChange(e, locale)}
              ></wt-input>
            `,
          )}
          <wt-input
            class="field"
            data-test="item-new-price"
            label=${t("option_group.price_delta")}
            .value=${this.newItemPriceDelta}
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNewItemPriceChange(e)}
          ></wt-input>
          <label class="vat"
            >${t("option_group.vat")}
            <select data-test="item-new-vat" @change=${(e: Event) => this.#onNewItemVatChange(e)}>
              <option value="" .selected=${this.newItemVatClass === null}>
                ${t("option_group.vat_inherit")}
              </option>
              ${VAT_CLASSES.map(
                (v) =>
                  html`<option value=${v} .selected=${v === this.newItemVatClass}>
                    ${vatClassName(v)}
                  </option>`,
              )}
            </select>
          </label>
          <wt-input
            class="field"
            type="number"
            data-test="item-new-maxqty"
            label=${t("option_group.max_quantity")}
            .value=${String(this.newItemMaxQuantity)}
            @wt-change=${(e: CustomEvent<{ value: string }>) =>
              this.#applyInteger(e, (n) => (this.newItemMaxQuantity = n))}
          ></wt-input>
          <wt-input
            class="field"
            type="number"
            data-test="item-new-sort"
            label=${t("option_group.sort")}
            .value=${String(this.newItemSort)}
            @wt-change=${(e: CustomEvent<{ value: string }>) =>
              this.#applyInteger(e, (n) => (this.newItemSort = n))}
          ></wt-input>
          <wt-switch
            data-test="item-new-active"
            label=${t("option_group.active")}
            .checked=${this.newItemActive}
            @wt-change=${(e: CustomEvent<{ checked: boolean }>) =>
              this.#applyBoolean(e, (checked) => (this.newItemActive = checked))}
          ></wt-switch>
          <wt-button
            variant="secondary"
            data-test="create-item"
            @click=${(e: Event) => this.#createItem(e)}
          >
            ${t("action.create")}
          </wt-button>
        </div>
        ${
          this.itemError
            ? html`<p class="error" role="alert" data-test="item-error">
                ${codeMessage(this.itemError)}
              </p>`
            : nothing
        }
      </div>
    `;
  }

  #renderGroupRow(group: OptionGroup) {
    return html`
      <wt-card data-test=${`group-row-${group.id}`}>
        <div class="row">
          <span class="name">${primaryName(group.name, this.locales[0]!, group.id)}</span>
          <wt-input
            class="field"
            type="number"
            data-test=${`group-min-${group.id}`}
            label=${t("option_group.min")}
            .value=${String(group.minSelect)}
            @wt-change=${(e: CustomEvent<{ value: string }>) =>
              this.#applyInteger(e, (n) => this.#updateGroup(group.id, { minSelect: n }))}
          ></wt-input>
          <wt-input
            class="field"
            type="number"
            data-test=${`group-max-${group.id}`}
            label=${t("option_group.max")}
            .value=${String(group.maxSelect)}
            @wt-change=${(e: CustomEvent<{ value: string }>) =>
              this.#applyInteger(e, (n) => this.#updateGroup(group.id, { maxSelect: n }))}
          ></wt-input>
          <wt-switch
            data-test=${`group-required-${group.id}`}
            label=${t("option_group.required")}
            .checked=${group.required}
            @wt-change=${(e: CustomEvent<{ checked: boolean }>) =>
              this.#applyBoolean(e, (checked) =>
                this.#updateGroup(group.id, { required: checked }),
              )}
          ></wt-switch>
          <wt-switch
            data-test=${`group-active-${group.id}`}
            label=${t("option_group.active")}
            .checked=${group.active}
            @wt-change=${(e: CustomEvent<{ checked: boolean }>) =>
              this.#applyBoolean(e, (checked) => this.#updateGroup(group.id, { active: checked }))}
          ></wt-switch>
          <wt-input
            class="field"
            type="number"
            data-test=${`group-sort-${group.id}`}
            label=${t("option_group.sort")}
            .value=${String(group.sort)}
            @wt-change=${(e: CustomEvent<{ value: string }>) =>
              this.#applyInteger(e, (n) => this.#updateGroup(group.id, { sort: n }))}
          ></wt-input>
          <wt-button
            variant="secondary"
            data-test=${`toggle-items-${group.id}`}
            @click=${(e: Event) => this.#toggleItems(group.id, e)}
          >
            ${t("option_group.items_button")}
          </wt-button>
        </div>
        ${this.expandedGroupId === group.id ? this.#renderItemsPanel(group.id) : nothing}
      </wt-card>
    `;
  }

  override render() {
    return html`
      <div class="list">${this.groups.map((group) => this.#renderGroupRow(group))}</div>
      <div class="create">
        ${this.locales.map(
          (locale) => html`
            <wt-input
              data-test=${`group-name-${locale}`}
              label=${`${t("option_group.name")} (${locale})`}
              .value=${this.newGroupName[locale] ?? ""}
              @wt-change=${(e: CustomEvent<{ value: string }>) =>
                this.#onNewGroupNameChange(e, locale)}
            ></wt-input>
          `,
        )}
        <wt-input
          class="field"
          type="number"
          data-test="group-new-min"
          label=${t("option_group.min")}
          .value=${String(this.newGroupMinSelect)}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            this.#applyInteger(e, (n) => (this.newGroupMinSelect = n))}
        ></wt-input>
        <wt-input
          class="field"
          type="number"
          data-test="group-new-max"
          label=${t("option_group.max")}
          .value=${String(this.newGroupMaxSelect)}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            this.#applyInteger(e, (n) => (this.newGroupMaxSelect = n))}
        ></wt-input>
        <wt-switch
          data-test="group-new-required"
          label=${t("option_group.required")}
          .checked=${this.newGroupRequired}
          @wt-change=${(e: CustomEvent<{ checked: boolean }>) =>
            this.#applyBoolean(e, (checked) => (this.newGroupRequired = checked))}
        ></wt-switch>
        <wt-switch
          data-test="group-new-active"
          label=${t("option_group.active")}
          .checked=${this.newGroupActive}
          @wt-change=${(e: CustomEvent<{ checked: boolean }>) =>
            this.#applyBoolean(e, (checked) => (this.newGroupActive = checked))}
        ></wt-switch>
        <wt-input
          class="field"
          type="number"
          data-test="group-new-sort"
          label=${t("option_group.sort")}
          .value=${String(this.newGroupSort)}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            this.#applyInteger(e, (n) => (this.newGroupSort = n))}
        ></wt-input>
        <wt-button
          variant="primary"
          data-test="create-group"
          @click=${(e: Event) => this.#createGroup(e)}
        >
          ${t("action.create")}
        </wt-button>
      </div>
      ${
        this.groupError
          ? html`<p class="error" role="alert" data-test="group-error">
              ${codeMessage(this.groupError)}
            </p>`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-option-group-manager": OptionGroupManager;
  }
}
