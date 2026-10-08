import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, saveActionState, type DraftScope } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { t } from "../i18n/t.js";

export type ShortcutKind = "product" | "section";

export interface ShortcutOption {
  value: string;
  label: string;
}

const sorted = (ids: readonly string[]) => [...ids].sort();

/**
 * Picks several products, or several sections, to add as Device Home Page shortcuts. A host may put
 * its own Cancel in the `cancel` slot, which lands beside Add.
 */
@customElement("dashboard-home-shortcut-picker")
export class HomeShortcutPicker extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      wt-combobox {
        display: block;
        margin-bottom: var(--wt-space-3);
      }
    `,
  ];

  @property() kind: ShortcutKind = "product";
  /** What can still be added: reached by the menu and not already a shortcut. */
  @property({ attribute: false }) options: ShortcutOption[] = [];
  @property({ type: Boolean }) busy = false;
  /** A refusal that names the field, shown under it. */
  @property() error = "";
  /** A refusal that names no field, shown at the bottom. */
  @property() formError = "";
  /** In the order chosen. */
  @state() private chosen: readonly string[] = [];
  @state() private noneLeft = false;
  /** What the scope last committed; kept through a disconnect so a choice made before it counts. */
  #saved: string[] = [];
  #scope?: DraftScope<string[]>;
  readonly #countLabel = (count: number) =>
    t("home.chosen_count").replace("{count}", String(count));

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }

  /** The chosen shortcuts were all added: the form is unchanged again. */
  commitSaved(): void {
    this.#saved = sorted(this.chosen);
    this.#scope?.commit(this.#saved);
  }

  /** After a partial failure: only `ids`, the ones not yet added, stay chosen, and still count.
   * The added ones are no longer offered, so the form is unchanged once nothing is chosen. */
  keepChosen(ids: readonly string[]): void {
    this.#saved = [];
    this.chosen = [...ids];
    this.noneLeft = false;
    this.#scope?.commit(this.#saved);
  }

  override willUpdate(): void {
    if (this.isConnected && !this.#scope) {
      this.#scope = draftScopeFor<string[]>(this, {
        id: this,
        current: () => sorted(this.chosen),
        snapshot: (value) => [...value],
        equal: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]),
        restore: (value) => {
          this.chosen = [...value];
        },
      }).scope;
      this.#scope.commit(this.#saved);
    }
  }

  #offered(): string[] {
    const offered = new Set(this.options.map(({ value }) => value));
    return this.chosen.filter((id) => offered.has(id));
  }

  #confirm(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    if (saveActionState(this.#scope).unchanged) return;
    const ids = this.#offered();
    if (ids.length === 0) {
      this.noneLeft = true;
      return;
    }
    this.dispatchEvent(
      new CustomEvent("wt-shortcuts-add", {
        detail: { kind: this.kind, ids },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const sections = this.kind === "section";
    const addAction = saveActionState(this.#scope);
    const fieldError =
      this.error ||
      (this.noneLeft
        ? t(sections ? "home.none_chosen_sections" : "home.none_chosen_products")
        : "");
    return html`<wt-combobox
        multiple
        required
        name=${sections ? "shortcut-sections" : "shortcut-products"}
        label=${t(sections ? "home.picker_sections" : "home.picker_products")}
        search="auto"
        searchPlaceholder=${t("categories.combobox_search")}
        noResultsLabel=${t("categories.combobox_no_results")}
        placeholder=${t(sections ? "home.choose_sections" : "home.choose_products")}
        .countLabel=${this.#countLabel}
        .options=${this.options}
        .values=${this.#offered()}
        .disabled=${this.busy}
        error=${fieldError}
        @wt-change=${(event: CustomEvent<{ values: string[] }>) => {
          event.stopPropagation();
          this.chosen = [...event.detail.values];
          this.noneLeft = false;
          this.#scope?.changed();
        }}
      ></wt-combobox>
      <wt-form-actions
        error=${[this.formError, fieldError ? t("form.fix_fields") : ""].filter(Boolean).join(" ")}
      >
        <slot name="cancel" slot="cancel"></slot>
        <wt-button
          variant=${addAction.variant}
          data-test="add"
          .disabled=${addAction.unchanged || this.busy}
          @click=${(event: Event) => this.#confirm(event)}
          >${t("action.add")}</wt-button
        >
      </wt-form-actions>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-home-shortcut-picker": HomeShortcutPicker;
  }
}
