import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, submitOnEnter } from "@waitron/ui";
import type { ContentLanguages } from "@waitron/shared";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-disclosure.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-lozenge.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import { optionalTextFields, translations, type FieldContext } from "./form-fields.js";
import { reorder } from "./reorder.js";
import { ReorderController, type ReorderModel } from "./reorder-table.js";
import "./option-label-form.js";
import type { DraftLabel } from "./option-label-form.js";
import type { OptionList, OptionListInput } from "../api/client.js";
import { t } from "../i18n/t.js";

/**
 * Two rules of `parseOptionListInput` (packages/catalogue/src/option-contract.ts), mirrored so the
 * operator sees them before saving: an ACTIVE list with no available option is refused, and a list
 * with an available option always has one as its default — the first available one when none is
 * chosen, so the form shows the default the server will store.
 */
@customElement("dashboard-option-list-form")
export class OptionListForm extends LitElement {
  static override styles = [
    baseStyles,
    ReorderController.styles,
    ReorderController.tableStyles,
    css`
      :host {
        display: block;
      }
      .fields {
        display: grid;
        gap: var(--wt-space-4);
      }
      .names {
        display: grid;
        gap: var(--wt-space-3);
      }
      .error {
        color: var(--wt-color-danger);
      }
      td p.error {
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
      }
      .option-name {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--wt-space-2);
      }
      /* The grip and the kebab are each a tap-target-wide button that already centres its icon. */
      th:first-child,
      td:first-child,
      td:last-child {
        padding-inline: 0;
      }
      td:last-child {
        text-align: end;
      }
      /* A row holds one line of text beside two tap-target-high controls, so all three are centred
         on it; the shared table styles put a cell's content at its top. */
      tbody td {
        vertical-align: middle;
      }
      /* The preselect control is a native radio, which is far smaller than a finger. The tap target
         is the LABEL that contains it, never the radio stretched past its own box
         (design-system.md → "Hit targets must not overflow their container"). */
      .pick {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
      }
      /* The preselect dot is drawn by the user agent, not by this form, so the brand colour reaches
         it through accent-color — the declaration wt-data-table and the printers screen give their
         own native controls. What the UNCHECKED fill looks like is a separate matter, settled by
         color-scheme (packages/ui-core/src/tokens/colors.test.ts). */
      input[type="radio"] {
        accent-color: var(--wt-color-primary);
        /* The user agent's own margin is lopsided (none below), which sets the dot off-centre. */
        margin: 0;
      }
      .label-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) languages: ContentLanguages = {
    defaultLanguage: "en",
    languages: ["en"],
  };
  @property({ attribute: false }) value: OptionList | null = null;
  /** The server's refusal, keyed by the field path `parseOptionListInput` reports. */
  @property({ attribute: false }) fieldErrors: Record<string, string> = {};
  @state() private name = "";
  @state() private customerName: Record<string, string> = {};
  @state() private kitchenName = "";
  @state() private active = true;
  @state() private labels: DraftLabel[] = [];
  @state() private defaultLabelId: string | null = null;
  /** The option open in the option editor: "new" while adding one, null while it is closed. */
  @state() private editingLabel: DraftLabel | "new" | null = null;
  @state() private validation: Record<string, string> = {};
  /** `fieldErrors` with each path turned into one of this form's own keys. A label's message is
   * held against the label's ID rather than the position the server named, so moving a label
   * carries its message with it. */
  @state() private serverErrors: Record<string, string> = {};

  readonly #reorder = new ReorderController(this, {
    order: () => this.labels.map((label) => label.id),
    move: (id, to) => this.#move(id, to),
    label: (id) => this.labels.find((label) => label.id === id)!.name,
    busy: () => this.busy,
    get reorderLabel(): string {
      return t("options.reorder");
    },
  } satisfies ReorderModel);

  protected override willUpdate(changes: PropertyValues<this>): void {
    if (
      (changes.has("open") && this.open) ||
      (changes.has("value") &&
        this.value?.id !== (changes.get("value") as OptionList | null | undefined)?.id)
    ) {
      this.#reseed();
    }
    if (changes.has("open") && !this.open) this.editingLabel = null;
    // After the reseed, so a label path resolves against the labels now on screen.
    if (changes.has("fieldErrors")) this.serverErrors = this.#mapFieldErrors();
  }

  #reseed(): void {
    const value = this.value;
    this.name = value?.name ?? "";
    this.customerName = { ...value?.customerName };
    this.kitchenName = value?.kitchenName ?? "";
    this.active = value?.active ?? true;
    this.labels = (value?.labels ?? []).map((label) => ({
      id: label.id,
      name: label.name,
      customerName: { ...label.customerName },
      kitchenName: label.kitchenName ?? "",
      available: label.available,
    }));
    this.defaultLabelId = value?.defaultLabelId ?? null;
    this.#keepDefault();
    this.editingLabel = null;
    this.validation = {};
  }

  #keepDefault(): void {
    const chosen = this.labels.some((label) => label.id === this.defaultLabelId && label.available);
    if (!chosen) this.defaultLabelId = this.labels.find((label) => label.available)?.id ?? null;
  }

  /** The language a refusal naming a whole translated map is shown against: the first input on
   * screen. `parseOptionListInput` names the map, never the language inside it. */
  #primaryLanguage(): string {
    return this.languages.languages[0] ?? this.languages.defaultLanguage;
  }

  #mapFieldErrors(): Record<string, string> {
    const mapped: Record<string, string> = {};
    for (const [field, message] of Object.entries(this.fieldErrors))
      mapped[this.#formKey(field)] = message;
    return mapped;
  }

  /** A path naming the list as a whole, an option's id or an option's availability (`wt-switch`
   * draws no error text) is shown under the options table with the rest of the list-level
   * refusals. */
  #formKey(field: string): string {
    const label = /^labels\.(\d+)(?:\.(.+))?$/.exec(field);
    if (label) {
      const id = this.labels[Number(label[1])]?.id;
      const key = this.#nameKey(label[2] ?? "");
      return id === undefined || key === null ? "labels" : `label:${id}:${key}`;
    }
    return this.#nameKey(field) ?? "labels";
  }

  #nameKey(field: string): string | null {
    if (field === "name") return "name";
    if (field === "customerName") return `customer-name-${this.#primaryLanguage()}`;
    if (field === "kitchenName") return "kitchen-name";
    if (field === "active") return "active";
    return null;
  }

  #errors(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const [key, message] of Object.entries(this.serverErrors)) {
      const held = /^label:([^:]+):(.+)$/.exec(key);
      if (held === null) {
        errors[key] = message;
        continue;
      }
      const index = this.labels.findIndex((label) => label.id === held[1]);
      errors[index < 0 ? "labels" : `label-${index}-${held[2]}`] = message;
    }
    return { ...errors, ...this.validation };
  }

  #edit(change: () => void): void {
    change();
    this.validation = {};
  }

  /** Puts the option editor's draft in place of the option it was opened on, or after the others
   * when it was opened to add one. */
  #saveLabel(event: CustomEvent<{ value: DraftLabel }>): void {
    event.stopPropagation();
    const saved = event.detail.value;
    const known = this.labels.some((label) => label.id === saved.id);
    this.#edit(() => {
      this.labels = known
        ? this.labels.map((label) => (label.id === saved.id ? saved : label))
        : [...this.labels, saved];
      this.#keepDefault();
    });
    this.#closeEditor();
  }

  /** The row whose menu opened the option editor, or null for Add option. */
  #openedFrom: string | null = null;

  #openEditor(label: DraftLabel | "new"): void {
    this.editingLabel = label;
    this.#openedFrom = label === "new" ? null : label.id;
  }

  /** Closes the option editor and puts focus back on the control that opened it. The focus waits
   * for the editor's dialog to close, because closing it moves focus too and would undo it. */
  #closeEditor(): void {
    this.editingLabel = null;
    void this.#returnFocus(this.#openedFrom);
  }

  async #returnFocus(id: string | null): Promise<void> {
    await this.updateComplete;
    const form = this.shadowRoot!.querySelector("dashboard-option-label-form")!;
    await form.updateComplete;
    await form.shadowRoot!.querySelector("wt-modal")!.updateComplete;
    const target =
      id === null
        ? this.shadowRoot!.querySelector<HTMLElement>('[data-test="add-option"]')
        : this.shadowRoot!.querySelector<HTMLElement>(`tr[data-label="${id}"] wt-row-actions`);
    target?.focus();
  }

  #removeLabel(id: string): void {
    this.#edit(() => {
      this.labels = this.labels.filter((label) => label.id !== id);
      this.#keepDefault();
    });
  }

  /** The labels array order IS the saved order, so a move rewrites the array rather than a rank. */
  #move(id: string, to: number): void {
    const from = this.labels.findIndex((label) => label.id === id);
    if (from < 0) return;
    this.#edit(() => {
      this.labels = reorder(this.labels, from, to);
    });
  }

  #emit(
    event: Event,
    type: "wt-submit" | "wt-cancel",
    detail: { value: OptionListInput } | Record<string, never>,
  ): void {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #submit(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    const validation: Record<string, string> = {};
    if (!this.name.trim()) validation.name = t("options.name_required");
    if (this.active && !this.labels.some((label) => label.available))
      validation.labels = t("options.labels_required");
    this.validation = validation;
    if (Object.keys(validation).length) return;
    this.#emit(event, "wt-submit", {
      value: {
        name: this.name.trim(),
        customerName: translations(this.customerName),
        kitchenName: this.kitchenName.trim() || null,
        active: this.active,
        defaultLabelId: this.defaultLabelId,
        labels: this.labels.map((label) => ({
          id: label.id,
          name: label.name.trim(),
          customerName: translations(label.customerName),
          kitchenName: label.kitchenName.trim() || null,
          available: label.available,
        })),
      },
    });
  }

  #cancel(event: Event): void {
    if (this.busy) {
      event.stopPropagation();
      return;
    }
    this.#emit(event, "wt-cancel", {});
  }

  #fields(errors: Record<string, string>): FieldContext {
    return {
      busy: this.busy,
      locales: this.languages.languages,
      error: (key) => errors[key] ?? "",
    };
  }

  /** A row's messages, keyed as the option editor names its inputs (`label-3-name` → `label-name`). */
  #rowErrors(index: number, errors: Record<string, string>): Record<string, string> {
    const prefix = `label-${index}-`;
    return Object.fromEntries(
      Object.entries(errors)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, message]) => [`label-${key.slice(prefix.length)}`, message]),
    );
  }

  #namesSection(errors: Record<string, string>) {
    const locales = this.languages.languages;
    const filled =
      locales.filter((locale) => (this.customerName[locale] ?? "").trim()).length +
      (this.kitchenName.trim() ? 1 : 0);
    const hasError =
      !!errors["kitchen-name"] || locales.some((locale) => !!errors[`customer-name-${locale}`]);
    return html`<wt-disclosure
      data-test="names-section"
      heading=${t("options.names_section")}
      summary=${t("options.names_summary")
        .replace("{filled}", String(filled))
        .replace("{total}", String(locales.length + 1))}
      .hasError=${hasError}
    >
      <div class="names">
        ${optionalTextFields(
          this.#fields(errors),
          "customer-name",
          t("options.customer_name"),
          this.customerName,
          (customerName) => this.#edit(() => (this.customerName = customerName)),
          this.name,
        )}
        <wt-input
          name="kitchen-name"
          label=${t("options.kitchen_name")}
          placeholder=${this.name}
          .disabled=${this.busy}
          .value=${this.kitchenName}
          .error=${errors["kitchen-name"] ?? ""}
          .invalid=${!!errors["kitchen-name"]}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#edit(() => (this.kitchenName = event.detail.value));
          }}
        ></wt-input>
      </div>
    </wt-disclosure>`;
  }

  #labelRow(label: DraftLabel, index: number, errors: Record<string, string>) {
    return html`<tr data-label=${label.id}>
      <td class="handle-cell">${this.#reorder.handle(label.id)}</td>
      <td>
        <div class="option-name">
          <span data-test=${`label-${index}-name`}>${label.name}</span>${
            label.available
              ? nothing
              : html`<wt-lozenge data-test=${`label-${index}-unavailable`}
                  >${t("options.unavailable")}</wt-lozenge
                >`
          }
        </div>
        ${Object.values(this.#rowErrors(index, errors)).map(
          (message) => html`<p class="error" data-test=${`label-${index}-error`}>${message}</p>`,
        )}
      </td>
      <td class="pick-cell">
        <label class="pick" data-test=${`label-${index}-pick`}
          ><input
            type="radio"
            name="default-label"
            data-test=${`label-${index}-default`}
            aria-label=${`${t("options.default")}: ${label.name}`}
            .checked=${this.defaultLabelId === label.id}
            ?disabled=${!label.available || this.busy}
            @change=${() => this.#edit(() => (this.defaultLabelId = label.id))}
        /></label>
      </td>
      <td>
        <wt-row-actions align="end" label=${`${t("options.option_actions")}: ${label.name}`}
          ><wt-button
            variant="secondary"
            data-test=${`edit-label-${index}`}
            .disabled=${this.busy}
            @click=${(event: Event) => {
              event.stopPropagation();
              this.#openEditor(label);
            }}
            >${t("action.edit")}</wt-button
          ><wt-button
            variant="danger"
            data-test=${`remove-label-${index}`}
            .disabled=${this.busy}
            @click=${(event: Event) => {
              event.stopPropagation();
              this.#removeLabel(label.id);
            }}
            >${t("action.delete")}</wt-button
          ></wt-row-actions
        >
      </td>
    </tr>`;
  }

  #labelsSection(errors: Record<string, string>) {
    return html`${this.#reorder.liveRegion()}
      <div class="table-wrap" tabindex="0" role="region" aria-label=${t("options.list_options")}>
        <table>
          <thead>
            <tr>
              <th scope="col"><span class="visually-hidden">${t("options.reorder")}</span></th>
              <th scope="col">${t("options.name")}</th>
              <th scope="col">${t("options.default")}</th>
              <th scope="col">
                <span class="visually-hidden">${t("options.option_actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            ${repeat(
              this.labels,
              (label) => label.id,
              (label, index) => this.#labelRow(label, index, errors),
            )}
          </tbody>
        </table>
      </div>
      ${
        errors.labels
          ? html`<p class="error" data-test="labels-error">${errors.labels}</p>`
          : nothing
      }
      <div class="label-actions">
        <wt-button
          variant="secondary"
          data-test="add-option"
          .disabled=${this.busy}
          @click=${(event: Event) => {
            event.stopPropagation();
            this.#openEditor("new");
          }}
          >${t("options.add_option")}</wt-button
        >
      </div>`;
  }

  #labelEditor(errors: Record<string, string>) {
    const editing = this.editingLabel;
    const index =
      editing === null || editing === "new"
        ? -1
        : this.labels.findIndex((label) => label.id === editing.id);
    return html`<dashboard-option-label-form
      .open=${editing !== null}
      .busy=${this.busy}
      .languages=${this.languages}
      .value=${editing === "new" ? null : editing}
      .errors=${index < 0 ? {} : this.#rowErrors(index, errors)}
      @wt-submit=${(event: CustomEvent<{ value: DraftLabel }>) => this.#saveLabel(event)}
      @wt-cancel=${(event: Event) => {
        event.stopPropagation();
        this.#closeEditor();
      }}
    ></dashboard-option-label-form>`;
  }

  override render() {
    const errors = this.#errors();
    return html`<wt-modal
        .open=${this.open}
        heading=${t(this.value ? "options.edit" : "options.create")}
        @keydown=${(event: KeyboardEvent) => {
          if (this.busy && event.key === "Escape") event.preventDefault();
        }}
        @wt-close=${(event: Event) => this.#cancel(event)}
      >
        <div
          ?inert=${this.busy}
          class="fields"
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]'))}
        >
          <wt-form-error-summary
            heading=${t("form.error_heading")}
            .errors=${Object.values(errors)}
          ></wt-form-error-summary>
          <div class="names">
            <wt-input
              name="name"
              label=${t("options.name")}
              required
              .disabled=${this.busy}
              .value=${this.name}
              .error=${errors.name ?? ""}
              .invalid=${!!errors.name}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                event.stopPropagation();
                this.#edit(() => (this.name = event.detail.value));
              }}
            ></wt-input>
            ${this.#namesSection(errors)}
            <wt-switch
              name="active"
              data-test="active"
              label=${t("options.active")}
              .checked=${this.active}
              .disabled=${this.busy}
              @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                event.stopPropagation();
                this.#edit(() => (this.active = event.detail.checked));
              }}
            ></wt-switch>
          </div>
          ${this.#labelsSection(errors)}
        </div>
        <wt-form-actions slot="footer"
          ><wt-button
            slot="cancel"
            data-test="cancel"
            variant="secondary"
            .disabled=${this.busy}
            @click=${(event: Event) => this.#cancel(event)}
            >${t("action.cancel")}</wt-button
          >
          <wt-button
            data-test="save"
            variant="primary"
            .disabled=${this.busy}
            @click=${(event: Event) => this.#submit(event)}
            >${t("action.save")}</wt-button
          ></wt-form-actions
        >
      </wt-modal>
      ${this.#labelEditor(errors)}`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-option-list-form": OptionListForm;
  }
}
