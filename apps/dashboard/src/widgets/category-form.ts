import { LocaleChangeController } from "../state/locale-controller.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "./image-upload.js";
import { colorField, colorFieldStyles } from "./color-field.js";
import type { ImageUploader } from "./image-upload.js";
import type { CategoryInput, CategorySummary } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

/** The category, then each category above it, stopping at a parent the list lacks or a loop. */
export function categoryAncestors(
  category: CategorySummary,
  categories: readonly CategorySummary[],
): CategorySummary[] {
  const chain: CategorySummary[] = [];
  const seen = new Set<string>();
  let current: CategorySummary | undefined = category;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = categories.find((item) => item.id === current!.parentId);
  }
  return chain;
}

export function categoryPath(
  category: CategorySummary,
  categories: readonly CategorySummary[],
): string {
  return categoryAncestors(category, categories)
    .map(({ name }) => name)
    .reverse()
    .join(" / ");
}

/** The collation `wt-data-table` sorts text with, so a picker or list and the tables agree. */
export function byLabel(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function categoryWithDescendants(
  id: string,
  categories: readonly CategorySummary[],
): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const category of categories)
      if (category.parentId !== null && ids.has(category.parentId) && !ids.has(category.id)) {
        ids.add(category.id);
        grew = true;
      }
  }
  return ids;
}

const FIELD_BY_CODE = new Map([
  ["category.invalid", "name"],
  ["category.parent_cycle", "parent"],
  ["category.image_not_found", "image"],
  ["category.color_invalid", "color"],
]);
const FIELD_BY_REQUEST_FIELD = new Map([
  ["name", "name"],
  ["parentId", "parent"],
  ["image", "image"],
  ["color", "color"],
]);

/** A refused category write, keyed by the form's fields; `_form` is shown in the bottom message alone.
 * `parentId` is the parent the refused write named. */
export function categoryRefusalErrors(
  error: unknown,
  parentId: string | null = null,
): Record<string, string> {
  const code = codeOf(error);
  const message = codeMessage(code);
  const params = (error as { params?: { field?: unknown; categoryId?: unknown } }).params ?? {};
  let field = FIELD_BY_CODE.get(code);
  if (code === "category.not_found" && parentId !== null && params.categoryId === parentId)
    field = "parent";
  if (code === "management.request_invalid" && typeof params.field === "string")
    field = FIELD_BY_REQUEST_FIELD.get(params.field);
  return { [field ?? "_form"]: message };
}

/** API writes belong to the host, so the same editor can create a category inside a product draft. */
@customElement("dashboard-category-form")
export class CategoryForm extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    colorFieldStyles,
    css`
      .fields {
        display: grid;
        gap: var(--wt-space-4);
      }
      .field-error {
        color: var(--wt-color-danger);
      }
      label {
        display: grid;
        gap: var(--wt-space-2);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) value: CategorySummary | null = null;
  @property({ attribute: false }) categories: readonly CategorySummary[] = [];
  @property({ attribute: false }) api?: ImageUploader;
  @property({ attribute: false }) fieldErrors: Record<string, string> = {};
  @state() private name = "";
  @state() private parentId: string | null = null;
  @state() private image: string | null = null;
  @state() private color: string | null = null;
  @state() private attempted = false;
  /** Refusal keys the operator has since changed the field of, or submitted past. */
  @state() private dismissed = new Set<string>();
  @state() private pickerOpen = false;
  protected override willUpdate(changes: PropertyValues<this>): void {
    if (
      (changes.has("open") && this.open) ||
      (changes.has("value") &&
        this.value?.id !== (changes.get("value") as CategorySummary | null | undefined)?.id)
    ) {
      this.name = this.value?.name ?? "";
      this.parentId = this.value?.parentId ?? null;
      this.image = this.value?.image ?? null;
      this.color = this.value?.color ?? null;
      this.attempted = false;
      this.dismissed = new Set();
    }
    if (changes.has("fieldErrors")) this.dismissed = new Set();
  }
  protected override updated(changes: PropertyValues<this>): void {
    if (changes.has("fieldErrors") && this.#fieldKeys(this.fieldErrors).length > 0)
      void focusFirstInvalid(this.shadowRoot!);
  }
  #dismiss(...keys: string[]): void {
    this.dismissed = new Set([...this.dismissed, ...keys]);
  }
  #validate(): Record<string, string> {
    return this.name.trim() ? {} : { name: t("categories.name_required") };
  }
  /** The keys of `errors` that a field this form shows displays. */
  #fieldKeys(errors: Record<string, string>): string[] {
    const shown = new Set(["name", "parent", "color", "image"]);
    return Object.entries(errors)
      .filter(([key, message]) => Boolean(message) && shown.has(key))
      .map(([key]) => key);
  }
  #errors(): Record<string, string> {
    const refused = Object.fromEntries(
      Object.entries(this.fieldErrors).filter(([key]) => !this.dismissed.has(key)),
    );
    return { ...refused, ...(this.attempted ? this.#validate() : {}) };
  }
  #emit(
    event: Event,
    type: "wt-submit" | "wt-cancel",
    detail: { value: CategoryInput } | Record<string, never>,
  ): void {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
  #submit(event: Event): void {
    event.stopPropagation();
    if (this.busy || this.pickerOpen) return;
    this.attempted = true;
    this.#dismiss(...Object.keys(this.fieldErrors));
    if (Object.keys(this.#validate()).length > 0) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    this.#emit(event, "wt-submit", {
      value: {
        name: this.name,
        parentId: this.parentId,
        image: this.image,
        color: this.color,
      },
    });
  }
  #parents(): readonly CategorySummary[] {
    if (!this.value) return this.categories;
    const excluded = categoryWithDescendants(this.value.id, this.categories);
    return this.categories.filter((category) => !excluded.has(category.id));
  }
  override render() {
    const errors = this.#errors();
    const fieldKeys = new Set(this.#fieldKeys(errors));
    const formMessages = Object.entries(errors)
      .filter(([key, message]) => Boolean(message) && !fieldKeys.has(key))
      .map(([, message]) => message);
    const bottom = [...formMessages, ...(fieldKeys.size > 0 ? [t("form.fix_fields")] : [])].join(
      " ",
    );
    const invalid = this.attempted && Object.keys(this.#validate()).length > 0;
    return html`<wt-modal
      .open=${this.open}
      heading=${t(this.value ? "categories.edit" : "categories.create")}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
      }}
      @wt-close=${(event: Event) => {
        // The dialog also reports a close it was told to make, a task later; by then the screen has
        // closed this form and a second cancel would be about nothing.
        if (!this.busy && !this.pickerOpen && this.open) this.#emit(event, "wt-cancel", {});
        else event.stopPropagation();
      }}
    >
      <div
        ?inert=${this.busy}
        class="fields"
        @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]'))}
      >
        <wt-input
          name="name"
          label=${t("categories.name")}
          required
          .disabled=${this.busy}
          .value=${this.name}
          .error=${errors.name ?? ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.name = event.detail.value;
            this.#dismiss("name");
          }}
        ></wt-input>
        <wt-combobox
          name="category-parent"
          label=${t("categories.parent")}
          .disabled=${this.busy}
          .options=${[
            { value: "", label: t("categories.no_parent") },
            ...this.#parents()
              .map((category) => ({
                value: category.id,
                label: categoryPath(category, this.categories),
              }))
              .sort((a, b) => byLabel(a.label, b.label)),
          ]}
          .value=${this.parentId ?? ""}
          .error=${errors.parent ?? ""}
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.parentId = event.detail.value || null;
            this.#dismiss("parent");
          }}
        ></wt-combobox>
        ${colorField({
          color: this.color,
          busy: this.busy,
          error: errors.color ?? "",
          name: "category-color",
          errorId: "category-color-error",
          change: (color) => {
            this.color = color;
            this.#dismiss("color");
          },
        })}
        <dashboard-image-upload
          aria-describedby="category-image-error"
          .api=${this.api}
          .invalid=${Boolean(errors.image)}
          .image=${this.image}
          @image-picker-state=${(event: CustomEvent<{ open: boolean }>) => {
            event.stopPropagation();
            this.pickerOpen = event.detail.open;
          }}
          @image-changed=${(event: CustomEvent<{ image: string | null }>) => {
            event.stopPropagation();
            this.image = event.detail.image;
            this.#dismiss("image");
          }}
        ></dashboard-image-upload>
        <span class="field-error" id="category-image-error">${errors.image ?? nothing}</span>
      </div>
      <wt-form-actions slot="footer" .error=${bottom}
        ><wt-button
          slot="cancel"
          variant="secondary"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#emit(event, "wt-cancel", {})}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="save"
          variant="primary"
          .disabled=${this.busy || this.pickerOpen || invalid}
          @click=${(event: Event) => this.#submit(event)}
          >${t("action.save")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-category-form": CategoryForm;
  }
}
