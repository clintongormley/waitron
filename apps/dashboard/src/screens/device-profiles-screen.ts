import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { submitOnEnter, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-dialog.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
// Reuses the canvas editor's dashboard-local mirror: `@waitron/layouts`' barrel would pull
// `@waitron/db` into the browser bundle. A profile's `capabilities` is an opaque `string[]` on the
// wire, rendered defensively against `CAPABILITY_FLAGS`.
import {
  CAPABILITY_FLAGS,
  FORM_FACTORS,
  type CapabilityFlag,
  type FormFactor,
} from "./canvas-editor/card-contracts.js";
import { toggleMembership } from "../array-utils.js";
import type { Canvas, DeviceMenuHomeLayouts, DeviceProfile, DashboardApi } from "../api/client.js";

/** A menu gets a picker when there is a choice to make, or a saved choice to undo. */
function hasChoice(menu: DeviceMenuHomeLayouts): boolean {
  return menu.layouts.length > 1 || menu.selectedLayoutId !== null;
}

@customElement("dashboard-device-profiles-screen")
export class DeviceProfilesScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .title {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      ol {
        list-style: none;
        margin: var(--wt-space-4) 0 0;
        padding: 0;
        display: grid;
        gap: var(--wt-space-3);
      }
      .empty {
        color: var(--wt-color-text-muted);
      }
      .row {
        display: flex;
        gap: var(--wt-space-3);
        align-items: flex-start;
        flex-wrap: wrap;
      }
      .details {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
        margin-right: auto;
      }
      .label {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .actions {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
        flex-wrap: wrap;
      }
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .panel-subtitle {
        display: block;
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
        margin-bottom: var(--wt-space-2);
      }
      .toggles {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        align-items: flex-start;
      }
      .form-actions {
        display: flex;
        gap: var(--wt-space-2);
        flex-wrap: wrap;
        margin-top: var(--wt-space-4);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
      .home-layouts {
        display: grid;
        gap: var(--wt-space-3);
        margin-top: var(--wt-space-6);
      }
      .home-layouts h2 {
        margin: 0;
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      .home-layouts p {
        margin: 0;
      }
      .home-help {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .home-menu {
        display: grid;
        gap: var(--wt-space-1);
        max-width: calc(var(--wt-tap-min) * 10);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.errorKey = codeOf(error);
    },
    (error) => {
      if (this.errorKey === codeOf(error)) this.errorKey = null;
    },
  );

  @state() private mode: "list" | "editor" = "list";

  @state() private profiles: DeviceProfile[] = [];

  @state() private canvases: Canvas[] = [];

  @state() private errorKey: string | null = null;

  @state() private editingId: string | null = null;
  @state() private draftName = "";
  @state() private draftCanvasId: string | null = null;
  @state() private draftCapabilities: CapabilityFlag[] = [];
  @state() private draftFormFactor: FormFactor = FORM_FACTORS[0];
  // In whole MINUTES (`null` = never); the wire value is SECONDS.
  @state() private draftInactivityMinutes: number | null = null;

  @state() private saving = false;

  @state() private deleteTarget: DeviceProfile | null = null;

  /** The profile's choice of home page layout per menu; null until read, and for a new profile. */
  @state() private homeMenus: DeviceMenuHomeLayouts[] | null = null;
  @state() private homeLoadError = false;
  /** The menu whose choice is being saved. */
  @state() private homeSaving: string | null = null;
  /** Why a menu's choice was refused, by menu id. */
  @state() private homeErrors: Record<string, string> = {};
  /** The menu whose choice was last saved, named in a status line. */
  @state() private homeSaved: string | null = null;
  readonly #homeQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.homeLoadError = true;
    },
  );
  #homeFor: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      await Promise.all([
        this.#queries.watch("listDeviceProfiles", [], (value) => {
          this.profiles = value;
        }),
        this.#queries.watch("listCanvases", [], (value) => {
          this.canvases = value;
        }),
      ]);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Reloads only the PROFILES: no profile write changes the canvas set. */
  async #mutate(action: () => Promise<unknown>): Promise<void> {
    this.errorKey = null;
    try {
      await action();
      this.profiles = await this.api.listDeviceProfiles();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  // ── Home page layouts ──────────────────────────────────────────────────────────────────────────

  async #watchHome(profileId: string): Promise<void> {
    this.#homeFor = profileId;
    this.homeLoadError = false;
    try {
      await this.#homeQueries.watch("getDeviceHomeLayouts", [profileId], (value) => {
        this.homeMenus = value;
        this.homeLoadError = false;
      });
    } catch {
      if (this.#homeFor === profileId) this.homeLoadError = true;
    }
  }

  #releaseHome(): void {
    this.#homeFor = null;
    this.#homeQueries.release("getDeviceHomeLayouts");
    this.homeMenus = null;
    this.homeLoadError = false;
    this.homeErrors = {};
    this.homeSaved = null;
  }

  /** Saved at once, apart from the profile's own Save; null goes back to the menu's default. A
   * choice that saved but could not be read back is a failed load, not a refused choice. */
  async #chooseHome(
    profileId: string,
    menu: DeviceMenuHomeLayouts,
    layoutId: string | null,
  ): Promise<void> {
    if (this.homeSaving !== null) return;
    this.homeErrors = Object.fromEntries(
      Object.entries(this.homeErrors).filter(([menuId]) => menuId !== menu.menuId),
    );
    this.homeSaved = null;
    this.homeSaving = menu.menuId;
    try {
      await this.api.setDeviceHomeLayout(profileId, menu.menuId, layoutId);
    } catch (error) {
      if (this.editingId === profileId)
        this.homeErrors = { ...this.homeErrors, [menu.menuId]: codeMessage(codeOf(error)) };
      this.homeSaving = null;
      return;
    }
    this.homeSaving = null;
    if (this.editingId !== profileId) return;
    this.homeSaved = menu.menuName;
    await this.#watchHome(profileId);
  }

  #canvasLabel(canvasId: string | null): string {
    if (canvasId === null) return t("device_profiles.canvas_default");
    const canvas = this.canvases.find((c) => c.id === canvasId);
    return canvas ? canvas.name : t("device_profiles.canvas_unknown");
  }

  /** Only the KNOWN flags, so an unknown wire value is ignored rather than shown. */
  #capabilitySummary(capabilities: string[]): string {
    const known = CAPABILITY_FLAGS.filter((flag) => capabilities.includes(flag));
    if (known.length === 0) return t("device_profiles.no_capabilities");
    return known.map((flag) => t(`device_profiles.capability.${flag}` as StringKey)).join(", ");
  }

  // ── New / Edit ─────────────────────────────────────────────────────────────────────────────────

  #openCreate(): void {
    this.#releaseHome();
    this.editingId = null;
    this.draftName = "";
    this.draftCanvasId = null;
    this.draftCapabilities = [];
    this.draftFormFactor = FORM_FACTORS[0];
    this.draftInactivityMinutes = null;
    this.errorKey = null;
    this.mode = "editor";
  }

  /** Fetches the profile fresh via `getDeviceProfile(id)` rather than reusing the possibly-stale list
   * row. */
  async #openEditor(id: string): Promise<void> {
    this.errorKey = null;
    try {
      const profile = await this.api.getDeviceProfile(id);
      this.editingId = id;
      this.draftName = profile.name;
      this.draftCanvasId = profile.canvasId;
      this.draftCapabilities = CAPABILITY_FLAGS.filter((flag) =>
        profile.capabilities.includes(flag),
      );
      this.draftFormFactor = profile.formFactor;
      this.draftInactivityMinutes =
        profile.inactivityTimeoutSeconds == null ? null : profile.inactivityTimeoutSeconds / 60;
      this.mode = "editor";
      this.#releaseHome();
      void this.#watchHome(id);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #onName(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.draftName = event.detail.value;
  }

  #onCanvas(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const value = event.detail.value;
    this.draftCanvasId = value === "" ? null : value;
  }

  #onFormFactor(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.draftFormFactor = event.detail.value as FormFactor;
  }

  #onInactivity(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const raw = event.detail.value.trim();
    const minutes = Number(raw);
    this.draftInactivityMinutes = raw === "" || Number.isNaN(minutes) ? null : minutes;
  }

  #onCapToggle(event: CustomEvent<{ checked: boolean }>, flag: CapabilityFlag): void {
    event.stopPropagation();
    this.draftCapabilities = toggleMembership(
      this.draftCapabilities,
      CAPABILITY_FLAGS,
      flag,
      event.detail.checked,
    ) as CapabilityFlag[];
  }

  #cancel(): void {
    this.#releaseHome();
    this.mode = "list";
    this.editingId = null;
    this.draftName = "";
    this.draftCanvasId = null;
    this.draftCapabilities = [];
    this.draftFormFactor = FORM_FACTORS[0];
    this.draftInactivityMinutes = null;
    this.errorKey = null;
  }

  /** The server accepts `""` as a name, so an empty name is refused here. */
  async #save(): Promise<void> {
    if (this.saving) return;
    const name = this.draftName.trim();
    if (name === "") {
      this.errorKey = "device_profiles.err_no_name";
      return;
    }
    const id = this.editingId;
    const canvasId = this.draftCanvasId;
    const capabilities = [...this.draftCapabilities];
    const formFactor = this.draftFormFactor;
    // Minutes → seconds at the wire edge. A `kds` profile always sends null, whatever minutes are left
    // in the draft: the input is hidden for kds.
    const inactivityTimeoutSeconds =
      formFactor === "kds" || this.draftInactivityMinutes == null
        ? null
        : this.draftInactivityMinutes * 60;
    this.saving = true;
    try {
      await this.#mutate(async () => {
        if (id !== null)
          await this.api.updateDeviceProfile(
            id,
            name,
            canvasId,
            capabilities,
            formFactor,
            inactivityTimeoutSeconds,
          );
        else
          await this.api.createDeviceProfile(
            name,
            canvasId,
            capabilities,
            formFactor,
            inactivityTimeoutSeconds,
          );
        this.#releaseHome();
        this.mode = "list";
        this.editingId = null;
        this.draftName = "";
        this.draftCanvasId = null;
        this.draftCapabilities = [];
        this.draftFormFactor = FORM_FACTORS[0];
        this.draftInactivityMinutes = null;
      });
    } finally {
      this.saving = false;
    }
  }

  // ── Duplicate ────────────────────────────────────────────────────────────────────────────────────

  #duplicate(profile: DeviceProfile): void {
    const name = `${profile.name}${t("device_profiles.copy_suffix")}`;
    void this.#mutate(() =>
      this.api.createDeviceProfile(
        name,
        profile.canvasId,
        profile.capabilities,
        profile.formFactor,
        profile.inactivityTimeoutSeconds,
      ),
    );
  }

  // ── Delete ───────────────────────────────────────────────────────────────────────────────────────

  #openDelete(profile: DeviceProfile): void {
    this.deleteTarget = profile;
  }

  #confirmDelete(): void {
    const target = this.deleteTarget;
    if (target === null) return;
    const id = target.id;
    this.deleteTarget = null;
    void this.#mutate(() => this.api.deleteDeviceProfile(id));
  }

  // ── Renderers ────────────────────────────────────────────────────────────────────────────────────

  #renderRow(profile: DeviceProfile): TemplateResult {
    return html`<li data-test="profile-row-${profile.id}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label" data-test="profile-name-${profile.id}">${profile.name}</span>
            <span class="meta">
              <span data-test="profile-canvas-${profile.id}"
                >${t("device_profiles.canvas_label")}: ${this.#canvasLabel(profile.canvasId)}</span
              >
              <span data-test="profile-caps-${profile.id}"
                >${this.#capabilitySummary(profile.capabilities)}</span
              >
            </span>
          </div>
          <div class="actions">
            <wt-button
              variant="primary"
              size="sm"
              data-test="edit-${profile.id}"
              @click=${() => void this.#openEditor(profile.id)}
              >${t("action.edit")}</wt-button
            >
            <wt-button
              variant="secondary"
              size="sm"
              data-test="duplicate-${profile.id}"
              @click=${() => this.#duplicate(profile)}
              >${t("device_profiles.duplicate")}</wt-button
            >
            <wt-button
              variant="danger"
              size="sm"
              data-test="delete-${profile.id}"
              @click=${() => this.#openDelete(profile)}
              >${t("device_profiles.delete_confirm")}</wt-button
            >
          </div>
        </div>
      </wt-card>
    </li>`;
  }

  #renderDeleteDialog(): TemplateResult {
    return html`<wt-dialog
      heading=${t("device_profiles.delete_title")}
      .open=${this.deleteTarget !== null}
      @wt-close=${() => (this.deleteTarget = null)}
    >
      <p data-test="delete-message">${t("device_profiles.delete_message")}</p>
      <wt-button
        slot="footer"
        variant="danger"
        data-test="confirm-delete"
        @click=${() => this.#confirmDelete()}
        >${t("device_profiles.delete_confirm")}</wt-button
      >
    </wt-dialog>`;
  }

  #renderList(): TemplateResult {
    return html`
      <h1 class="title">${t("device_profiles.title")}</h1>
      <wt-button variant="primary" data-test="create" @click=${() => this.#openCreate()}
        >${t("device_profiles.create")}</wt-button
      >
      ${
        this.profiles.length === 0
          ? html`<p class="empty" data-test="no-profiles">${t("device_profiles.empty")}</p>`
          : html`<ol>
              ${this.profiles.map((profile) => this.#renderRow(profile))}
            </ol>`
      }
      ${this.#renderDeleteDialog()}
      ${
        this.errorKey
          ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
    `;
  }

  #canvasOptions(): { value: string; label: string }[] {
    return [
      { value: "", label: t("device_profiles.canvas_default") },
      ...this.canvases.map((canvas) => ({ value: canvas.id, label: canvas.name })),
    ];
  }

  #homeDefaultLabel(menu: DeviceMenuHomeLayouts): string {
    const fallback = menu.layouts.find((layout) => layout.isDefault);
    return fallback === undefined
      ? t("device_profiles.home_default_plain")
      : t("device_profiles.home_default").replace("{name}", fallback.name);
  }

  #homeOptions(menu: DeviceMenuHomeLayouts): { value: string; label: string }[] {
    const chosen = menu.selectedLayoutId;
    const named = menu.layouts.filter((layout) => !layout.isDefault || layout.id === chosen);
    return [
      { value: "", label: this.#homeDefaultLabel(menu) },
      ...named.map((layout) => ({ value: layout.id, label: layout.name })),
      ...(menu.selectedRemoved
        ? [{ value: chosen!, label: t("device_profiles.home_removed") }]
        : []),
    ];
  }

  #renderHomeMenu(menu: DeviceMenuHomeLayouts): TemplateResult {
    const saving = this.homeSaving !== null;
    return html`<div class="home-menu" data-test=${`home-menu-${menu.menuId}`}>
      <wt-combobox
        name=${`home-layout-${menu.menuId}`}
        label=${menu.menuName}
        search="auto"
        placeholder=${this.#homeDefaultLabel(menu)}
        searchPlaceholder=${t("categories.combobox_search")}
        noResultsLabel=${t("categories.combobox_no_results")}
        .options=${this.#homeOptions(menu)}
        .value=${live(menu.selectedLayoutId ?? "")}
        .disabled=${saving}
        error=${this.homeErrors[menu.menuId] ?? ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          const value = event.detail.value;
          void this.#chooseHome(this.editingId!, menu, value === "" ? null : value);
        }}
      ></wt-combobox>
      ${
        menu.selectedRemoved
          ? html`<p class="home-help" data-test=${`home-removed-${menu.menuId}`}>
                ${t("device_profiles.home_removed_note").replace("{menu}", menu.menuName)}
              </p>
              <div>
                <wt-button
                  variant="secondary"
                  size="sm"
                  data-test=${`home-reset-${menu.menuId}`}
                  .disabled=${saving}
                  @click=${() => void this.#chooseHome(this.editingId!, menu, null)}
                  >${t("device_profiles.home_reset")}</wt-button
                >
              </div>`
          : nothing
      }
    </div>`;
  }

  #renderHomeBody() {
    if (this.editingId === null)
      return html`<p class="home-help" data-test="home-new">${t("device_profiles.home_new")}</p>`;
    const loadError = this.homeLoadError
      ? html`<p class="error" role="alert" data-test="home-load-error">
            ${t("device_profiles.home_error")}
          </p>
          <div>
            <wt-button
              variant="secondary"
              data-test="home-retry"
              @click=${() => void this.#watchHome(this.editingId!)}
              >${t("menus.retry")}</wt-button
            >
          </div>`
      : nothing;
    if (this.homeMenus === null)
      return this.homeLoadError
        ? loadError
        : html`<p role="status" data-test="home-loading">${t("device_profiles.home_loading")}</p>`;
    const menus = this.homeMenus.filter(hasChoice);
    return html`${loadError}
      <p class="home-help">${t("device_profiles.home_help")}</p>
      ${
        menus.length === 0
          ? html`<p class="home-help" data-test="home-none">${t("device_profiles.home_none")}</p>`
          : menus.map((menu) => this.#renderHomeMenu(menu))
      }
      <p role="status" class="home-help" data-test="home-saved">
        ${
          this.homeSaved === null
            ? nothing
            : t("device_profiles.home_saved").replace("{menu}", this.homeSaved)
        }
      </p>`;
  }

  #renderEditor(): TemplateResult {
    return html`
      <div class="editor" data-test="editor-form" data-editing-id=${this.editingId ?? nothing}>
        <h1 class="title">${t("device_profiles.title")}</h1>
        <wt-input
          @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]"))}
          class="field"
          data-test="profile-name"
          label=${t("device_profiles.name")}
          .value=${this.draftName}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onName(e)}
        ></wt-input>
        <wt-combobox
          class="field"
          data-test="profile-canvas"
          name="canvasId"
          label=${t("device_profiles.canvas_label")}
          search="auto"
          placeholder=${t("device_profiles.canvas_default")}
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          .options=${this.#canvasOptions()}
          .value=${this.draftCanvasId ?? ""}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onCanvas(e)}
        ></wt-combobox>
        <wt-combobox
          class="field"
          data-test="profile-form-factor"
          name="formFactor"
          label=${t("device_profiles.form_factor")}
          search="auto"
          .options=${FORM_FACTORS.map((ff) => ({
            value: ff,
            label: t(`device_profiles.form_factor.${ff}` as StringKey),
          }))}
          .value=${this.draftFormFactor}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFormFactor(e)}
        ></wt-combobox>
        ${
          this.draftFormFactor === "kds"
            ? nothing
            : html`<wt-input
                @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]"))}
                class="field"
                type="number"
                min="1"
                data-test="profile-inactivity"
                label=${t("device_profiles.inactivity_timeout_label")}
                .value=${this.draftInactivityMinutes == null ? "" : String(this.draftInactivityMinutes)}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onInactivity(e)}
              ></wt-input>`
        }
        <div class="field" data-test="capabilities">
          <span class="panel-subtitle">${t("device_profiles.capabilities")}</span>
          <div class="toggles">
            ${CAPABILITY_FLAGS.map(
              (flag) =>
                html`<wt-switch
                  data-test="cap-${flag}"
                  label=${t(`device_profiles.capability.${flag}` as StringKey)}
                  .checked=${this.draftCapabilities.includes(flag)}
                  @wt-change=${(e: CustomEvent<{ checked: boolean }>) => this.#onCapToggle(e, flag)}
                ></wt-switch>`,
            )}
          </div>
        </div>
        <div class="form-actions">
          <wt-button variant="secondary" data-test="profile-cancel" @click=${() => this.#cancel()}
            >${t("device_profiles.cancel")}</wt-button
          >
          <wt-button
            variant="primary"
            data-test="profile-save"
            ?disabled=${this.saving}
            @click=${() => void this.#save()}
            >${t("device_profiles.save")}</wt-button
          >
        </div>
      </div>
      ${
        this.errorKey
          ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
      <section class="home-layouts" data-test="home-layouts" aria-labelledby="home-heading">
        <h2 id="home-heading">${t("device_profiles.home_heading")}</h2>
        ${this.#renderHomeBody()}
      </section>
    `;
  }

  override render(): TemplateResult {
    return this.mode === "editor" ? this.#renderEditor() : this.#renderList();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-device-profiles-screen": DeviceProfilesScreen;
  }
}
