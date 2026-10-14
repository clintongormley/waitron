import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { QueryController, codeMessage, codeOf } from "@waitron/dashboard-kit";
import type { DeleteImpact } from "@waitron/shared";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-delete-dialog.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import type { StaffRole, StaffingApi } from "./client.js";
import { staffRoleDeleteCopy } from "./staff-role-delete-copy.js";
import { holderCount, t, tf } from "./strings.js";
import "./staff-role-dialog.js";

type Deletion = {
  staffRoleId: string;
  impact: DeleteImpact | null;
  loading: boolean;
  readError: string;
  actionError: string;
  busy: boolean;
};

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
      /* Baseline-aligned so the name sits on the row's text line; the swatch centres on it. */
      wt-data-table::part(name) {
        display: inline-flex;
        align-items: baseline;
        gap: var(--wt-space-2);
      }
      wt-data-table::part(swatch) {
        align-self: center;
        flex: none;
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
  /** Replaced each time the delete question opens or closes, so a late answer finds it changed. */
  #deletion?: object;

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
  /** Released whenever the delete question closes, so it reports only while one is open. */
  readonly #impactQueries = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      const deletion = this.deleting!;
      if (codeOf(error) === "staff_role.not_found") {
        if (!deletion.busy) this.#staffRoleGone();
        return;
      }
      this.deleting = {
        ...deletion,
        loading: false,
        readError: tf("staffing.role.delete_load_error", { reason: codeMessage(codeOf(error)) }),
      };
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  override disconnectedCallback(): void {
    this.editing = undefined;
    this.#closeDelete();
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

  /** With no live updates nothing else reports a write, so the list is read again. */
  async #afterWrite(): Promise<void> {
    if (this.api.liveData === undefined) await this.#load();
  }

  async #move(staffRole: StaffRole, step: -1 | 1): Promise<void> {
    if (this.busy) return;
    const ids = this.staffRoles!.map((listed) => listed.id);
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
    await this.#afterWrite();
  }

  #openDelete(staffRole: StaffRole): void {
    this.actionError = undefined;
    this.#closeDelete();
    this.#deletion = {};
    this.deleting = {
      staffRoleId: staffRole.id,
      impact: null,
      loading: true,
      readError: "",
      actionError: "",
      busy: false,
    };
    this.#readImpact();
  }

  #closeDelete(): void {
    this.#impactQueries.release("delete-impact");
    this.#deletion = undefined;
    this.deleting = undefined;
  }

  /** The role was deleted elsewhere: the question closes, the page says so and the list is read again. */
  #staffRoleGone(): void {
    this.#closeDelete();
    this.actionError = codeMessage("staff_role.not_found");
    void this.#load();
  }

  #readImpact(): void {
    const deletion = this.deleting!;
    this.deleting = { ...deletion, loading: true, readError: "" };
    this.api
      .watchStaffRoleDeleteImpact(this.#impactQueries, deletion.staffRoleId, (impact) => {
        this.deleting = { ...this.deleting!, impact, loading: false, readError: "" };
      })
      .catch(() => undefined);
  }

  async #delete(staffRoleId: string): Promise<void> {
    const deletion = this.deleting!;
    if (deletion.busy) return;
    const current = this.#deletion;
    this.deleting = { ...deletion, busy: true, actionError: "" };
    try {
      await this.api.deleteStaffRole(staffRoleId);
    } catch (error) {
      if (current !== this.#deletion) return;
      if (codeOf(error) === "staff_role.not_found") {
        this.#staffRoleGone();
        return;
      }
      this.deleting = {
        ...this.deleting,
        busy: false,
        actionError: tf("staffing.role.delete_error", { reason: codeMessage(codeOf(error)) }),
      };
      return;
    }
    if (current !== this.#deletion) return;
    this.#closeDelete();
    await this.#afterWrite();
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
        this.actionError = undefined;
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
      ${item("delete", t("staffing.role.delete"), () => this.#openDelete(staffRole))}
    </wt-row-actions>`;
  }

  #columns(): DataTableColumn<StaffRole>[] {
    const columns: DataTableColumn<StaffRole>[] = [
      {
        key: "name",
        label: t("staffing.role.column.name"),
        cell: (staffRole) =>
          html`<span part="name"
            ><span part=${`swatch swatch-${staffRole.colour}`}></span
            ><span>${staffRole.name}</span></span
          >`,
      },
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

  #deleteDialog() {
    const deletion = this.deleting;
    if (!deletion) return nothing;
    return keyed(
      this.#deletion,
      html`<wt-delete-dialog
        data-test="delete-staff-role"
        .open=${true}
        .impact=${deletion.impact}
        .loading=${deletion.loading}
        .submitting=${deletion.busy}
        .readError=${deletion.readError}
        .actionError=${deletion.actionError}
        .copy=${staffRoleDeleteCopy()}
        @wt-delete-confirm=${(event: CustomEvent<{ id: string }>) => {
          event.stopPropagation();
          void this.#delete(event.detail.id);
        }}
        @wt-delete-retry=${(event: Event) => {
          event.stopPropagation();
          this.#readImpact();
        }}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (!this.deleting?.busy) this.#closeDelete();
        }}
      ></wt-delete-dialog>`,
    );
  }

  override render() {
    const staffRoles = this.staffRoles;
    return html`<div class="heading">
        <h1>${t("staffing.role.title")}</h1>
        ${
          this.readOnly
            ? nothing
            : html`<wt-button
                data-test="new-staff-role"
                ?disabled=${this.busy}
                @click=${() => {
                  this.actionError = undefined;
                  this.editing = null;
                }}
                >${t("staffing.role.new")}</wt-button
              >`
        }
      </div>
      <p class="intro">${t("staffing.role.intro")}</p>
      ${
        staffRoles && this.loadError
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
        .rows=${staffRoles ?? []}
        .columns=${this.#columns()}
        .rowKey=${(staffRole: StaffRole) => staffRole.id}
        .loading=${staffRoles === undefined && this.loadError === undefined}
        .loadingMessage=${t("staffing.role.loading")}
        .errorMessage=${staffRoles === undefined ? (this.loadError ?? "") : ""}
        .emptyMessage=${t("staffing.role.empty")}
      ></wt-data-table>
      ${
        this.readOnly
          ? nothing
          : html`<staff-role-dialog
              .api=${this.api}
              .staffRole=${this.editing ?? undefined}
              .open=${this.editing !== undefined}
              @staff-role-close=${(event: CustomEvent<{ wrote: boolean }>) => {
                this.editing = undefined;
                if (event.detail.wrote) void this.#afterWrite();
              }}
            ></staff-role-dialog>`
      }
      ${this.#deleteDialog()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-staff-roles-screen": StaffRolesScreen;
  }
}
