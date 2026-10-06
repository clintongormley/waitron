import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-dialog.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { printerLabel } from "../i18n/domain.js";
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
import type {
  Canvas,
  DeviceProfile,
  DashboardApi,
  Printer,
  ProfilePrinterLists,
} from "../api/client.js";

type PrinterListKey = keyof ProfilePrinterLists;

const PRINTER_LISTS = [
  {
    key: "receiptPrinterIds",
    test: "receipt-printers",
    heading: "device_profiles.receipt_printers",
  },
  {
    key: "paymentSlipPrinterIds",
    test: "payment-slip-printers",
    heading: "device_profiles.payment_slip_printers",
  },
] as const satisfies readonly { key: PrinterListKey; test: string; heading: StringKey }[];

const NO_PRINTER_LISTS: ProfilePrinterLists = { receiptPrinterIds: [], paymentSlipPrinterIds: [] };

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
      .printer-choice,
      .order {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
      }
      .printer-choice {
        flex-wrap: wrap;
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

  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => this.#showReadError(error),
    () => {
      if (this.#readErrorShown) this.#showError(null);
    },
  );

  @state() private mode: "list" | "editor" = "list";

  @state() private profiles: DeviceProfile[] = [];

  @state() private canvases: Canvas[] = [];

  @state() private printers: Printer[] = [];

  @state() private errorKey: string | null = null;
  /** Whether `errorKey` is a read's failure, the only message the reads' recovery may clear. */
  #readErrorShown = false;

  @state() private editingId: string | null = null;
  @state() private draftName = "";
  @state() private draftCanvasId: string | null = null;
  @state() private draftCapabilities: CapabilityFlag[] = [];
  @state() private draftFormFactor: FormFactor = FORM_FACTORS[0];
  // In whole MINUTES (`null` = never); the wire value is SECONDS.
  @state() private draftInactivityMinutes: number | null = null;
  @state() private draftPrinterLists: ProfilePrinterLists = NO_PRINTER_LISTS;

  @state() private saving = false;

  @state() private deleteTarget: DeviceProfile | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.#showError(null);
    try {
      await Promise.all([
        this.#queries.watch("listDeviceProfiles", [], (value) => {
          this.profiles = value;
        }),
        this.#queries.watch("listCanvases", [], (value) => {
          this.canvases = value;
        }),
        this.#queries.watch("listPrinters", [], (value) => {
          this.printers = value;
        }),
      ]);
    } catch (error) {
      this.#showReadError(error);
    }
  }

  #showError(code: string | null, fromRead = false): void {
    this.errorKey = code;
    this.#readErrorShown = fromRead;
  }

  /** A read's failure never replaces an action's message. */
  #showReadError(error: unknown): void {
    if (this.errorKey === null || this.#readErrorShown) this.#showError(codeOf(error), true);
  }

  /** Reloads only the PROFILES: no profile write changes the canvas or printer set. */
  async #mutate(action: () => Promise<unknown>): Promise<void> {
    this.#showError(null);
    let written = false;
    try {
      await action();
      written = true;
      this.profiles = await this.api.listDeviceProfiles();
    } catch (error) {
      if (written) this.#showReadError(error);
      else this.#showError(codeOf(error));
    }
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

  #clearDraft(): void {
    this.editingId = null;
    this.draftName = "";
    this.draftCanvasId = null;
    this.draftCapabilities = [];
    this.draftFormFactor = FORM_FACTORS[0];
    this.draftInactivityMinutes = null;
    this.draftPrinterLists = NO_PRINTER_LISTS;
  }

  #openCreate(): void {
    this.#clearDraft();
    this.#showError(null);
    this.mode = "editor";
  }

  /** Fetches the profile fresh via `getDeviceProfile(id)` rather than reusing the possibly-stale list
   * row. */
  async #openEditor(id: string): Promise<void> {
    this.#showError(null);
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
      this.draftPrinterLists = {
        receiptPrinterIds: profile.receiptPrinterIds,
        paymentSlipPrinterIds: profile.paymentSlipPrinterIds,
      };
      this.mode = "editor";
    } catch (error) {
      this.#showReadError(error);
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

  /** Appended when switched on: the order decides which printer a joining device starts on. */
  #onPrinterToggle(
    event: CustomEvent<{ checked: boolean }>,
    key: PrinterListKey,
    printerId: string,
  ): void {
    event.stopPropagation();
    const others = this.draftPrinterLists[key].filter((id) => id !== printerId);
    this.draftPrinterLists = {
      ...this.draftPrinterLists,
      [key]: event.detail.checked ? [...others, printerId] : others,
    };
  }

  /** Swaps with the neighbour on screen, so an id the printer list has not delivered is passed
   * over rather than swapped with unseen. */
  #movePrinter(key: PrinterListKey, drawn: readonly string[], printerId: string, by: -1 | 1): void {
    const neighbour = drawn[drawn.indexOf(printerId) + by]!;
    const list = [...this.draftPrinterLists[key]];
    const from = list.indexOf(printerId);
    const to = list.indexOf(neighbour);
    [list[from], list[to]] = [neighbour, printerId];
    this.draftPrinterLists = { ...this.draftPrinterLists, [key]: list };
  }

  #cancel(): void {
    this.#clearDraft();
    this.mode = "list";
    this.#showError(null);
  }

  /** The server accepts `""` as a name, so an empty name is refused here. */
  async #save(): Promise<void> {
    if (this.saving) return;
    const name = this.draftName.trim();
    if (name === "") {
      this.#showError("device_profiles.err_no_name");
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
    const printerLists = this.draftPrinterLists;
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
            printerLists,
          );
        else
          await this.api.createDeviceProfile(
            name,
            canvasId,
            capabilities,
            formFactor,
            inactivityTimeoutSeconds,
            printerLists,
          );
        this.#clearDraft();
        this.mode = "list";
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
        {
          receiptPrinterIds: profile.receiptPrinterIds,
          paymentSlipPrinterIds: profile.paymentSlipPrinterIds,
        },
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

  /** The list's own printers first, in its order, switched-off ones included so a save keeps them;
   * then every other printer that is switched on. */
  #printerChoices(key: PrinterListKey): { printer: Printer; listed: boolean }[] {
    const listed = this.draftPrinterLists[key];
    return [
      ...listed.flatMap((id) => {
        const printer = this.printers.find((p) => p.id === id);
        return printer === undefined ? [] : [{ printer, listed: true }];
      }),
      ...this.printers
        .filter((printer) => printer.active && !listed.includes(printer.id))
        .map((printer) => ({ printer, listed: false })),
    ];
  }

  #renderPrinterList(
    list: (typeof PRINTER_LISTS)[number],
    choices: { printer: Printer; listed: boolean }[],
  ): TemplateResult {
    const drawn = choices.filter((choice) => choice.listed).map((choice) => choice.printer.id);
    return html`<div
      class="field"
      role="group"
      aria-labelledby="${list.test}-heading"
      data-test=${list.test}
    >
      <span class="panel-subtitle" id="${list.test}-heading">${t(list.heading)}</span>
      <div class="toggles">
        ${choices.map(({ printer, listed }) => {
          const position = drawn.indexOf(printer.id);
          const name = printerLabel(printer);
          return html`<div class="printer-choice">
            <wt-switch
              data-test="${list.test}-${printer.id}"
              data-printer-id=${printer.id}
              label=${name}
              .checked=${listed}
              @wt-change=${(e: CustomEvent<{ checked: boolean }>) =>
                this.#onPrinterToggle(e, list.key, printer.id)}
            ></wt-switch>
            ${
              listed
                ? html`<span class="order"
                    ><wt-button
                      variant="ghost"
                      size="sm"
                      data-test="${list.test}-up-${printer.id}"
                      aria-label="${t("device_profiles.move_up")} ${printer.name}"
                      ?disabled=${position === 0}
                      @click=${() => this.#movePrinter(list.key, drawn, printer.id, -1)}
                      >${t("device_profiles.move_up")}</wt-button
                    >
                    <wt-button
                      variant="ghost"
                      size="sm"
                      data-test="${list.test}-down-${printer.id}"
                      aria-label="${t("device_profiles.move_down")} ${printer.name}"
                      ?disabled=${position === drawn.length - 1}
                      @click=${() => this.#movePrinter(list.key, drawn, printer.id, 1)}
                      >${t("device_profiles.move_down")}</wt-button
                    ></span
                  >`
                : nothing
            }
          </div>`;
        })}
      </div>
    </div>`;
  }

  #renderPrinterLists(): TemplateResult {
    const lists = PRINTER_LISTS.map((list) => ({ list, choices: this.#printerChoices(list.key) }));
    if (lists.every(({ choices }) => choices.length === 0))
      return html`<p class="field" data-test="no-printers">${t("device_profiles.no_printers")}</p>`;
    return html`${lists.map(({ list, choices }) => this.#renderPrinterList(list, choices))}`;
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
        ${this.#renderPrinterLists()}
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
