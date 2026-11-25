import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  FormFeedback,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import type { CategoryInput, CategorySummary } from "../api/catalog-api.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { categoryTree } from "./classification-fields.js";
import { colorField, colorFieldStyles } from "./color-field.js";
import { sameValue } from "./product-editor-model.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";

type CategoryDraft = Required<CategoryInput>;
const fieldKeys = ["name", "parent", "color"] as const;

@customElement("dashboard-category-create-form")
export class CategoryCreateForm extends LitElement {
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
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property() seed = "";
  @property({ attribute: false }) parentId: string | null = null;
  @property({ attribute: false }) categories: readonly CategorySummary[] = [];
  @property({ attribute: false }) draftParent?: object;
  @property({ attribute: false }) fieldErrors: Record<string, string> = {};
  @state() private draft: CategoryDraft = { name: "", parentId: null, color: null };
  #scope?: DraftScope<CategoryDraft>;
  #leave?: LeaveCoordinator;
  readonly #feedback = new FormFeedback(this);

  override disconnectedCallback(): void {
    this.#dispose();
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    const initial = { name: this.seed.trim(), parentId: this.parentId, color: null };
    if (changed.has("open") && this.open) {
      this.draft = initial;
      this.#feedback.reset();
    }
    if (changed.has("fieldErrors")) this.#feedback.newRefusal();
    if (!this.open) this.#dispose();
    else if (this.isConnected && !this.#scope) {
      const { coordinator, scope } = draftScopeFor<CategoryDraft>(this, {
        id: this,
        parent: this.draftParent,
        current: () => ({ ...this.draft, name: this.draft.name.trim() }),
        snapshot: (draft) => ({ ...draft }),
        equal: sameValue,
        restore: (draft) => {
          this.draft = draft;
        },
      });
      this.#leave = coordinator;
      this.#scope = scope;
      scope.commit(initial);
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("fieldErrors") && fieldKeys.some((key) => this.fieldErrors[key]))
      void this.#feedback.focus(this.shadowRoot!);
    else if (changed.has("open") && this.open)
      void this.#modal.updateComplete.then(() => {
        if (this.open) this.shadowRoot!.querySelector("wt-input")!.focus();
      });
  }

  #dispose(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
  }

  get #modal() {
    return this.shadowRoot!.querySelector("wt-modal")!;
  }

  #change(change: Partial<CategoryDraft>, field: string): void {
    this.draft = { ...this.draft, ...change };
    this.#scope?.changed();
    this.#feedback.dismiss(field);
  }

  #action() {
    return saveActionState(this.#scope, { savableAtOpen: this.seed.trim() !== "" });
  }

  #submit = (event: Event): void => {
    event.stopPropagation();
    const name = this.draft.name.trim();
    if (!this.open || this.busy || !name || this.#action().unchanged) return;
    this.#feedback.press(...Object.keys(this.fieldErrors));
    this.dispatchEvent(
      new CustomEvent("wt-submit", {
        detail: { value: { ...this.draft, name } },
        bubbles: true,
        composed: true,
      }),
    );
  };

  closeSaved(submitted: CategoryDraft): void {
    this.#scope?.commit(submitted);
    this.open = false;
    this.#modal.closeAfter("saved");
  }

  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override render() {
    const errors = this.#feedback.remaining(this.fieldErrors);
    const marked = new Set(fieldKeys.filter((key) => errors[key]));
    const action = this.#action();
    return html`<wt-modal
      size="compact"
      heading=${t("folders.add_category")}
      .open=${this.open}
      .dismissible=${!this.busy}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      @keydown=${(event: KeyboardEvent) =>
        submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=add]"))}
      @wt-close=${(event: Event) => {
        if (event.target !== event.currentTarget || !this.open) return;
        event.stopPropagation();
        this.dispatchEvent(new CustomEvent("wt-cancel", { bubbles: true, composed: true }));
      }}
    >
      <div class="fields">
        <wt-input
          name="name"
          required
          autocomplete="off"
          label=${t("editor.name")}
          .value=${this.draft.name}
          .error=${errors.name ?? ""}
          .disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#change({ name: event.detail.value }, "name");
          }}
        ></wt-input>
        <wt-combobox
          name="parentId"
          label=${t("categories.inside")}
          preserve-order
          show-empty-option
          placeholder=${t("editor.missing_choice")}
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          .options=${[{ value: "", label: t("categories.none") }, ...categoryTree(this.categories)]}
          .value=${this.draft.parentId ?? ""}
          .error=${errors.parent ?? ""}
          .disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#change({ parentId: event.detail.value || null }, "parent");
          }}
        ></wt-combobox>
        ${colorField({
          color: this.draft.color,
          busy: this.busy,
          error: errors.color ?? "",
          name: "color",
          errorId: "category-color-error",
          change: (color) => this.#change({ color }, "color"),
        })}
      </div>
      <wt-form-actions
        slot="footer"
        .error=${this.#feedback.message(errors, marked, t("form.fix_fields"))}
      >
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => void this.#modal.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="add"
          variant=${action.variant}
          ?loading=${this.busy}
          ?disabled=${action.unchanged || !this.draft.name.trim() || this.busy}
          @click=${this.#submit}
          >${t("folders.add_category")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-category-create-form": CategoryCreateForm;
  }
}
