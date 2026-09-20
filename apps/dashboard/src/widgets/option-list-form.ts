import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, submitOnEnter } from "@waitron/ui";
import type { ContentLanguages } from "@waitron/shared";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import { nonBlankNames } from "./form-fields.js";
import { reorder } from "./reorder.js";
import { ReorderController, type ReorderModel } from "./reorder-table.js";
import type { OptionList, OptionListInput } from "../api/client.js";
import { t } from "../i18n/t.js";

/** A label while it is being edited: every optional name is held as text, and every label has an
 * `id` — including one the operator has just added, which is what lets it be preselected before it
 * has ever been saved (see {@link OptionListForm}). */
interface DraftLabel {
  id: string;
  name: string;
  customerName: Record<string, string>;
  kitchenName: string;
  available: boolean;
}

/** A translated map with its blank languages dropped, or null when nothing was entered — the shape
 * `parseOptionListInput` reads a customer name as (packages/catalogue/src/option-contract.ts). */
function translations(value: Record<string, string>): Record<string, string> | null {
  const named = nonBlankNames(value);
  return Object.keys(named).length ? named : null;
}

/**
 * Creates and edits ONE options list: its three names, whether it is offered, and its ordered
 * labels, each with three names of its own and one of them preselected.
 *
 * Writes belong to the host, which passes the server's per-field refusals back through
 * `fieldErrors`; this form owns the draft and its own refusals.
 *
 * Two things the server's validator decides, mirrored here so the operator learns them without a
 * round trip (both read from `parseOptionListInput`, packages/catalogue/src/option-contract.ts):
 * an ACTIVE list with no available label is refused, and a preselection naming a label that is not
 * available is dropped to null rather than refused — so this form never offers that combination and
 * never reports it as a fault.
 */
@customElement("dashboard-option-list-form")
export class OptionListForm extends LitElement {
  static override styles = [
    baseStyles,
    ReorderController.styles,
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
      /* The labels table is the one element allowed to be wider than the modal; its own scroller
         keeps the dialog from scrolling sideways at phone width. It is focusable so a keyboard can
         reach the scroll, which with no labels yet is the only way to: the seven-column header
         overflows on its own and there is no row input to tab into. Same shape as
         packages/ui/src/components/wt-data-table.ts:753. */
      .labels-wrap {
        overflow-x: auto;
      }
      .labels-wrap:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        padding: var(--wt-space-2) var(--wt-space-1);
        text-align: start;
        vertical-align: top;
        border-bottom: 1px solid var(--wt-color-border);
      }
      td.pick-cell,
      td.handle-cell {
        vertical-align: middle;
      }
      .cell-stack {
        display: grid;
        gap: var(--wt-space-2);
        min-width: var(--wt-cell-name-max-width);
      }
      /* A lone input in a cell has no width of its own, so the automatic table layout shrinks it to
         wt-input's own tap-target floor and cuts the value off mid-word. The same token the stacked
         translated names use gives it room; the table's own scroller absorbs the extra width. */
      .cell-field {
        min-width: var(--wt-cell-name-max-width);
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
      .label-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
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
  @state() private validation: Record<string, string> = {};
  /** `fieldErrors` with each path turned into one of this form's own keys. A label's message is
   * held against the label's ID rather than the position the server named, so moving a label
   * carries its message with it. */
  @state() private serverErrors: Record<string, string> = {};

  readonly #reorder = new ReorderController(this, {
    order: () => this.labels.map((label) => label.id),
    move: (id, to) => this.#move(id, to),
    label: (id) => this.labels.find((label) => label.id === id)?.name || t("options.label"),
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
    this.defaultLabelId = this.#pickable(value?.defaultLabelId ?? null);
    this.validation = {};
  }

  /** A preselection is only kept while it names a label of this list that is on offer. */
  #pickable(id: string | null): string | null {
    return this.labels.some((label) => label.id === id && label.available) ? id : null;
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

  /** One of `parseOptionListInput`'s field paths as this form's own key. A path naming the list as
   * a whole, a label's id or a label's availability has no input of its own, so it is shown under
   * the labels table with the rest of the list-level refusals. An unrecognised path is kept as it
   * came, so it still reaches the summary rather than disappearing. */
  #formKey(field: string): string {
    const label = /^labels\.(\d+)(?:\.(.+))?$/.exec(field);
    if (label) {
      const id = this.labels[Number(label[1])]?.id;
      const key = this.#nameKey(label[2] ?? "");
      return id === undefined || key === null ? "labels" : `label:${id}:${key}`;
    }
    return this.#nameKey(field) ?? "labels";
  }

  /** The input key for one of the three name fields, or null when the path names no input. */
  #nameKey(field: string): string | null {
    if (field === "name") return "name";
    if (field === "customerName") return `customer-name-${this.#primaryLanguage()}`;
    if (field === "kitchenName") return "kitchen-name";
    if (field === "active") return "active";
    return null;
  }

  /** Every message on screen, keyed by input name: the server's, then this form's own on top. A
   * label's message is placed by the label's CURRENT position, so it stays on its own row. */
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

  /** Every draft edit goes through here: a change invalidates what the last Save complained about,
   * and the messages are recomputed by the next Save. */
  #edit(change: () => void): void {
    change();
    this.validation = {};
  }

  #editLabel(id: string, patch: Partial<DraftLabel>): void {
    this.#edit(() => {
      this.labels = this.labels.map((label) => (label.id === id ? { ...label, ...patch } : label));
      this.defaultLabelId = this.#pickable(this.defaultLabelId);
    });
  }

  #addLabel(): void {
    this.#edit(() => {
      // A label is given its id HERE, not by the server: `parseOptionListInput` refuses a
      // `defaultLabelId` naming no label in the submitted array, so a label the operator adds and
      // preselects in the same save has to travel with an id of its own. `writeLabels` inserts a
      // supplied id rather than replacing it (packages/catalogue/src/options.ts).
      const label: DraftLabel = {
        id: crypto.randomUUID(),
        name: "",
        customerName: {},
        kitchenName: "",
        available: true,
      };
      this.labels = [...this.labels, label];
    });
  }

  #removeLabel(id: string): void {
    this.#edit(() => {
      this.labels = this.labels.filter((label) => label.id !== id);
      this.defaultLabelId = this.#pickable(this.defaultLabelId);
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
    for (const [index, label] of this.labels.entries())
      if (!label.name.trim()) validation[`label-${index}-name`] = t("options.label_name_required");
    // An active list is asked on every dish carrying it and answered from its available labels, so
    // one with none is unanswerable. The server refuses the same shape; refusing it here puts the
    // message beside the labels instead of spending a round trip on it.
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

  /** One optional translated name, shown with the staff name as its placeholder: blank means it
   * falls back to that name, which is the inheritance hint the spec asks every fallback field to
   * carry (2026-09-18-one-product-model-design.md §9.1). */
  #translatedField(
    key: string,
    label: string,
    value: Record<string, string>,
    errors: Record<string, string>,
    fallback: string,
    change: (value: Record<string, string>) => void,
  ) {
    return this.languages.languages.map(
      (locale) =>
        html`<wt-input
          name=${`${key}-${locale}`}
          label=${`${label} (${locale})`}
          placeholder=${fallback}
          .disabled=${this.busy}
          .value=${value[locale] ?? ""}
          .error=${errors[`${key}-${locale}`] ?? ""}
          .invalid=${!!errors[`${key}-${locale}`]}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            change({ ...value, [locale]: event.detail.value });
          }}
        ></wt-input>`,
    );
  }

  #labelRow(label: DraftLabel, index: number, errors: Record<string, string>) {
    const named = label.name || t("options.label");
    return html`<tr data-label=${label.id}>
      <td class="handle-cell">${this.#reorder.handle(label.id)}</td>
      <td>
        <wt-input
          class="cell-field"
          name=${`label-${index}-name`}
          label=${t("options.name")}
          required
          .disabled=${this.busy}
          .value=${label.name}
          .error=${errors[`label-${index}-name`] ?? ""}
          .invalid=${!!errors[`label-${index}-name`]}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#editLabel(label.id, { name: event.detail.value });
          }}
        ></wt-input>
      </td>
      <td>
        <div class="cell-stack">
          ${this.#translatedField(
            `label-${index}-customer-name`,
            t("options.customer_name"),
            label.customerName,
            errors,
            label.name,
            (customerName) => this.#editLabel(label.id, { customerName }),
          )}
        </div>
      </td>
      <td>
        <wt-input
          class="cell-field"
          name=${`label-${index}-kitchen-name`}
          label=${t("options.kitchen_name")}
          placeholder=${label.name}
          .disabled=${this.busy}
          .value=${label.kitchenName}
          .error=${errors[`label-${index}-kitchen-name`] ?? ""}
          .invalid=${!!errors[`label-${index}-kitchen-name`]}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#editLabel(label.id, { kitchenName: event.detail.value });
          }}
        ></wt-input>
      </td>
      <td>
        <wt-switch
          name=${`label-${index}-available`}
          data-test=${`label-${index}-available`}
          label=${t("options.available")}
          .checked=${label.available}
          .disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
            event.stopPropagation();
            this.#editLabel(label.id, { available: event.detail.checked });
          }}
        ></wt-switch>
      </td>
      <td class="pick-cell">
        <label class="pick" data-test=${`label-${index}-pick`}
          ><input
            type="radio"
            name="default-label"
            data-test=${`label-${index}-default`}
            aria-label=${`${t("options.default")}: ${named}`}
            .checked=${this.defaultLabelId === label.id}
            ?disabled=${!label.available || this.busy}
            @change=${() => this.#edit(() => (this.defaultLabelId = label.id))}
        /></label>
      </td>
      <td>
        <wt-button
          variant="danger"
          data-test=${`remove-label-${index}`}
          aria-label=${`${t("options.remove_label")}: ${named}`}
          .disabled=${this.busy}
          @click=${(event: Event) => {
            event.stopPropagation();
            this.#removeLabel(label.id);
          }}
          >${t("action.remove")}</wt-button
        >
      </td>
    </tr>`;
  }

  #labelsSection(errors: Record<string, string>) {
    return html`${this.#reorder.liveRegion()}
      <div class="labels-wrap" tabindex="0" role="region" aria-label=${t("options.labels")}>
        <table>
          <thead>
            <tr>
              <th scope="col"><span class="visually-hidden">${t("options.reorder")}</span></th>
              <th scope="col">${t("options.name")}</th>
              <th scope="col">${t("options.customer_name")}</th>
              <th scope="col">${t("options.kitchen_name")}</th>
              <th scope="col">${t("options.available")}</th>
              <th scope="col">${t("options.default")}</th>
              <th scope="col"><span class="visually-hidden">${t("action.remove")}</span></th>
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
          data-test="add-label"
          .disabled=${this.busy}
          @click=${(event: Event) => {
            event.stopPropagation();
            this.#addLabel();
          }}
          >${t("options.add_label")}</wt-button
        >${
          this.defaultLabelId === null
            ? nothing
            : html`<wt-button
                variant="ghost"
                data-test="clear-default"
                .disabled=${this.busy}
                @click=${(event: Event) => {
                  event.stopPropagation();
                  this.#edit(() => (this.defaultLabelId = null));
                }}
                >${t("options.clear_default")}</wt-button
              >`
        }
      </div>`;
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
          ${this.#translatedField(
            "customer-name",
            t("options.customer_name"),
            this.customerName,
            errors,
            this.name,
            (customerName) => this.#edit(() => (this.customerName = customerName)),
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
    </wt-modal>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-option-list-form": OptionListForm;
  }
}
