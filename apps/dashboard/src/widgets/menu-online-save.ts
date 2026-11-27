import {
  CUSTOMER_MENU_PHOTO_SIZES,
  isCustomerMenuAddress,
  type CustomerMenuOnlineSettings,
  type CustomerMenuPhotoSize,
} from "@waitron/shared";
import {
  draftScopeFor,
  FormFeedback,
  leaveCoordinatorFor,
  saveActionState,
  type DraftScope,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-switch.js";
import { css, html, nothing, type LitElement, type ReactiveController } from "lit";
import type { DashboardApi } from "../api/client.js";
import { codeMessage, codeOf, fieldOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

export const menuOnlineStyles = css`
  .online-editor {
    container: online-editor / inline-size;
  }
  .online-settings {
    display: grid;
    align-content: start;
    gap: var(--wt-space-3);
    padding-block: var(--wt-space-4);
    min-inline-size: 0;
  }
  .online-settings p {
    margin: 0;
  }
  .online-settings-status {
    display: grid;
    gap: var(--wt-space-2);
  }
  wt-segmented-control[name="customer-menu-photos"]::part(button) {
    padding-inline: var(--wt-space-2);
  }
  .online-workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--wt-space-4);
  }
  .online-view {
    padding-block-start: var(--wt-space-3);
  }
  @container online-editor (inline-size <= 760px) {
    .online-workspace {
      gap: 0;
    }
    .online-workspace[data-view="preview"] .online-settings {
      padding-block-end: 0;
    }
    .online-workspace[data-view="settings"] dashboard-menu-online-preview,
    .online-workspace[data-view="preview"]
      .online-settings
      > :not(.online-availability, .online-settings-status),
    .online-workspace[data-view="preview"] + wt-form-actions {
      display: none;
    }
  }
  @container online-editor (inline-size > 760px) {
    .online-workspace {
      grid-template-columns: minmax(248px, 1fr) minmax(0, 3fr);
    }
    .online-view,
    .online-settings .unpublished-link {
      display: none;
    }
  }
`;

type OnlineView = "settings" | "preview";

export class MenuOnlineSave implements ReactiveController {
  #menuId: string | null = null;
  #generation = 0;
  #saved: CustomerMenuOnlineSettings | null = null;
  #scope?: DraftScope<boolean>;
  #refusal: unknown;
  #loadFailed = false;
  #feedback: FormFeedback;
  pendingWrite?: Promise<void>;
  draft: CustomerMenuOnlineSettings | null = null;
  view: OnlineView = "preview";

  constructor(
    private readonly host: LitElement,
    private readonly api: () => DashboardApi,
  ) {
    this.#feedback = new FormFeedback(host);
    host.addController(this);
  }

  hostConnected(): void {
    this.#scope = draftScopeFor(this.host, {
      id: this,
      current: () => this.#dirty,
      snapshot: (dirty) => dirty,
      equal: (a, b) => a === b,
      restore: () => this.#restore(),
    }).scope;
    this.#scope.commit(false);
  }

  hostDisconnected(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.show(null);
  }

  get #dirty(): boolean {
    const { draft } = this;
    const saved = this.#saved;
    return (
      draft !== null &&
      saved !== null &&
      (draft.enabled !== saved.enabled ||
        draft.address !== saved.address ||
        draft.photos !== saved.photos)
    );
  }

  get #addressInvalid(): boolean {
    const { draft } = this;
    return (
      draft !== null &&
      (draft.address === null ? draft.enabled : !isCustomerMenuAddress(draft.address))
    );
  }

  get loading(): boolean {
    return this.draft === null && !this.#loadFailed;
  }

  #changed(): void {
    this.#scope?.changed();
    this.host.requestUpdate();
  }

  #restore(): void {
    this.draft = this.#saved;
    this.#refusal = undefined;
    this.#feedback.reset();
    this.#changed();
  }

  show(menuId: string | null): void {
    if (menuId === this.#menuId) return;
    this.#menuId = menuId;
    this.#generation++;
    this.pendingWrite = undefined;
    this.#saved = null;
    this.#loadFailed = false;
    this.view = "preview";
    this.#restore();
    if (menuId !== null) void this.#load(menuId);
  }

  async #load(menuId: string): Promise<void> {
    const generation = this.#generation;
    this.#loadFailed = false;
    this.host.requestUpdate();
    try {
      const api = this.api();
      const value = await (api.background ?? api).getCustomerOnlineSettings(menuId);
      if (generation !== this.#generation) return;
      this.#saved = value;
      this.#restore();
    } catch {
      if (generation !== this.#generation) return;
      this.#loadFailed = true;
      this.host.requestUpdate();
    }
  }

  #edit(change: Partial<CustomerMenuOnlineSettings>): void {
    if (!this.draft || this.pendingWrite) return;
    this.draft = { ...this.draft, ...change };
    if ("address" in change || "enabled" in change) this.#feedback.dismiss("address");
    this.#feedback.dismiss("_form");
    this.#changed();
  }

  async #save(): Promise<void> {
    const menuId = this.#menuId;
    const { draft } = this;
    if (!menuId || !draft || saveActionState(this.#scope).unchanged || this.pendingWrite) return;
    this.#feedback.press("address", "_form");
    if (this.#addressInvalid) {
      this.view = "settings";
      await this.#focusAddress();
      return;
    }
    const generation = this.#generation;
    const write = this.api().saveCustomerOnlineSettings(menuId, draft);
    this.pendingWrite = write.then(
      () => undefined,
      () => undefined,
    );
    this.host.requestUpdate();
    try {
      const saved = await write;
      if (generation !== this.#generation) return;
      this.#saved = saved;
      this.#restore();
      this.#scope?.commit(false);
    } catch (error) {
      if (generation !== this.#generation) return;
      this.#refusal = error;
      this.#feedback.newRefusal();
      if (fieldOf(error) === "address" || codeOf(error) === "customer_menu.not_published")
        this.view = "settings";
    } finally {
      if (generation === this.#generation) {
        this.pendingWrite = undefined;
        this.#changed();
      }
    }
    if (generation === this.#generation && this.#refusal && fieldOf(this.#refusal) === "address")
      await this.#focusAddress();
  }

  async #focusAddress(): Promise<void> {
    this.host.requestUpdate();
    const settings = this.host.renderRoot.querySelector(".online-settings");
    if (settings) await this.#feedback.focus(settings);
  }

  #cancel(): void {
    const leave = leaveCoordinatorFor(this.host);
    if (leave) void leave.request({ scopes: [this], reason: "navigation", proceed() {} });
    else this.#restore();
  }

  #addressError(): string {
    if (this.#addressInvalid && this.#feedback.attempted)
      return this.draft?.address === null
        ? t("customer_menu.address_required")
        : codeMessage("customer_menu.address_invalid");
    return this.#refusal && fieldOf(this.#refusal) === "address" && this.#feedback.shows("address")
      ? codeMessage(codeOf(this.#refusal))
      : "";
  }

  viewControl() {
    return html`<wt-segmented-control
      class="online-view"
      name="customer-menu-view"
      label=${t("customer_menu.online_view")}
      hide-label
      .options=${[
        { value: "settings", label: t("customer_menu.settings") },
        { value: "preview", label: t("menus.tab_preview") },
      ]}
      .value=${this.view}
      @wt-change=${(event: CustomEvent<{ value: OnlineView }>) => {
        event.stopPropagation();
        this.view = event.detail.value;
        this.host.requestUpdate();
      }}
    ></wt-segmented-control>`;
  }

  settings(unpublished: boolean, previewHref: string, openPreview: (event: MouseEvent) => void) {
    const { draft } = this;
    const saving = this.pendingWrite !== undefined;
    return html`<div class="online-settings">
      ${
        draft
          ? html`<wt-switch
              name="customer-menu-enabled"
              label=${t("customer_menu.online")}
              .checked=${draft.enabled}
              .disabled=${saving}
              @wt-change=${(event: CustomEvent<{ checked: boolean }>) =>
                this.#edit({ enabled: event.detail.checked })}
            ></wt-switch>`
          : nothing
      }
      <p class="online-availability">${t("customer_menu.not_public")}</p>
      ${
        draft
          ? html`<wt-input
                name="customer-menu-address"
                label=${t("customer_menu.address")}
                placeholder="lunch"
                autocorrect="off"
                spellcheck="false"
                autocapitalize="none"
                autocomplete="off"
                .value=${draft.address ?? ""}
                .required=${draft.enabled}
                .disabled=${saving}
                .error=${this.#addressError()}
                @wt-change=${(event: CustomEvent<{ value: string }>) =>
                  this.#edit({ address: event.detail.value || null })}
              ></wt-input>
              ${
                unpublished ||
                (this.#refusal && codeOf(this.#refusal) === "customer_menu.not_published")
                  ? html`<a
                      class=${unpublished ? "unpublished-link" : ""}
                      href=${previewHref}
                      @click=${openPreview}
                      >${t("customer_menu.go_to_preview")}</a
                    >`
                  : nothing
              }
              <wt-segmented-control
                name="customer-menu-photos"
                label=${t("customer_menu.photos")}
                .options=${CUSTOMER_MENU_PHOTO_SIZES.map((value) => ({
                  value,
                  label: t(`customer_menu.photos_${value}`),
                }))}
                .value=${draft.photos}
                .disabled=${saving}
                @wt-change=${(event: CustomEvent<{ value: CustomerMenuPhotoSize }>) =>
                  this.#edit({ photos: event.detail.value })}
              ></wt-segmented-control>`
          : html`<div class="online-settings-status">
              ${
                this.#loadFailed
                  ? html`<p role="alert">${t("customer_menu.settings_load_error")}</p>
                      <wt-button
                        variant="secondary"
                        @click=${() => {
                          if (this.#menuId) void this.#load(this.#menuId);
                        }}
                      >
                        ${t("menus.retry")}
                      </wt-button>`
                  : html`<p role="status">${t("customer_menu.settings_loading")}</p>`
              }
            </div>`
      }
    </div>`;
  }

  actions(blocked: boolean) {
    const action = saveActionState(this.#scope);
    const disabled = blocked || this.pendingWrite !== undefined || action.unchanged;
    const address = this.#addressError();
    const form =
      this.#refusal && fieldOf(this.#refusal) !== "address" && this.#feedback.shows("_form")
        ? codeMessage(codeOf(this.#refusal))
        : "";
    const message = this.#feedback.message(
      { address, form },
      new Set(address ? ["address"] : []),
      t("form.fix_fields"),
    );
    return html`<wt-form-actions class="structure-actions" .error=${message}>
      <wt-button
        slot="cancel"
        variant="secondary"
        .disabled=${disabled}
        @click=${() => this.#cancel()}
      >
        ${t("action.cancel")}
      </wt-button>
      <wt-button
        variant=${action.variant}
        .disabled=${disabled || (this.#feedback.attempted && this.#addressInvalid)}
        @click=${() => {
          if (!blocked) void this.#save();
        }}
        >${t("action.save")}</wt-button
      >
    </wt-form-actions>`;
  }
}
