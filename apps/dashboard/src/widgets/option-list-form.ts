import { ReorderController, reorder, type ReorderModel } from "@waitron/ui";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, focusFirstInvalid, submitOnEnter } from "@waitron/ui";
import type { ContentLanguages } from "@waitron/shared";
import { effectiveDefaultLabelId } from "@waitron/catalogue/src/option-default.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-disclosure.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-lozenge.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import {
  effectiveNamesLine,
  optionalTextFields,
  textField,
  translations,
  type FieldContext,
} from "./form-fields.js";
import "./option-label-form.js";
import type { DraftLabel } from "./option-label-form.js";
import type { OptionList, OptionListInput } from "../api/client.js";
import { t } from "../i18n/t.js";

/**
 * An ACTIVE list with no available option is refused here before saving, as `parseOptionListInput`
 * (packages/catalogue/src/option-contract.ts) refuses it; both take the default from
 * `effectiveDefaultLabelId`.
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
      th:first-child,
      td:first-child,
      th:nth-child(3),
      td:nth-child(3),
      th:last-child,
      td:last-child {
        width: 1%;
        white-space: nowrap;
      }
      th:nth-child(3) {
        position: relative;
      }
      .default-heading {
        position: absolute;
        inset-inline-end: var(--wt-space-1);
        inset-block-start: var(--wt-space-2);
        white-space: nowrap;
      }
      td:last-child {
        text-align: end;
      }
      /* A row holds one line of text beside two tap-target-high controls, so all three are centred
         on it; the shared table styles put a cell's content at its top. */
      tbody td {
        vertical-align: middle;
      }
      tbody tr[data-label] {
        cursor: pointer;
      }
      tbody tr[data-label]:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
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
      .open-label {
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        overflow-wrap: anywhere;
        cursor: pointer;
      }
      .open-label:hover:not(:disabled) {
        opacity: var(--wt-opacity-hover);
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
  @state() private editingLabel: DraftLabel | "new" | null = null;
  @state() private attempted = false;
  /** `serverErrors` keys the operator has since changed the field of, or submitted past. */
  @state() private dismissed = new Set<string>();
  /** `fieldErrors` with each path turned into one of this form's own keys. A label's message is
   * held against the label's ID rather than the position the server named, so moving a label
   * carries its message with it. */
  @state() private serverErrors: Record<string, string> = {};
  #rowPointerStart: EventTarget | null = null;

  readonly #reorder = new ReorderController(
    this,
    {
      order: () => this.labels.map((label) => label.id),
      move: (id, to) => this.#move(id, to),
      label: (id) => this.labels.find((label) => label.id === id)!.name,
      busy: () => this.busy,
      get reorderLabel(): string {
        return t("options.reorder");
      },
    } satisfies ReorderModel,
    { announce: () => t("action.reordered") },
  );

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
    if (changes.has("fieldErrors")) {
      this.serverErrors = this.#mapFieldErrors();
      this.dismissed = new Set();
    }
  }

  protected override updated(changes: PropertyValues<this>): void {
    if (changes.has("fieldErrors") && this.#messages().fieldKeys.size > 0)
      void this.#focusFirstInvalid();
  }

  /** A message under the options table or a row has no control of its own, so focus goes to the
   * table when no control is invalid. */
  async #focusFirstInvalid(): Promise<void> {
    await this.updateComplete;
    if ((await focusFirstInvalid(this.shadowRoot!)) === null)
      this.shadowRoot!.querySelector<HTMLElement>(".table-wrap")?.focus();
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
    this.attempted = false;
    this.dismissed = new Set();
  }

  #keepDefault(): void {
    this.defaultLabelId = effectiveDefaultLabelId(this.labels, this.defaultLabelId);
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
   * refusals. `_form` names no field, and is shown above Save alone. */
  #formKey(field: string): string {
    if (field === "_form") return field;
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

  #validate(): Record<string, string> {
    const validation: Record<string, string> = {};
    if (!this.name.trim()) validation.name = t("options.name_required");
    if (this.active && !this.labels.some((label) => label.available))
      validation.labels = t("options.labels_required");
    return validation;
  }

  /**
   * Every message on screen, keyed as the form shows it, and the keys among them that are a field's.
   * A refusal held for an option the operator has since removed is shown under the options table but
   * marks no field: removing the option was the change to it.
   * `active` and `_form` name nothing this form shows a message under.
   */
  #messages(): { errors: Record<string, string>; fieldKeys: Set<string> } {
    const errors: Record<string, string> = {};
    const fieldKeys = new Set<string>();
    const shown = new Set([
      "name",
      "kitchen-name",
      "labels",
      ...this.languages.languages.map((locale) => `customer-name-${locale}`),
    ]);
    const live = Object.entries(this.serverErrors).filter(([key]) => !this.dismissed.has(key));
    const removed = ([key]: [string, string]) => {
      const held = /^label:([^:]+):/.exec(key);
      return held !== null && !this.labels.some((label) => label.id === held[1]);
    };
    for (const [, message] of live.filter(removed)) errors.labels = message;
    for (const [key, message] of live.filter((entry) => !removed(entry))) {
      errors[key] = message;
      if (key.startsWith("label:") || shown.has(key)) fieldKeys.add(key);
    }
    if (this.attempted)
      for (const [key, message] of Object.entries(this.#validate())) {
        errors[key] = message;
        fieldKeys.add(key);
      }
    return { errors, fieldKeys };
  }

  /** Each option's messages, keyed as the option editor names its inputs (`label-name`). */
  #errorsByLabel(errors: Record<string, string>): Map<string, Record<string, string>> {
    const byLabel = new Map<string, Record<string, string>>();
    for (const [key, message] of Object.entries(errors)) {
      const held = /^label:([^:]+):(.+)$/.exec(key);
      if (held === null) continue;
      const row = byLabel.get(held[1]!) ?? {};
      row[`label-${held[2]}`] = message;
      byLabel.set(held[1]!, row);
    }
    return byLabel;
  }

  #edit(change: () => void, ...keys: string[]): void {
    change();
    this.dismissed = new Set([...this.dismissed, ...keys]);
  }

  /** A change to the options answers a refusal about them as a whole. */
  #editLabels(change: () => void): void {
    this.#edit(change, "labels");
  }

  #saveLabel(event: CustomEvent<{ value: DraftLabel }>): void {
    event.stopPropagation();
    const saved = event.detail.value;
    const known = this.labels.some((label) => label.id === saved.id);
    this.#editLabels(() => {
      this.labels = known
        ? this.labels.map((label) => (label.id === saved.id ? saved : label))
        : [...this.labels, saved];
      this.#keepDefault();
      this.serverErrors = Object.fromEntries(
        Object.entries(this.serverErrors).filter(([key]) => !key.startsWith(`label:${saved.id}:`)),
      );
    });
    this.#closeEditor();
  }

  #openedFrom: "name" | "menu" | "row" = "menu";

  #openEditor(label: DraftLabel | "new", from: "name" | "menu" | "row" = "menu"): void {
    this.editingLabel = label;
    this.#openedFrom = from;
  }

  /** Closes the option editor and puts focus back on the control that opened it. The focus waits
   * for the editor's dialog to close, because closing it moves focus too and would undo it. */
  #closeEditor(): void {
    const editing = this.editingLabel;
    this.editingLabel = null;
    void this.#returnFocus(
      editing === null || editing === "new" ? null : editing.id,
      this.#openedFrom,
    );
  }

  async #returnFocus(id: string | null, to: "name" | "menu" | "row" = "menu"): Promise<void> {
    await this.updateComplete;
    await this.shadowRoot!.querySelector("dashboard-option-label-form")!.updateComplete;
    const target =
      id === null
        ? this.shadowRoot!.querySelector<HTMLElement>('[data-test="add-option"]')
        : this.shadowRoot!.querySelector<HTMLElement>(
            `tr[data-label="${id}"]${to === "row" ? "" : to === "name" ? " .open-label" : " wt-row-actions"}`,
          );
    target?.focus();
  }

  #removeLabel(id: string): void {
    const index = this.labels.findIndex((label) => label.id === id);
    if (index < 0) return;
    const focusId = this.labels[index + 1]?.id ?? this.labels[index - 1]?.id ?? null;
    this.#editLabels(() => {
      this.labels = this.labels.filter((label) => label.id !== id);
      this.#keepDefault();
    });
    void this.#returnFocus(focusId);
  }

  /** The labels array order IS the saved order, so a move rewrites the array rather than a rank. */
  #move(id: string, to: number): void {
    const from = this.labels.findIndex((label) => label.id === id);
    if (from < 0) return;
    this.#editLabels(() => {
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
    this.attempted = true;
    this.dismissed = new Set(Object.keys(this.serverErrors));
    if (Object.keys(this.#validate()).length) {
      void this.#focusFirstInvalid();
      return;
    }
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
    // The dialog also reports a close it was told to make, a task later; by then the screen has
    // closed this form and a second cancel would be about nothing.
    if (this.busy || !this.open) {
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

  #namesSection(errors: Record<string, string>) {
    const locales = this.languages.languages;
    const hasError = locales.some((locale) => !!errors[`customer-name-${locale}`]);
    return html`<wt-disclosure
      data-test="names-section"
      heading=${t("options.customer_names")}
      .summaryFields=${effectiveNamesLine(
        locales,
        this.customerName,
        this.languages.defaultLanguage,
        this.name,
      )}
      .hasError=${hasError}
    >
      <div class="names">
        ${optionalTextFields(
          this.#fields(errors),
          "customer-name",
          t("options.customer_name"),
          this.customerName,
          (customerName) =>
            this.#edit(
              () => (this.customerName = customerName),
              ...locales
                .filter((locale) => customerName[locale] !== this.customerName[locale])
                .map((locale) => `customer-name-${locale}`),
            ),
          this.name,
          this.languages.defaultLanguage,
        )}
      </div>
    </wt-disclosure>`;
  }

  #labelRow(label: DraftLabel, index: number, rowErrors: Record<string, string>) {
    return html`<tr
      data-label=${label.id}
      tabindex=${this.busy ? -1 : 0}
      aria-label=${`${t("options.edit_option")}: ${label.name}`}
      @pointerdown=${(event: PointerEvent) => {
        this.#rowPointerStart = event.target;
      }}
      @click=${(event: MouseEvent) => {
        const pointerStart = this.#rowPointerStart;
        this.#rowPointerStart = null;
        // A drag across cells sends its click to the row, losing the control where it began.
        if (
          this.busy ||
          (event.detail > 0 &&
            event.target === event.currentTarget &&
            pointerStart !== event.currentTarget) ||
          event
            .composedPath()
            .some(
              (node) =>
                node instanceof Element &&
                node.matches("button, input, label, wt-row-actions, wt-button"),
            )
        )
          return;
        this.#openEditor(label, "row");
      }}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy || event.target !== event.currentTarget || event.key !== "Enter") return;
        event.preventDefault();
        this.#openEditor(label, "row");
      }}
    >
      <td class="handle-cell">${this.#reorder.handle(label.id)}</td>
      <td>
        <div class="option-name">
          <button
            type="button"
            class="open-label"
            data-test=${`open-label-${index}`}
            aria-label=${`${t("options.edit_option")}: ${label.name}`}
            @click=${(event: Event) => {
              event.stopPropagation();
              this.#openEditor(label, "name");
            }}
          >
            <span data-test=${`label-${index}-name`}>${label.name}</span></button
          >${
            label.available
              ? nothing
              : html`<wt-lozenge data-test=${`label-${index}-unavailable`}
                  >${t("options.unavailable")}</wt-lozenge
                >`
          }
        </div>
        ${Object.values(rowErrors).map(
          (message) => html`<p class="error" data-test=${`label-${index}-error`}>${message}</p>`,
        )}
      </td>
      <td>
        <label class="pick" data-test=${`label-${index}-pick`}
          ><input
            type="radio"
            name="default-label"
            data-test=${`label-${index}-default`}
            aria-label=${`${t("options.default")}: ${label.name}`}
            .checked=${this.defaultLabelId === label.id}
            ?disabled=${!label.available || this.busy}
            @change=${() => this.#editLabels(() => (this.defaultLabelId = label.id))}
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

  #labelsSection(errors: Record<string, string>, byLabel: Map<string, Record<string, string>>) {
    return html`${this.#reorder.liveRegion()}
      <div class="table-wrap" tabindex="0" role="region" aria-label=${t("options.list_options")}>
        <table>
          <thead>
            <tr>
              <th scope="col"><span class="visually-hidden">${t("options.reorder")}</span></th>
              <th scope="col">${t("options.name")}</th>
              <th scope="col"><span class="default-heading">${t("options.default")}</span></th>
              <th scope="col">
                <span class="visually-hidden">${t("options.option_actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            ${repeat(
              this.labels,
              (label) => label.id,
              (label, index) => this.#labelRow(label, index, byLabel.get(label.id) ?? {}),
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

  #labelEditor(byLabel: Map<string, Record<string, string>>) {
    const editing = this.editingLabel;
    return html`<dashboard-option-label-form
      .open=${editing !== null}
      .busy=${this.busy}
      .languages=${this.languages}
      .value=${editing === "new" ? null : editing}
      .errors=${editing === null || editing === "new" ? {} : (byLabel.get(editing.id) ?? {})}
      @wt-submit=${(event: CustomEvent<{ value: DraftLabel }>) => this.#saveLabel(event)}
      @wt-cancel=${(event: Event) => {
        event.stopPropagation();
        this.#closeEditor();
      }}
    ></dashboard-option-label-form>`;
  }

  override render() {
    const { errors, fieldKeys } = this.#messages();
    const fields = this.#fields(errors);
    const byLabel = this.#errorsByLabel(errors);
    // The options table shows its own message, even one that marks no field.
    const bottom = [
      ...Object.entries(errors)
        .filter(([key, message]) => message && key !== "labels" && !fieldKeys.has(key))
        .map(([, message]) => message),
      ...(fieldKeys.size > 0 ? [t("form.fix_fields")] : []),
    ].join(" ");
    const invalid = this.attempted && Object.keys(this.#validate()).length > 0;
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
          <div class="names">
            ${textField(
              fields,
              "name",
              t("options.name"),
              this.name,
              (name) => this.#edit(() => (this.name = name), "name"),
              true,
            )}
            ${textField(
              fields,
              "kitchen-name",
              t("options.kitchen_name"),
              this.kitchenName,
              (kitchenName) => this.#edit(() => (this.kitchenName = kitchenName), "kitchen-name"),
              false,
              this.name,
            )}
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
          ${this.#labelsSection(errors, byLabel)}
        </div>
        <wt-form-actions slot="footer" .error=${bottom}
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
            .disabled=${this.busy || invalid}
            @click=${(event: Event) => this.#submit(event)}
            >${t("action.save")}</wt-button
          ></wt-form-actions
        >
      </wt-modal>
      ${this.#labelEditor(byLabel)}`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-option-list-form": OptionListForm;
  }
}
