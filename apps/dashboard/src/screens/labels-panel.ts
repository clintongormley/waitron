import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, submitOnEnter, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-spinner.js";
import { DashboardQueries } from "../api/query-controller.js";
import type { DashboardApi, LabelSummary } from "../api/client.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

/** The refusals that are about the name the form holds, so they belong beside that field. */
const NAME_CODES = new Set(["label.name_taken", "label.invalid"]);

/**
 * The Categories screen's Labels tab: flat, staff-facing labels a product can carry any number of.
 * A null `editing.label` is a create.
 */
@customElement("dashboard-labels-panel")
export class LabelsPanel extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .tab-actions {
        display: flex;
        justify-content: flex-end;
        margin-bottom: var(--wt-space-4);
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private labels: LabelSummary[] = [];
  @state() private loading = true;
  @state() private loadError = false;
  @state() private editing: { label: LabelSummary | null } | null = null;
  @state() private name = "";
  @state() private nameError = "";
  @state() private deleting: LabelSummary | null = null;
  @state() private saveError = "";
  @state() private busy = false;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.loadError = true;
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.loadError = false;
    try {
      await this.#queries.watch("listLabels", [], (value) => {
        this.labels = value;
      });
    } catch {
      this.loadError = true;
    } finally {
      this.loading = false;
    }
  }

  #edit(label: LabelSummary | null): void {
    this.editing = { label };
    this.name = label?.name ?? "";
    this.nameError = "";
    this.saveError = "";
  }

  async #save(): Promise<void> {
    const editing = this.editing;
    if (!editing || this.busy) return;
    const name = this.name.trim();
    this.saveError = "";
    this.nameError = name ? "" : t("labels.name_required");
    if (!name) return;
    this.busy = true;
    try {
      if (editing.label) await this.api.renameLabel(editing.label.id, name);
      else await this.api.createLabel(name);
    } catch (error) {
      const code = codeOf(error);
      if (NAME_CODES.has(code)) this.nameError = codeMessage(code);
      else this.saveError = codeMessage(code);
      return;
    } finally {
      this.busy = false;
    }
    this.editing = null;
    await this.#load();
  }

  async #delete(): Promise<void> {
    const label = this.deleting;
    if (!label || this.busy) return;
    this.busy = true;
    this.saveError = "";
    try {
      await this.api.deleteLabel(label.id);
    } catch (error) {
      this.saveError = codeMessage(codeOf(error));
      return;
    } finally {
      this.busy = false;
    }
    this.deleting = null;
    await this.#load();
  }

  #deleteCount(label: LabelSummary): string {
    if (label.productCount === 0) return t("labels.delete_unused");
    if (label.productCount === 1) return t("labels.delete_count_one");
    return t("labels.delete_count").replace("{count}", String(label.productCount));
  }

  #columns(): DataTableColumn<LabelSummary>[] {
    return [
      {
        key: "name",
        label: t("labels.name"),
        cell: (label) => label.name,
        searchValue: (label) => label.name,
        sortValue: (label) => label.name,
      },
      {
        key: "products",
        label: t("categories.products_modal"),
        cell: (label) => String(label.productCount),
        sortValue: (label) => label.productCount,
      },
      {
        key: "actions",
        label: t("categories.actions"),
        cell: (label) =>
          html`<wt-row-actions label=${`${t("categories.actions")}: ${label.name}`}
            ><wt-button
              align="start"
              variant="ghost"
              data-test="rename-label"
              @click=${() => this.#edit(label)}
              >${t("labels.rename_action")}</wt-button
            ><wt-button
              align="start"
              variant="ghost"
              data-test="delete-label"
              @click=${() => {
                this.saveError = "";
                this.deleting = label;
              }}
              >${t("action.delete")}</wt-button
            ></wt-row-actions
          >`,
      },
    ];
  }

  /** Escape and a close are refused while a write is in flight, so the dialog cannot vanish with its
   * outcome still unknown. */
  #guardEscape = (event: KeyboardEvent) => {
    if (this.busy && event.key === "Escape") event.preventDefault();
  };

  override render() {
    const deleting = this.deleting;
    return html`<div class="tab-actions">
        <wt-button data-test="add-label" variant="primary" @click=${() => this.#edit(null)}
          >${t("labels.add")}</wt-button
        >
      </div>
      ${this.loading ? html`<wt-spinner></wt-spinner>` : nothing}
      ${
        this.loadError
          ? html`<p class="error" data-test="load-error" role="alert">${t("labels.load_error")}</p>
              <wt-button data-test="retry" variant="secondary" @click=${() => void this.#load()}
                >${t("location_settings.retry")}</wt-button
              >`
          : nothing
      }
      <wt-data-table
        data-test="labels"
        aria-label=${t("labels.title")}
        searchable
        searchLabel=${t("labels.search")}
        noMatchesMessage=${t("labels.no_matches")}
        viewKey="waitron.labels.table"
        sortKey="name"
        sortDirection="ascending"
        .rows=${this.labels}
        .columns=${this.#columns()}
        .rowKey=${(label: LabelSummary) => label.id}
        .emptyMessage=${t("labels.empty")}
      ></wt-data-table>
      <wt-modal
        data-test="label-form"
        .open=${this.editing !== null}
        heading=${t(this.editing?.label ? "labels.rename" : "labels.add")}
        @keydown=${(event: KeyboardEvent) => {
          this.#guardEscape(event);
          submitOnEnter(
            event,
            this.shadowRoot!.querySelector<HTMLElement>("[data-test=save-label]"),
          );
        }}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (!this.busy) this.editing = null;
        }}
      >
        <wt-form-error-summary
          heading=${t("form.error_heading")}
          .errors=${this.nameError ? [this.nameError] : []}
        ></wt-form-error-summary>
        ${this.saveError ? html`<p class="error" role="alert">${this.saveError}</p>` : nothing}
        <wt-input
          name="label-name"
          label=${t("labels.name")}
          required
          .value=${this.name}
          .error=${this.nameError}
          .invalid=${!!this.nameError}
          .disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.name = event.detail.value;
          }}
        ></wt-input>
        <wt-form-actions slot="footer"
          ><wt-button
            slot="cancel"
            variant="secondary"
            .disabled=${this.busy}
            @click=${() => {
              this.editing = null;
            }}
            >${t("action.cancel")}</wt-button
          ><wt-button
            data-test="save-label"
            variant="primary"
            .loading=${this.busy}
            .disabled=${this.busy}
            @click=${() => void this.#save()}
            >${t("action.save")}</wt-button
          ></wt-form-actions
        >
      </wt-modal>
      <wt-modal
        data-test="label-delete"
        .open=${deleting !== null}
        heading=${t("labels.delete_named").replace("{name}", deleting?.name ?? "")}
        @keydown=${this.#guardEscape}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (!this.busy) this.deleting = null;
        }}
      >
        ${deleting ? html`<p data-test="delete-count">${this.#deleteCount(deleting)}</p>` : nothing}
        ${this.saveError ? html`<p class="error" role="alert">${this.saveError}</p>` : nothing}
        <wt-form-actions slot="footer"
          ><wt-button
            slot="cancel"
            variant="secondary"
            .disabled=${this.busy}
            @click=${() => {
              this.deleting = null;
            }}
            >${t("action.cancel")}</wt-button
          ><wt-button
            variant="danger"
            .loading=${this.busy}
            .disabled=${this.busy}
            @click=${() => void this.#delete()}
            >${t("action.delete")}</wt-button
          ></wt-form-actions
        >
      </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-labels-panel": LabelsPanel;
  }
}
