import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { DashboardPermissionContinuation } from "@waitron/dashboard-kit";
import type { MenuArchiveImpact } from "@waitron/shared";
import {
  baseStyles,
  draftScopeFor,
  type DraftScope,
  type LeaveReason,
  leaveCoordinatorFor,
} from "@waitron/ui";
import type { DashboardApi, MenuSummary } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-modal.js";

type Choices = NonNullable<MenuArchiveImpact["defaultChoices"]>;

@customElement("dashboard-menu-archive-dialog")
export class MenuArchiveDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .body {
        display: grid;
        gap: var(--wt-space-3);
        padding-block: var(--wt-space-3);
      }
      p,
      ul {
        margin: 0;
      }
    `,
  ];

  @property({ attribute: false }) menu!: Pick<MenuSummary, "id" | "name">;
  @property({ attribute: false }) api!: Pick<DashboardApi, "getMenuArchiveImpact" | "archiveMenu">;
  @property({ attribute: false }) permissionContinuation?: DashboardPermissionContinuation;
  @state() private impact?: MenuArchiveImpact;
  @state() private draft: Record<string, string> = {};
  @state() private busy = false;
  @state() private problem = "";
  @state() private permission = "";
  private lifetime?: AbortController;
  private scope?: DraftScope<Record<string, string>>;

  override connectedCallback(): void {
    super.connectedCallback();
    this.lifetime = new AbortController();
    const { scope } = draftScopeFor(this, {
      id: this,
      current: () => this.draft,
      snapshot: (value) => ({ ...value }),
      equal: (a, b) =>
        Object.keys(a).length === Object.keys(b).length &&
        Object.entries(a).every(([key, value]) => b[key] === value),
      restore: (value) => {
        this.draft = value;
      },
    });
    this.scope = scope;
    scope.commit({});
    void this.load();
  }

  override disconnectedCallback(): void {
    this.lifetime?.abort();
    this.scope?.dispose();
    super.disconnectedCallback();
  }

  private refuse(error: unknown): void {
    const code = codeOf(error);
    const permission = (error as { params?: { permission?: string } })?.params?.permission;
    this.permission = code === "authorization.not_permitted" ? (permission ?? "") : "";
    this.problem = this.permission ? t("menus.archive_permission") : codeMessage(code);
  }

  private async load(): Promise<void> {
    this.impact = undefined;
    this.problem = "";
    this.permission = "";
    try {
      const impact = await this.api.getMenuArchiveImpact(this.menu.id);
      if (!this.isConnected) return;
      const draft: Record<string, string> = {};
      for (const { id, choices, replacement } of impact.periods) {
        if (replacement !== null && choices.some((choice) => choice.id === this.draft[id]))
          draft[id] = this.draft[id]!;
      }
      if (impact.defaultChoices?.some(({ id }) => id === this.draft.default))
        draft.default = this.draft.default!;
      this.draft = draft;
      this.impact = impact;
    } catch (error) {
      if (this.isConnected) this.refuse(error);
    }
  }

  private get ready(): boolean {
    const impact = this.impact;
    return (
      impact !== undefined &&
      (impact.defaultChoices === null ||
        impact.defaultChoices.some(({ id }) => id === this.draft.default)) &&
      impact.periods.every(
        (period) =>
          period.replacement === null ||
          period.choices.some(({ id }) => id === this.draft[period.id]),
      )
    );
  }

  private readonly beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.busy) return false;
    const leave = leaveCoordinatorFor(this);
    return (
      !leave || (await leave.request({ scopes: [this], reason, proceed() {} })) === "proceeded"
    );
  };

  private async signIn(): Promise<void> {
    const signal = this.lifetime!.signal;
    const result = await this.permissionContinuation?.signIn({
      permission: this.permission,
      signal,
    });
    if (result === "signed-in" && !signal.aborted) void this.load();
  }

  private async archive(): Promise<void> {
    if (!this.ready || this.busy || this.permission) return;
    this.busy = true;
    this.problem = "";
    const { default: defaultMenuId, ...replacements } = this.draft;
    try {
      await this.api.archiveMenu(this.menu.id, {
        replacements,
        ...(defaultMenuId ? { defaultMenuId } : {}),
      });
    } catch (error) {
      if (this.isConnected) this.refuse(error);
      return;
    } finally {
      this.busy = false;
    }
    if (!this.isConnected) return;
    this.scope?.commit(this.draft);
    this.renderRoot.querySelector("wt-modal")!.closeAfter("saved");
    this.dispatchEvent(new CustomEvent("menu-archived", { bubbles: true, composed: true }));
  }

  private choice(key: string, label: string, choices: Choices) {
    return html`<wt-combobox
      name=${key === "default" ? "default-menu" : "period-menu"}
      label=${label}
      search="auto"
      required
      ?disabled=${this.busy}
      .value=${this.draft[key] ?? ""}
      .options=${choices.map(({ id, name }) => ({ value: id, label: name }))}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        if (this.busy) return;
        this.draft = { ...this.draft, [key]: event.detail.value };
        this.scope?.changed();
      }}
    ></wt-combobox>`;
  }

  override render() {
    const impact = this.impact;
    return html`<wt-modal
      open
      size="compact"
      heading=${fill("menus.archive_heading", { name: this.menu.name })}
      .beforeClose=${this.beforeClose}
      .dismissible=${!this.busy}
      @wt-close=${(event: Event) => {
        if (event.target !== event.currentTarget) return;
        event.stopPropagation();
        this.dispatchEvent(
          new CustomEvent("menu-archive-close", { bubbles: true, composed: true }),
        );
      }}
    >
      <div class="body">
        <p data-test="archive-warning">${t("menus.archive_warning")}</p>
        ${!impact && !this.problem ? html`<p role="status">${t("menus.loading")}</p>` : nothing}
        ${impact?.periods.map((period) => {
          const name = `${period.departmentName} · ${period.name}`;
          if (period.replacement === null)
            return html`<p>${fill("menus.archive_remove_staff", { name })}</p>`;
          if (period.choices.length === 0)
            return html`<p>
              ${fill(
                period.requiresSellable
                  ? "menus.archive_period_publish"
                  : "menus.archive_period_blocked",
                { name },
              )}
            </p>`;
          return this.choice(
            period.id,
            fill(period.starting ? "menus.archive_starting" : "menus.archive_staff", { name }),
            period.choices,
          );
        })}
        ${
          impact?.defaultChoices != null
            ? html`
                <p>${t("menus.archive_default_reason")}</p>
                ${
                  impact.defaultChoices.length === 0
                    ? html`<p>${t("menus.archive_default_blocked")}</p>`
                    : this.choice(
                        "default",
                        t("menus.archive_default_choice"),
                        impact.defaultChoices,
                      )
                }
              `
            : nothing
        }
        ${
          impact?.dependants.length
            ? html`<p>${t("menus.archive_dependants")}</p>
                <ul>
                  ${impact.dependants.map(({ name }) => html`<li>${name}</li>`)}
                </ul>`
            : nothing
        }
      </div>
      <wt-form-actions slot="footer" .error=${this.problem}>
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => void this.renderRoot.querySelector("wt-modal")!.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        ${
          this.permission && this.permissionContinuation
            ? html`<wt-button variant="primary" @click=${() => void this.signIn()}
                >${t("permission_sign_in.heading")}</wt-button
              >`
            : !impact && this.problem
              ? html`<wt-button variant="secondary" @click=${() => void this.load()}
                  >${t("menus.retry")}</wt-button
                >`
              : html`<wt-button
                  data-test="archive"
                  variant=${this.ready ? "danger" : "secondary"}
                  ?disabled=${!this.ready || this.busy || !!this.permission}
                  ?loading=${this.busy}
                  @click=${() => void this.archive()}
                  >${t("product.archive")}</wt-button
                >`
        }
      </wt-form-actions>
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-archive-dialog": MenuArchiveDialog;
  }
}
