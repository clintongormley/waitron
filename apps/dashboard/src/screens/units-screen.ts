import type { ContentLanguages } from "@waitron/shared";
import { baseStyles, setContentLanguages } from "@waitron/ui";
import type { DataTableColumn } from "@waitron/ui/src/components/wt-data-table.js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { DashboardApi, Unit, UnitInput } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { codeMessage } from "../i18n/codes.js";
import { localizedName } from "../i18n/localized.js";
import { t } from "../i18n/t.js";
import "../widgets/unit-form.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-row-actions.js";

type UnitError = { code?: string; params?: { products?: Record<string, string>[] } };

@customElement("dashboard-units-screen")
export class UnitsScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-lg);
      }
      .description {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text-muted);
      }
      .toolbar {
        display: flex;
        gap: var(--wt-space-3);
        align-items: end;
        margin-bottom: var(--wt-space-4);
      }
      .search {
        flex: 1;
      }
      .error {
        color: var(--wt-color-danger);
      }
      .references {
        margin: var(--wt-space-2) 0 0;
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.error = error as UnitError;
    },
  );
  @state() private units: Unit[] = [];
  @state() private languages: ContentLanguages | null = null;
  @state() private loading = true;
  @state() private search = "";
  @state() private editorOpen = false;
  @state() private editing: Unit | null = null;
  @state() private busy = false;
  @state() private error: UnitError | null = null;
  @state() private fieldErrors: { name?: string; precision?: string } = {};
  @state() private deleteTarget: Unit | null = null;
  private focusTarget: HTMLElement | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.loading = true;
    try {
      await Promise.all([
        this.#queries.watch("listUnits", [], (value) => {
          this.units = value;
        }),
        this.#queries.watch("getContentLanguages", [], (value) => {
          this.languages = value;
          setContentLanguages(value);
        }),
      ]);
    } catch (error) {
      this.error = error as UnitError;
    } finally {
      this.loading = false;
    }
  }

  #openCreate(event: Event): void {
    event.stopPropagation();
    this.focusTarget = event.currentTarget as HTMLElement;
    this.editing = null;
    this.error = null;
    this.fieldErrors = {};
    this.editorOpen = true;
  }

  #openEdit(unit: Unit, event: Event): void {
    event.stopPropagation();
    this.focusTarget = event.currentTarget as HTMLElement;
    this.editing = unit;
    this.error = null;
    this.fieldErrors = {};
    this.editorOpen = true;
  }

  #closeEditor(): void {
    this.editorOpen = false;
    this.editing = null;
    requestAnimationFrame(() => this.focusTarget?.focus());
  }

  #closeDelete(): void {
    this.deleteTarget = null;
    requestAnimationFrame(() => this.focusTarget?.focus());
  }

  async #save(event: CustomEvent<{ value: UnitInput }>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    this.fieldErrors = {};
    try {
      const canonical = this.editing
        ? await this.api.updateUnit(this.editing.id, event.detail.value)
        : await this.api.createUnit(event.detail.value);
      this.units = this.editing
        ? this.units.map((unit) => (unit.id === canonical.id ? canonical : unit))
        : [...this.units, canonical];
      this.#closeEditor();
      try {
        this.units = await this.api.background.listUnits();
      } catch (error) {
        this.error = error as UnitError;
      }
    } catch (error) {
      this.error = error as UnitError;
      const code = this.error.code;
      this.fieldErrors =
        code === "unit.precision_invalid"
          ? { precision: t("units.precision_invalid") }
          : code === "content.translation_required" || code === "content.translation_invalid"
            ? { name: codeMessage(code) }
            : {};
    } finally {
      this.busy = false;
    }
  }

  async #delete(): Promise<void> {
    if (!this.deleteTarget || this.busy) return;
    const target = this.deleteTarget;
    this.busy = true;
    this.error = null;
    try {
      await this.api.deleteUnit(target.id);
      this.units = this.units.filter((unit) => unit.id !== target.id);
      this.#closeDelete();
    } catch (error) {
      this.error = error as UnitError;
      this.#closeDelete();
    } finally {
      this.busy = false;
    }
  }

  #columns(): DataTableColumn<Unit>[] {
    return [
      {
        key: "name",
        label: t("units.name"),
        cell: (unit) => localizedName(unit.name),
        sortValue: (unit) => localizedName(unit.name),
      },
      {
        key: "precision",
        label: t("units.precision"),
        cell: (unit) => unit.precision,
        sortValue: (unit) => unit.precision,
      },
      {
        key: "actions",
        label: t("units.actions"),
        cell: (unit) => html`
          <wt-row-actions label=${`${t("units.actions")}: ${localizedName(unit.name)}`}>
            <wt-button
              data-test=${`edit-${unit.id}`}
              variant="ghost"
              @click=${(event: Event) => this.#openEdit(unit, event)}
              >${t("action.edit")}</wt-button
            >
            <wt-button
              data-test=${`delete-${unit.id}`}
              variant="ghost"
              @click=${(event: Event) => {
                event.stopPropagation();
                const menu = (event.currentTarget as HTMLElement).closest("wt-row-actions")!;
                this.focusTarget = menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
                this.deleteTarget = unit;
                this.error = null;
              }}
              >${t("action.delete")}</wt-button
            >
          </wt-row-actions>
        `,
      },
    ];
  }

  override render() {
    const needle = this.search.trim().toLocaleLowerCase();
    const rows =
      needle === ""
        ? this.units
        : this.units.filter((unit) =>
            Object.values(unit.name).some((name) => name.toLocaleLowerCase().includes(needle)),
          );
    const references = this.error?.params?.products ?? [];
    return html`
      <h1>${t("units.title")}</h1>
      <p class="description">${t("units.description")}</p>
      <div class="toolbar">
        <wt-input
          class="search"
          data-test="search"
          name="unit-search"
          label=${t("units.search")}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.search = event.detail.value;
          }}
        ></wt-input>
        <wt-button data-test="create" variant="primary" @click=${this.#openCreate}
          >${t("units.create")}</wt-button
        >
      </div>
      ${
        this.error
          ? html`<div class="error" role="alert">
              ${
                this.error.code === "unit.in_use"
                  ? codeMessage("unit.in_use")
                  : this.editorOpen && this.error.code
                    ? codeMessage(this.error.code)
                    : t("units.load_error")
              }
              ${
                references.length
                  ? html`<ul class="references">
                      ${references.map((name) => html`<li>${localizedName(name)}</li>`)}
                    </ul>`
                  : nothing
              }
            </div>`
          : nothing
      }
      <wt-data-table
        aria-label=${t("units.title")}
        .rows=${rows}
        .columns=${this.#columns()}
        .rowKey=${(unit: Unit) => unit.id}
        .loading=${this.loading}
        emptyMessage=${t("units.empty")}
      ></wt-data-table>
      <dashboard-unit-form
        .open=${this.editorOpen}
        .busy=${this.busy}
        .locales=${this.languages?.languages ?? []}
        .value=${this.editing}
        .fieldErrors=${this.fieldErrors}
        @wt-submit=${(event: CustomEvent<{ value: UnitInput }>) => void this.#save(event)}
        @wt-cancel=${(event: Event) => {
          event.stopPropagation();
          this.#closeEditor();
        }}
      ></dashboard-unit-form>
      <wt-dialog
        .open=${this.deleteTarget !== null}
        heading=${t("units.delete_title")}
        @wt-close=${this.#closeDelete}
      >
        <p>${t("units.delete_body")}</p>
        <wt-form-actions slot="footer">
          <wt-button
            slot="cancel"
            data-test="cancel-delete"
            variant="secondary"
            @click=${this.#closeDelete}
            >${t("action.cancel")}</wt-button
          >
          <wt-button
            data-test="confirm-delete"
            variant="danger"
            ?disabled=${this.busy}
            @click=${() => void this.#delete()}
            >${t("action.delete")}</wt-button
          >
        </wt-form-actions>
      </wt-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-units-screen": UnitsScreen;
  }
}
