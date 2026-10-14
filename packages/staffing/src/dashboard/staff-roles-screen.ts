import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { QueryController, codeMessage, codeOf } from "@waitron/dashboard-kit";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import type { StaffRole, StaffingApi } from "./client.js";
import { colourName, holderCount, t, tf, type StringKey } from "./strings.js";
import "./staff-role-dialog.js";

type Deletion = { staffRole: StaffRole; busy: boolean; error?: string };

const count = (one: StringKey, other: StringKey, value: number) =>
  value === 1 ? t(one) : tf(other, { count: String(value) });

/** Lists the venue's staff roles in their order, and adds, edits, moves and deletes them. */
@customElement("dashboard-staff-roles-screen")
export class StaffRolesScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .heading {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }
      h1 {
        margin: 0;
      }
      .intro {
        color: var(--wt-color-text-muted);
      }
      .alert {
        color: var(--wt-color-danger);
      }
      /* Cell markup lives in the table's shadow root, so only a part reaches it. */
      wt-data-table::part(colour) {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
      }
      wt-data-table::part(swatch) {
        inline-size: var(--wt-space-4);
        block-size: var(--wt-space-4);
        border-radius: var(--wt-radius-sm);
      }
      wt-data-table::part(swatch-red) {
        background: var(--wt-color-palette-red);
      }
      wt-data-table::part(swatch-amber) {
        background: var(--wt-color-palette-amber);
      }
      wt-data-table::part(swatch-grey) {
        background: var(--wt-color-palette-grey);
      }
      wt-data-table::part(swatch-blue) {
        background: var(--wt-color-palette-blue);
      }
      wt-data-table::part(swatch-green) {
        background: var(--wt-color-palette-green);
      }
      wt-data-table::part(swatch-purple) {
        background: var(--wt-color-palette-purple);
      }
    `,
  ];

  @property({ attribute: false }) api!: StaffingApi;
  @property({ type: Boolean }) readOnly = false;
  @state() private staffRoles?: StaffRole[];
  @state() private loadError?: string;
  /** A refused move; kept apart from `loadError`, so a read's recovery does not clear it. */
  @state() private actionError?: string;
  @state() private busy = false;
  /** The dialog's subject while it is open: `null` for a new staff role. */
  @state() private editing?: StaffRole | null;
  @state() private deleting?: Deletion;

  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      this.loadError = tf("staffing.role.load_error", { reason: codeMessage(codeOf(error)) });
    },
    () => {
      this.loadError = undefined;
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  override disconnectedCallback(): void {
    this.editing = undefined;
    this.deleting = undefined;
    this.busy = false;
    super.disconnectedCallback();
  }

  async #load(): Promise<void> {
    try {
      await this.api.watchStaffRoles(this.#queries, (staffRoles) => {
        this.staffRoles = [...staffRoles].sort((a, b) => a.position - b.position);
        this.loadError = undefined;
      });
    } catch {
      // The controller's error callback has already said why.
    }
  }

  async #move(staffRole: StaffRole, step: -1 | 1): Promise<void> {
    if (this.busy) return;
    const ids = this.staffRoles!.map((role) => role.id);
    const from = ids.indexOf(staffRole.id);
    [ids[from], ids[from + step]] = [ids[from + step]!, ids[from]!];
    this.busy = true;
    this.actionError = undefined;
    try {
      await this.api.reorder(ids);
    } catch (error) {
      this.actionError = tf("staffing.role.move_error", { reason: codeMessage(codeOf(error)) });
    } finally {
      this.busy = false;
    }
    // Also after a refusal: the route refuses a stale order whole, so a retry needs the current one.
    await this.#load();
  }

  async #delete(deletion: Deletion): Promise<void> {
    if (this.deleting !== deletion || deletion.busy) return;
    this.deleting = { ...deletion, busy: true, error: undefined };
    const current = this.deleting;
    try {
      await this.api.deleteStaffRole(deletion.staffRole.id);
    } catch (error) {
      if (this.deleting === current)
        this.deleting = {
          ...current,
          busy: false,
          error: tf("staffing.role.delete_error", { reason: codeMessage(codeOf(error)) }),
        };
      return;
    }
    if (this.deleting !== current) return;
    this.deleting = { ...current, busy: false };
    await this.updateComplete;
    this.renderRoot.querySelector("wt-modal")?.closeAfter("saved");
    await this.#load();
  }

  #rowMenu(staffRole: StaffRole, index: number) {
    const last = this.staffRoles!.length - 1;
    const item = (test: string, label: string, run: () => void) =>
      html`<wt-button
        variant="ghost"
        align="start"
        data-test=${`${test}-${staffRole.id}`}
        ?disabled=${this.busy}
        @click=${run}
        >${label}</wt-button
      >`;
    return html`<wt-row-actions label=${tf("staffing.role.actions", { name: staffRole.name })}>
      ${item("edit", t("staffing.role.edit"), () => {
        this.editing = staffRole;
      })}
      ${
        index > 0
          ? item("move-up", t("staffing.role.move_up"), () => void this.#move(staffRole, -1))
          : nothing
      }
      ${
        index < last
          ? item("move-down", t("staffing.role.move_down"), () => void this.#move(staffRole, 1))
          : nothing
      }
      ${item("delete", t("staffing.role.delete"), () => {
        this.deleting = { staffRole, busy: false };
      })}
    </wt-row-actions>`;
  }

  #columns(): DataTableColumn<StaffRole>[] {
    const columns: DataTableColumn<StaffRole>[] = [
      {
        key: "colour",
        label: t("staffing.role.column.colour"),
        cell: (staffRole) =>
          html`<span part="colour"
            ><span part=${`swatch swatch-${staffRole.colour}`}></span>${colourName(
              staffRole.colour,
            )}</span
          >`,
      },
      { key: "name", label: t("staffing.role.column.name"), cell: (staffRole) => staffRole.name },
      {
        key: "people",
        label: t("staffing.role.column.people"),
        cell: (staffRole) => holderCount(staffRole.holderIds.length),
      },
    ];
    if (this.readOnly) return columns;
    return [
      ...columns,
      {
        key: "actions",
        label: t("staffing.role.column.actions"),
        pinned: "end",
        cell: (staffRole) => this.#rowMenu(staffRole, this.staffRoles!.indexOf(staffRole)),
      },
    ];
  }

  #deleteModal() {
    const deletion = this.deleting;
    if (!deletion) return nothing;
    const { staffRole } = deletion;
    return html`<wt-modal
      open
      size="compact"
      data-test="delete-staff-role"
      heading=${t("staffing.role.delete_heading")}
      .dismissible=${!deletion.busy}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.deleting = undefined;
      }}
    >
      <p>${tf("staffing.role.delete_question", { name: staffRole.name })}</p>
      ${
        staffRole.shiftCount > 0
          ? html`<p>
              ${count(
                "staffing.role.delete_shifts_one",
                "staffing.role.delete_shifts_other",
                staffRole.shiftCount,
              )}
            </p>`
          : nothing
      }
      ${
        staffRole.blockCount > 0
          ? html`<p>
              ${count(
                "staffing.role.delete_blocks_one",
                "staffing.role.delete_blocks_other",
                staffRole.blockCount,
              )}
            </p>`
          : nothing
      }
      <wt-form-actions slot="footer" .error=${deletion.error ?? ""}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="cancel-delete"
          ?disabled=${deletion.busy}
          @click=${() => void this.renderRoot.querySelector("wt-modal")!.requestClose("cancel")}
          >${t("staffing.role.cancel")}</wt-button
        >
        <wt-button
          variant="danger"
          data-test="confirm-delete"
          ?loading=${deletion.busy}
          @click=${() => void this.#delete(deletion)}
          >${t("staffing.role.delete")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  override render() {
    const roles = this.staffRoles;
    return html`<div class="heading">
        <h1>${t("staffing.role.title")}</h1>
        ${
          this.readOnly
            ? nothing
            : html`<wt-button
                data-test="new-staff-role"
                ?disabled=${this.busy}
                @click=${() => {
                  this.editing = null;
                }}
                >${t("staffing.role.new")}</wt-button
              >`
        }
      </div>
      <p class="intro">${t("staffing.role.intro")}</p>
      ${
        roles && this.loadError
          ? html`<p class="alert" role="alert" data-test="load-alert">${this.loadError}</p>`
          : nothing
      }
      ${
        this.actionError
          ? html`<p class="alert" role="alert" data-test="action-alert">${this.actionError}</p>`
          : nothing
      }
      <wt-data-table
        data-test="staff-roles"
        aria-label=${t("staffing.role.title")}
        .rows=${roles ?? []}
        .columns=${this.#columns()}
        .rowKey=${(staffRole: StaffRole) => staffRole.id}
        .loading=${roles === undefined && this.loadError === undefined}
        .loadingMessage=${t("staffing.role.loading")}
        .errorMessage=${roles === undefined ? (this.loadError ?? "") : ""}
        .emptyMessage=${t("staffing.role.empty")}
      ></wt-data-table>
      ${
        this.readOnly
          ? nothing
          : html`<staff-role-dialog
              .api=${this.api}
              .staffRole=${this.editing ?? undefined}
              .open=${this.editing !== undefined}
              @staff-role-close=${() => {
                this.editing = undefined;
                void this.#load();
              }}
            ></staff-role-dialog>`
      }
      ${this.#deleteModal()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-staff-roles-screen": StaffRolesScreen;
  }
}
