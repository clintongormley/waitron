import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-dialog.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
// The three capability flags are a dashboard-LOCAL mirror (the #70 bundle rule forbids a runtime
// `@waitron/layouts` import — its barrel drags `@waitron/db` into the browser bundle). The canvas
// editor already keeps this mirror in card-contracts.ts, so this screen reuses it rather than
// declaring a second copy; a profile's `capabilities` (opaque `string[]` on the wire) is rendered
// defensively against it.
import { CAPABILITY_FLAGS, type CapabilityFlag } from "./canvas-editor/card-contracts.js";
import type { Canvas, DeviceProfile, DashboardApi } from "../api/client.js";

/** Toggle `value`'s membership of `current`, returning a NEW array ordered by `all` (deterministic,
 * not click order): add it when `checked`, drop it otherwise, then filter `all` to what remains. */
function toggleMembership<T>(
  current: readonly T[],
  all: readonly T[],
  value: T,
  checked: boolean,
): T[] {
  const set = new Set(current);
  if (checked) set.add(value);
  else set.delete(value);
  return all.filter((x) => set.has(x));
}

/**
 * The management dashboard's DEVICE-PROFILES screen — the venue authors reusable device profiles,
 * each a named bundle of an assigned canvas (or the form-factor default) and a capability set that a
 * device inherits at enrolment. It is intentionally SIMPLER than the canvas editor: no grid/tile/
 * palette machinery, only a list and a flat editor form.
 *
 * LIST mode loads the tenant's profiles (`api.listDeviceProfiles()`) AND its canvases
 * (`api.listCanvases()`, for the canvas `<select>` and to resolve each profile's `canvasId` to a
 * NAME), and renders each profile as a card carrying its name, its referenced canvas name (or the
 * "form-factor default" fallback) and a capability summary, plus per-row Edit / Duplicate / Delete.
 * "New profile" enters the editor form on a blank draft; Duplicate is an IMMEDIATE server write of a
 * "<name> (copy)" copy from the same canvas + capabilities; Delete confirms in a dialog first.
 *
 * EDITOR mode is the flat form: a NAME text field, a canvas `<select>` (its first option is the
 * form-factor default = `canvasId` null), and a switch per capability flag. Save refuses an empty
 * name (the server accepts `""`, so it is guarded here), then `createDeviceProfile` /
 * `updateDeviceProfile` on `editingId` and returns to the reloaded list. Cancel discards.
 *
 * DEFENSIVE. `capabilities` crosses the client boundary as opaque `string[]` (the #70 bundle rule —
 * the dashboard never imports `@waitron/layouts`' `CapabilityFlag`). The switches and the summary
 * render only KNOWN flags (`CAPABILITY_FLAGS`), so an unknown value on the wire is ignored rather than
 * throwing; the server's store stays authoritative on every write.
 *
 * ERROR HANDLING mirrors the sibling screens: every loader/mutation is fully `try/catch`ed, so a
 * rejection becomes `errorKey` (its `{ code }`, falling back to `server.internal`) in a `role="alert"`
 * banner. `codeMessage` maps the empty-name pseudo-code (`device_profiles.err_no_name`) and the
 * server's `device_profile.*` / `server.*` codes through the same call, no per-key routing.
 */
@customElement("dashboard-device-profiles-screen")
export class DeviceProfilesScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
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
    `,
  ];

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

  /** Which mode is showing. `list` is the profile gallery; `editor` is the flat editor form. */
  @state() private mode: "list" | "editor" = "list";

  /** The tenant's device profiles, (re)loaded on connect and after every mutation. */
  @state() private profiles: DeviceProfile[] = [];

  /** The tenant's canvases — for the editor `<select>` and to resolve a profile's `canvasId` to a name. */
  @state() private canvases: Canvas[] = [];

  @state() private errorKey: string | null = null;

  // Editor-form draft: the fields the operator edits, and the id of the profile being edited (null for
  // a freshly-created profile not yet saved).
  @state() private editingId: string | null = null;
  @state() private draftName = "";
  @state() private draftCanvasId: string | null = null;
  @state() private draftCapabilities: CapabilityFlag[] = [];

  /** True while a `#save` write is in flight, so Save disables itself and no second write races. */
  @state() private saving = false;

  // Delete dialog state: the profile armed for deletion (null = closed).
  @state() private deleteTarget: DeviceProfile | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** (Re)load the tenant's profiles AND canvases in parallel. Called on connect and after every
   * mutation. A rejection becomes the `errorKey` banner rather than an unhandled rejection. */
  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      const [profiles, canvases] = await Promise.all([
        this.api.listDeviceProfiles(),
        this.api.listCanvases(),
      ]);
      this.profiles = profiles;
      this.canvases = canvases;
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** The shared shape of every mutation: clear the error banner, run `action`, reload on success, and
   * turn a rejection into the `errorKey` banner (never an unhandled rejection). */
  async #mutate(action: () => Promise<unknown>): Promise<void> {
    this.errorKey = null;
    try {
      await action();
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Resolve a profile's `canvasId` to the display name shown on its row: the form-factor default when
   * `null`, the canvas's name when it resolves, or the "unknown canvas" fallback when the id names no
   * canvas in the loaded set (a since-deleted reference). */
  #canvasLabel(canvasId: string | null): string {
    if (canvasId === null) return t("device_profiles.canvas_default");
    const canvas = this.canvases.find((c) => c.id === canvasId);
    return canvas ? canvas.name : t("device_profiles.canvas_unknown");
  }

  /** The capability summary shown on a profile row: the KNOWN flags it carries (ordered by
   * `CAPABILITY_FLAGS`, ignoring any unknown wire value) mapped to their localised labels and joined,
   * or the "no capabilities" fallback when it carries none. */
  #capabilitySummary(capabilities: string[]): string {
    const known = CAPABILITY_FLAGS.filter((flag) => capabilities.includes(flag));
    if (known.length === 0) return t("device_profiles.no_capabilities");
    return known.map((flag) => t(`device_profiles.capability.${flag}` as StringKey)).join(", ");
  }

  // ── New / Edit ─────────────────────────────────────────────────────────────────────────────────

  /** Enter the editor form on a BLANK draft (no id → Save creates). */
  #openCreate(): void {
    this.editingId = null;
    this.draftName = "";
    this.draftCanvasId = null;
    this.draftCapabilities = [];
    this.errorKey = null;
    this.mode = "editor";
  }

  /** Open the editor for an existing profile. FETCHES it fresh via `getDeviceProfile(id)` rather than
   * reusing the possibly-stale list snapshot, then seeds the draft. `capabilities` is filtered to the
   * KNOWN flags (ordered by `CAPABILITY_FLAGS`) so the switches reflect it deterministically and an
   * unknown wire value is dropped rather than shown. A rejection sets the banner and stays in LIST
   * mode; it never becomes an unhandled rejection (the caller `void`-invokes it). */
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
      this.mode = "editor";
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #onName(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.draftName = event.detail.value;
  }

  /** The canvas `<select>`'s change handler: an empty value (the first "form-factor default" option)
   * maps to `null`, any other to that canvas's id. */
  #onCanvas(event: Event): void {
    event.stopPropagation();
    const value = (event.target as HTMLSelectElement).value;
    this.draftCanvasId = value === "" ? null : value;
  }

  /** Toggle a capability flag, rebuilt in the declared flag order (deterministic, not click order). */
  #onCapToggle(event: CustomEvent<{ checked: boolean }>, flag: CapabilityFlag): void {
    event.stopPropagation();
    this.draftCapabilities = toggleMembership(
      this.draftCapabilities,
      CAPABILITY_FLAGS,
      flag,
      event.detail.checked,
    ) as CapabilityFlag[];
  }

  /** Discard the draft and return to the list, clearing the error banner too. */
  #cancel(): void {
    this.mode = "list";
    this.editingId = null;
    this.draftName = "";
    this.draftCanvasId = null;
    this.draftCapabilities = [];
    this.errorKey = null;
  }

  /**
   * Persist the draft: refuse an empty NAME first (the server accepts `""`, so it is guarded here),
   * then `updateDeviceProfile` when editing an existing profile or `createDeviceProfile` for a fresh
   * one, after which the editor returns to the (reloaded) list. A server rejection (a
   * `device_profile.*` code) stays in the editor with the banner shown. Save disables itself while the
   * write is in flight.
   */
  async #save(): Promise<void> {
    const name = this.draftName.trim();
    if (name === "") {
      this.errorKey = "device_profiles.err_no_name";
      return;
    }
    const id = this.editingId;
    const canvasId = this.draftCanvasId;
    const capabilities = [...this.draftCapabilities];
    this.saving = true;
    try {
      await this.#mutate(async () => {
        if (id !== null) await this.api.updateDeviceProfile(id, name, canvasId, capabilities);
        else await this.api.createDeviceProfile(name, canvasId, capabilities);
        this.mode = "list";
        this.editingId = null;
        this.draftName = "";
        this.draftCanvasId = null;
        this.draftCapabilities = [];
      });
    } finally {
      this.saving = false;
    }
  }

  // ── Duplicate ────────────────────────────────────────────────────────────────────────────────────

  /** Create a copy of `profile` under a "<name> (copy)" name, from the SAME canvas + capabilities, then
   * reload. An IMMEDIATE server write (unlike New, which only enters the form). */
  #duplicate(profile: DeviceProfile): void {
    const name = `${profile.name}${t("device_profiles.copy_suffix")}`;
    void this.#mutate(() =>
      this.api.createDeviceProfile(name, profile.canvasId, profile.capabilities),
    );
  }

  // ── Delete ───────────────────────────────────────────────────────────────────────────────────────

  #openDelete(profile: DeviceProfile): void {
    this.deleteTarget = profile;
  }

  /** Delete the armed profile, then reload. A rejection (a since-deleted id) becomes the error banner. */
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

  /** The canvas `<select>`: a first "form-factor default" option (value `""` = `canvasId` null), then
   * one option per canvas. `draftCanvasId` drives which is selected. */
  #renderCanvasOptions(): TemplateResult {
    return html`<option value="" ?selected=${this.draftCanvasId === null}>
        ${t("device_profiles.canvas_default")}
      </option>
      ${this.canvases.map(
        (canvas) =>
          html`<option value=${canvas.id} ?selected=${canvas.id === this.draftCanvasId}>
            ${canvas.name}
          </option>`,
      )}`;
  }

  #renderEditor(): TemplateResult {
    return html`
      <div class="editor" data-test="editor-form" data-editing-id=${this.editingId ?? nothing}>
        <h1 class="title">${t("device_profiles.title")}</h1>
        <wt-input
          class="field"
          data-test="profile-name"
          label=${t("device_profiles.name")}
          .value=${this.draftName}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onName(e)}
        ></wt-input>
        <label class="field"
          >${t("device_profiles.canvas_label")}
          <select
            data-test="profile-canvas"
            .value=${this.draftCanvasId ?? ""}
            @change=${(e: Event) => this.#onCanvas(e)}
          >
            ${this.#renderCanvasOptions()}
          </select>
        </label>
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
