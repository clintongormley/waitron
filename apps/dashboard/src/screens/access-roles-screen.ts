import {
  baseStyles,
  pageTitleStyles,
  draftScopeFor,
  saveActionState,
  submitOnEnter,
  focusFirstInvalid,
} from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import type { DataTableColumn } from "@waitron/ui/src/components/wt-data-table.js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { AccessRole, DashboardApi } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { codeMessage } from "../i18n/codes.js";
import { accessRoleName } from "../i18n/domain.js";
import { PERMISSION_TEXT, type PermissionArea } from "../i18n/permissions.js";
import { fill, t } from "../i18n/t.js";

type Draft = { name: string; permissions: string[] };
const same = (a: Draft, b: Draft) =>
  a.name === b.name && a.permissions.join("\n") === b.permissions.join("\n");
const areas: PermissionArea[] = ["sales", "reports", "people", "venue"];

@customElement("dashboard-access-roles-screen")
export class AccessRolesScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .heading,
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }
      .toolbar {
        justify-content: start;
        margin-block: var(--wt-space-4);
      }
      h1 {
        margin: var(--wt-space-4) 0;
        overflow-wrap: anywhere;
      }
      h2 {
        font-size: var(--wt-font-size-lg);
        margin: 0 0 var(--wt-space-3);
      }
      .editor {
        max-width: var(--wt-form-max-width);
      }
      section {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        padding: var(--wt-space-4);
        margin-block: var(--wt-space-4);
      }
      wt-switch {
        display: block;
        margin-block: var(--wt-space-2);
        overflow-wrap: anywhere;
      }
      .error {
        color: var(--wt-color-danger);
      }
      .note {
        color: var(--wt-color-text-muted);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) viewerPermissions: readonly string[] = [];
  @state() private roles: AccessRole[] = [];
  @state() private loaded = false;
  @state() private loadError = false;
  @state() private editing: AccessRole | "new" | null = null;
  @state() private name = "";
  @state() private permissions: string[] = [];
  @state() private busy = false;
  @state() private attempted = false;
  @state() private nameRefusal = "";
  @state() private error = "";
  @state() private confirmation: "copy" | "delete" | null = null;
  @state() private copyName = "";
  @state() private copyError = "";
  @state() private copyAttempted = false;
  @state() private copyNameRefusal = "";
  readonly #copyOwner = {};
  #confirmationFromList = false;
  #scope?: DraftScope<Draft>;
  #copyScope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.loadError = true;
    },
    () => {
      this.loadError = false;
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }
  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#copyScope?.dispose();
    this.editing = null;
    this.confirmation = null;
    super.disconnectedCallback();
  }
  async #load(): Promise<void> {
    try {
      await this.#queries.watch("listAccessRoles", [], (roles) => {
        this.roles = roles;
        this.loaded = true;
        this.loadError = false;
      });
    } catch {
      this.loadError = true;
    }
  }
  #draft(): Draft {
    return { name: this.name.trim(), permissions: [...this.permissions].sort() };
  }
  #role(): AccessRole | null {
    return typeof this.editing === "object" ? this.editing : null;
  }
  #canChange(role: AccessRole): boolean {
    return role.permissions.every((permission) => this.viewerPermissions.includes(permission));
  }
  async #reloadEditor(): Promise<void> {
    const role = this.#role();
    if (!role || this.busy) return;
    const proceed = async () => {
      this.busy = true;
      try {
        await this.#load();
        const current = this.roles.find((item) => item.id === role.id);
        if (!this.loadError && current) this.#open(current);
      } finally {
        this.busy = false;
      }
    };
    if (this.#leave) await this.#leave.request({ scopes: [this], reason: "navigation", proceed });
    else await proceed();
  }
  #open(role: AccessRole | "new"): void {
    this.editing = role === "new" ? "new" : structuredClone(role);
    this.name = role === "new" ? "" : (role.name ?? "");
    this.permissions = role === "new" ? [] : [...role.permissions];
    this.error = this.nameRefusal = "";
    this.attempted = false;
    this.#scope?.dispose();
    const draft = draftScopeFor<Draft>(this, {
      id: this,
      current: () => this.#draft(),
      snapshot: (value) => structuredClone(value),
      equal: same,
      restore: (value) => {
        this.name = value.name;
        this.permissions = [...value.permissions];
      },
    });
    this.#scope = draft.scope;
    this.#leave = draft.coordinator;
  }
  async #close(reason: LeaveReason = "navigation"): Promise<void> {
    if (this.busy) return;
    const proceed = () => {
      this.editing = null;
      this.#scope?.dispose();
      this.#scope = undefined;
    };
    if (this.#leave) await this.#leave.request({ scopes: [this], reason, proceed });
    else proceed();
  }
  #changeName(value: string): void {
    this.name = value;
    this.nameRefusal = "";
    this.#scope?.changed();
  }
  #toggle(permission: string, checked: boolean): void {
    if (
      !this.viewerPermissions.includes(permission) ||
      (this.#role() !== null && !this.#canChange(this.#role()!)) ||
      this.#role()?.builtInKey === "admin" ||
      this.busy
    )
      return;
    this.permissions = checked
      ? [...new Set([...this.permissions, permission])]
      : this.permissions.filter((p) => p !== permission);
    this.#scope?.changed();
  }
  #failure(error: unknown): string {
    return codeMessage((error as { code?: string })?.code ?? "management.failed");
  }
  #isNameFailure(error: unknown): boolean {
    return ["role.name_taken", "role.name_required"].includes(
      (error as { code?: string })?.code ?? "",
    );
  }
  async #save(): Promise<void> {
    if (this.busy || !this.#scope?.isDirty()) return;
    this.attempted = true;
    this.error = this.nameRefusal = "";
    const submitted = this.#draft();
    const role = this.#role();
    if ((!role || !role.builtInKey) && !submitted.name) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!.querySelector("form")!);
      return;
    }
    this.busy = true;
    try {
      if (!role) await this.api.createAccessRole(submitted);
      else {
        if (!role.builtInKey && submitted.name !== role.name) {
          await this.api.renameAccessRole(role.id, submitted.name, role.name!);
          role.name = submitted.name;
          this.#scope.commit({ name: submitted.name, permissions: [...role.permissions].sort() });
        }
        if (submitted.permissions.join("\n") !== [...role.permissions].sort().join("\n"))
          await this.api.setAccessRolePermissions(role.id, submitted.permissions, role.permissions);
      }
      this.#scope.commit(submitted);
      this.#scope.dispose();
      this.#scope = undefined;
      this.editing = null;
    } catch (error) {
      if (this.#isNameFailure(error)) this.nameRefusal = this.#failure(error);
      else this.error = this.#failure(error);
      return;
    } finally {
      this.busy = false;
    }
    await this.#load();
  }
  #ask(kind: "copy" | "delete", fromList = false): void {
    this.#confirmationFromList = fromList;
    this.confirmation = kind;
    this.copyName = this.copyError = this.copyNameRefusal = "";
    this.copyAttempted = false;
    if (kind === "copy") {
      this.#copyScope = draftScopeFor<Draft>(this, {
        id: this.#copyOwner,
        parent: this,
        current: () => ({ name: this.copyName.trim(), permissions: [] }),
        snapshot: (value) => ({ ...value }),
        equal: same,
        restore: (value) => {
          this.copyName = value.name;
        },
      }).scope;
    }
  }
  readonly #beforeConfirmationClose = async (reason: LeaveReason): Promise<boolean> => {
    if (!this.#copyScope || !this.#leave) return true;
    return (
      (await this.#leave.request({ scopes: [this.#copyOwner], reason, proceed() {} })) ===
      "proceeded"
    );
  };
  #clearConfirmation(): void {
    if (this.#confirmationFromList) {
      this.editing = null;
      this.#scope?.dispose();
      this.#scope = undefined;
    }
    this.#confirmationFromList = false;
    this.confirmation = null;
    this.#copyScope?.dispose();
    this.#copyScope = undefined;
  }
  async #confirm(): Promise<void> {
    if (this.busy) return;
    const role = this.#role();
    if (!role) return;
    this.copyAttempted = true;
    this.copyError = this.copyNameRefusal = "";
    if (this.confirmation === "copy" && !this.copyName.trim()) return;
    this.busy = true;
    try {
      if (this.confirmation === "copy") {
        await this.api.createAccessRole({
          name: this.copyName.trim(),
          permissions: role.permissions,
          copiedFrom: role.id,
        });
        this.#copyScope?.commit({ name: this.copyName.trim(), permissions: [] });
      } else {
        await this.api.deleteAccessRole(role.id);
        this.#scope?.dispose();
        this.#scope = undefined;
        this.editing = null;
      }
      const dialog = this.shadowRoot!.querySelector("wt-dialog")!;
      dialog.closeAfter("saved");
      this.#clearConfirmation();
    } catch (error) {
      if (this.confirmation === "copy" && this.#isNameFailure(error))
        this.copyNameRefusal = this.#failure(error);
      else this.copyError = this.#failure(error);
      return;
    } finally {
      this.busy = false;
    }
    await this.#load();
  }
  #columns(): DataTableColumn<AccessRole>[] {
    return [
      {
        key: "name",
        label: t("access_roles.name"),
        cell: (role) => accessRoleName(role),
        sortValue: (role) => accessRoleName(role),
      },
      {
        key: "people",
        choosable: "shown",
        label: t("access_roles.people"),
        cell: (role) => String(role.holderCount),
        sortValue: (role) => role.holderCount,
      },
      {
        key: "actions",
        label: t("access_roles.actions"),
        pinned: "end",
        cell: (role) =>
          html` <wt-row-actions label=${`${t("access_roles.actions")}: ${accessRoleName(role)}`}>
            <wt-button variant="secondary" @click=${() => this.#open(role)}
              >${t("action.edit")}</wt-button
            >
            <wt-button
              variant="secondary"
              ?disabled=${!this.#canChange(role)}
              @click=${() => {
                this.#open(role);
                this.#ask("copy", true);
              }}
              >${t("access_roles.copy")}</wt-button
            >
            ${
              !role.builtInKey
                ? html`<wt-button
                    variant="danger"
                    ?disabled=${!this.#canChange(role)}
                    @click=${() => {
                      this.#open(role);
                      this.#ask("delete", true);
                    }}
                    >${t("action.delete")}</wt-button
                  >`
                : nothing
            }
          </wt-row-actions>`,
      },
    ];
  }
  #renderEditor() {
    const role = this.#role();
    const admin = role?.builtInKey === "admin";
    const save = saveActionState(this.#scope);
    const nameError =
      this.nameRefusal ||
      (this.attempted && !this.name.trim() ? t("access_roles.name_required") : "");
    const permissions = this.roles.find((r) => r.builtInKey === "admin")!.permissions;
    const canChange = !role || this.#canChange(role);
    return html`<div class="editor" data-test="editor">
      <div class="toolbar">
        <wt-button
          variant="secondary"
          data-test="back"
          ?disabled=${this.busy}
          @click=${() => void this.#close()}
          >${t("action.back")}</wt-button
        >
        ${role ? html`<wt-button data-test="reload" variant="secondary" ?disabled=${this.busy} @click=${() => void this.#reloadEditor()}>${t("access_roles.reload")}</wt-button>` : nothing}
        ${
          role
            ? html`<wt-button
                  variant="secondary"
                  data-test="copy"
                  ?disabled=${this.busy || !canChange || this.#scope?.isDirty()}
                  @click=${() => this.#ask("copy")}
                  >${t("access_roles.copy")}</wt-button
                >
                ${!role.builtInKey ? html`<wt-button variant="danger" data-test="delete" ?disabled=${this.busy || !canChange || this.#scope?.isDirty()} @click=${() => this.#ask("delete")}>${t("access_roles.delete")}</wt-button>` : nothing}`
            : nothing
        }
      </div>
      <h1>${role ? accessRoleName(role) : t("access_roles.add")}</h1>
      <form
        @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=save]"))}
        @submit=${(e: Event) => {
          e.preventDefault();
          void this.#save();
        }}
      >
        ${!role?.builtInKey ? html`<wt-input data-test="role-name" name="roleName" label=${t("access_roles.name")} required .value=${this.name} .error=${nameError} ?disabled=${this.busy || !canChange} @wt-change=${(e: CustomEvent<{ value: string }>) => this.#changeName(e.detail.value)}></wt-input>` : nothing}
        ${admin ? html`<p>${t("access_roles.admin_fixed")}</p>` : !canChange ? html`<p class="note">${t("access_roles.limited")}</p>` : nothing}
        ${areas.map(
          (area) =>
            html`<section
              aria-label=${t(area === "people" ? "access_roles.people_area" : `access_roles.${area}`)}
            >
              <h2>${t(area === "people" ? "access_roles.people_area" : `access_roles.${area}`)}</h2>
              ${permissions
                .filter((p) => (PERMISSION_TEXT[p]?.area ?? "venue") === area)
                .map(
                  (p) =>
                    html` <wt-switch
                      data-test=${`permission-${p}`}
                      name=${p}
                      label=${PERMISSION_TEXT[p] ? t(PERMISSION_TEXT[p].label) : p}
                      .checked=${this.permissions.includes(p)}
                      ?disabled=${admin || this.busy || !canChange || !this.viewerPermissions.includes(p)}
                      @wt-change=${(e: CustomEvent<{ checked: boolean }>) => this.#toggle(p, e.detail.checked)}
                    ></wt-switch>`,
                )}
            </section>`,
        )}
        ${
          !admin
            ? html`<wt-form-actions
                data-test="form-actions"
                error=${[this.error, nameError ? t("access_roles.fix_fields") : ""].filter(Boolean).join(" ")}
              >
                <wt-button
                  slot="cancel"
                  variant="secondary"
                  ?disabled=${this.busy}
                  @click=${() => void this.#close("cancel")}
                  >${t("action.cancel")}</wt-button
                >
                <wt-button
                  data-test="save"
                  variant=${save.variant}
                  ?disabled=${save.unchanged || this.busy || !canChange || (this.attempted && !role?.builtInKey && !this.name.trim())}
                  @click=${() => void this.#save()}
                  >${t("action.save")}</wt-button
                >
              </wt-form-actions>`
            : nothing
        }
      </form>
    </div>`;
  }
  #renderConfirmation() {
    if (!this.confirmation) return nothing;
    const role = this.#role()!;
    const copy = this.confirmation === "copy";
    const fieldError =
      this.copyNameRefusal ||
      (this.copyAttempted && !this.copyName.trim() ? t("access_roles.name_required") : "");
    const save = saveActionState(this.#copyScope);
    return html`<wt-dialog
      .open=${true}
      heading=${t(copy ? "access_roles.copy" : "access_roles.delete")}
      .dismissible=${!this.busy}
      .beforeClose=${copy ? this.#beforeConfirmationClose : undefined}
      @wt-close=${(e: Event) => {
        if (e.target === e.currentTarget) this.#clearConfirmation();
      }}
    >
      ${
        copy
          ? html`<wt-input
              data-test="copy-name"
              @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=copy-confirm]"))}
              name="newRoleName"
              required
              label=${t("access_roles.copy_name")}
              .value=${this.copyName}
              .error=${fieldError}
              ?disabled=${this.busy}
              @wt-change=${(e: CustomEvent<{ value: string }>) => {
                this.copyName = e.detail.value;
                this.copyNameRefusal = "";
                this.#copyScope?.changed();
              }}
            ></wt-input>`
          : html`<p data-test="delete-message">
              ${fill(role.holderCount === 1 ? "access_roles.delete_message_one" : "access_roles.delete_message", { count: String(role.holderCount), role: accessRoleName(role) })}
            </p>`
      }
      <wt-form-actions
        slot="footer"
        error=${[this.copyError, fieldError && copy ? t("access_roles.fix_fields") : ""].filter(Boolean).join(" ")}
      >
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => void this.shadowRoot!.querySelector("wt-dialog")!.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test=${copy ? "copy-confirm" : "delete-confirm"}
          variant=${copy ? save.variant : "danger"}
          ?disabled=${this.busy || (copy && (save.unchanged || (this.copyAttempted && !this.copyName.trim())))}
          @click=${() => void this.#confirm()}
          >${t(copy ? "action.save" : "action.delete")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
  override render() {
    return html` ${this.loadError ? html`<p class="error" role="alert" data-test="load-error">${t("access_roles.load_error")}</p>` : nothing}
    ${
      this.editing
        ? this.#renderEditor()
        : html` <div class="heading">
              <h1>${t("access_roles.title")}</h1>
              <div class="toolbar">
                <wt-button variant="secondary" @click=${() => void this.#load()}
                  >${t("access_roles.refresh")}</wt-button
                >
                <wt-button
                  data-test="create"
                  variant="primary"
                  ?disabled=${!this.loaded}
                  @click=${() => this.#open("new")}
                  >${t("access_roles.add")}</wt-button
                >
              </div>
            </div>
            <wt-data-table
              viewKey="waitron.access-roles.table"
              customiseColumnsLabel=${t("table.customise_columns")}
              customiseLabel=${t("table.customise")}
              restoreColumnsLabel=${t("table.restore_columns")}
              doneLabel=${t("table.done")}
              moveColumnLabel=${t("table.move_column")}
              showColumnLabel=${t("table.show_column")}
              hideColumnLabel=${t("table.hide_column")}
              alwaysShownColumnLabel=${t("table.column_always_shown")}
              lastShownColumnLabel=${t("table.column_last_shown")}
              columnPositionLabel=${t("table.column_position")}
              aria-label=${t("access_roles.title")}
              .rows=${this.roles}
              .columns=${this.#columns()}
              .rowKey=${(role: AccessRole) => role.id}
              .rowClick=${(role: AccessRole) => this.#open(role)}
              .rowClickLabel=${(role: AccessRole) => `${t("action.edit")}: ${accessRoleName(role)}`}
              .loading=${!this.loaded && !this.loadError}
              emptyMessage=${t("access_roles.empty")}
            ></wt-data-table>`
    }
    ${this.#renderConfirmation()}`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-access-roles-screen": AccessRolesScreen;
  }
}
