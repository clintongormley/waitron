import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
} from "@waitron/ui";
import type { DeviceZoneSelection, DeviceZoneSelectionInput } from "@waitron/venue-service";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { trackDialog } from "./track-dialog.js";

export interface DeviceZonesRefusal {
  code?: string;
  field?: string;
  message?: string;
}
interface Draft {
  selectedZoneIds: readonly string[];
  startingZoneId: string | null;
}
const copy = (draft: Draft): Draft => ({
  selectedZoneIds: [...draft.selectedZoneIds],
  startingZoneId: draft.startingZoneId,
});
const equal = (a: Draft, b: Draft): boolean =>
  a.startingZoneId === b.startingZoneId &&
  a.selectedZoneIds.length === b.selectedZoneIds.length &&
  a.selectedZoneIds.every((id) => b.selectedZoneIds.includes(id));

@customElement("till-device-zones-dialog")
export class DeviceZonesDialog extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  static override styles = [
    baseStyles,
    css`
      .fields {
        display: grid;
        gap: var(--wt-space-3);
        width: var(--wt-form-max-width);
        max-width: 100%;
      }
      .choices {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        text-align: start;
        padding: var(--wt-space-2);
        border-bottom: 1px solid var(--wt-color-border);
      }
      label {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
      }
      input {
        accent-color: var(--wt-color-primary);
        width: var(--wt-space-4);
        height: var(--wt-space-4);
        margin: 0;
        vertical-align: middle;
      }
      input:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      [data-zones-error],
      [data-start-error] {
        color: var(--wt-color-danger);
      }
      .notice {
        color: var(--wt-color-text-muted);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) selection: DeviceZoneSelection | null = null;
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) loading = false;
  @property() readError = "";
  @property({ attribute: false }) refusal?: DeviceZonesRefusal;
  @state() private draft: Draft = { selectedZoneIds: [], startingZoneId: null };
  @state() private attempted = false;
  @state() private dismissedRefusal?: DeviceZonesRefusal;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  #baseline?: Draft;
  #profile?: string;
  #rows: DeviceZoneSelection["zones"] = [];
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    (!this.#leave ||
      (await this.#leave.request({ scopes: [this], reason, proceed() {} })) === "proceeded");

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback(): void {
    this.#dispose();
    super.disconnectedCallback();
  }
  #dispose(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
  }
  override willUpdate(changed: PropertyValues): void {
    if (!this.isConnected) return;
    if (!this.open) {
      this.#dispose();
      this.#baseline = undefined;
      this.#profile = undefined;
      this.#rows = [];
      this.attempted = false;
      return;
    }
    const selection = this.selection;
    if (selection === null) return;
    if (!this.#baseline || (changed.has("selection") && equal(this.draft, this.#baseline))) {
      this.draft = copy(selection);
      this.#baseline = copy(this.draft);
      this.#profile = selection.profileId;
      this.#rows = selection.zones;
      this.attempted = false;
      this.#scope?.commit(this.#baseline);
    } else if (changed.has("selection")) {
      this.#rows = [
        ...selection.zones,
        ...this.#rows.filter(
          (row) =>
            !selection.zones.some((zone) => zone.id === row.id) &&
            this.draft.selectedZoneIds.includes(row.id),
        ),
      ];
      if (this.#invalid()) this.attempted = true;
    }
    if (!this.#scope) {
      const { scope, coordinator } = draftScopeFor<Draft>(this, {
        id: this,
        current: () => this.draft,
        snapshot: copy,
        equal,
        restore: (draft) => {
          this.draft = copy(draft);
        },
      });
      this.#scope = scope;
      this.#leave = coordinator;
      scope.commit(this.#baseline!);
    }
  }
  #badZones(): boolean {
    return (
      this.selection === null ||
      this.selection.profileId !== this.#profile ||
      this.draft.selectedZoneIds.length === 0 ||
      this.draft.selectedZoneIds.some((id) => !this.selection!.zones.some((zone) => zone.id === id))
    );
  }
  #badStart(): boolean {
    return (
      this.draft.startingZoneId === null ||
      !this.draft.selectedZoneIds.includes(this.draft.startingZoneId) ||
      !this.selection?.zones.some((zone) => zone.id === this.draft.startingZoneId)
    );
  }
  #invalid(): boolean {
    return this.#badZones() || this.#badStart();
  }
  #edit(id: string, shown: boolean): void {
    if (this.busy || !this.open) return;
    this.draft = {
      selectedZoneIds: shown
        ? [...this.draft.selectedZoneIds, id]
        : this.draft.selectedZoneIds.filter((value) => value !== id),
      startingZoneId: !shown && this.draft.startingZoneId === id ? null : this.draft.startingZoneId,
    };
    this.dismissedRefusal = this.refusal;
    this.#scope?.changed();
  }
  #start(id: string): void {
    if (this.busy || !this.open || !this.draft.selectedZoneIds.includes(id)) return;
    this.draft = { ...this.draft, startingZoneId: id };
    this.dismissedRefusal = this.refusal;
    this.#scope?.changed();
  }
  #save(): void {
    if (
      !this.isConnected ||
      !this.open ||
      this.busy ||
      !this.selection ||
      saveActionState(this.#scope).unchanged
    )
      return;
    this.attempted = true;
    this.dismissedRefusal = this.refusal;
    if (this.#invalid()) {
      void this.updateComplete.then(() =>
        this.shadowRoot!.querySelector<HTMLInputElement>(
          '[aria-invalid="true"] input:not(:disabled), input[aria-invalid="true"]:not(:disabled)',
        )?.focus(),
      );
      return;
    }
    this.dispatchEvent(
      new CustomEvent<DeviceZoneSelectionInput>("save-device-zones", {
        detail: {
          profileId: this.selection.profileId,
          snapshot: this.selection.snapshot,
          selectedZoneIds: [...this.draft.selectedZoneIds],
          startingZoneId: this.draft.startingZoneId!,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }
  acceptSaved(input: DeviceZoneSelectionInput): void {
    this.#baseline = copy(input);
    this.#scope?.commit(this.#baseline);
    this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.closeAfter("saved");
  }
  #close(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.open) return;
    this.open = false;
    this.#dispose();
    this.dispatchEvent(new CustomEvent("close-device-zones", { bubbles: true, composed: true }));
  }
  override render() {
    const action = saveActionState(this.#scope);
    const refusal = this.refusal === this.dismissedRefusal ? undefined : this.refusal;
    const zonesError =
      this.attempted && this.#badZones()
        ? t("device_zones.choose_zones")
        : refusal?.field === "selectedZoneIds"
          ? (refusal.message ??
            (refusal.code ? codeMessage(refusal.code) : t("device_zones.write_failed")))
          : "";
    const startError =
      this.attempted && this.#badStart()
        ? t("device_zones.choose_start")
        : refusal?.field === "startingZoneId"
          ? (refusal.message ??
            (refusal.code ? codeMessage(refusal.code) : t("device_zones.write_failed")))
          : "";
    const correction = this.attempted && this.#invalid();
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.open}
      .heading=${t("device_zones.title")}
      .dismissible=${!this.busy}
      .beforeClose=${this.#beforeClose}
      @wt-close=${(e: Event) => this.#close(e)}
    >
      <div class="fields">
        <p>${t("device_zones.explanation")}</p>
        ${this.loading ? html`<p role="status">${t("device_zones.loading")}</p>` : nothing}
        ${this.selection?.adjusted ? html`<p class="notice">${t("device_zones.adjusted")}</p>` : nothing}
        ${this.selection?.zones.length === 0 ? html`<p role="status">${codeMessage("device_profile.no_service_zone")}</p>` : nothing}
        ${
          this.selection
            ? html`<table class="choices">
                <thead>
                  <tr>
                    <th id="shown-heading" scope="col">${t("device_zones.show")} *</th>
                    <th scope="col">${t("device_zones.zone")}</th>
                    <th scope="col">${t("device_zones.kind")}</th>
                    <th id="start-heading" scope="col">${t("device_zones.opens_first")} *</th>
                  </tr>
                </thead>
                <tbody>
                  ${this.#rows.map((zone) => {
                    const allowed = this.selection!.zones.some((row) => row.id === zone.id);
                    return html`<tr>
                      <td>
                        <label
                          ><input
                            type="checkbox"
                            name="shown-zone"
                            value=${zone.id}
                            aria-label=${`${t("device_zones.show")} ${zone.name}`}
                            aria-invalid=${zonesError ? "true" : "false"}
                            aria-describedby=${zonesError ? "zones-error" : nothing}
                            .checked=${live(this.draft.selectedZoneIds.includes(zone.id))}
                            ?disabled=${this.busy || (!allowed && !this.draft.selectedZoneIds.includes(zone.id))}
                            @change=${(e: Event) => this.#edit(zone.id, (e.target as HTMLInputElement).checked)}
                        /></label>
                      </td>
                      <th scope="row">${zone.name}</th>
                      <td>
                        ${t(zone.serviceMode === "table_tab" ? "device_zones.floor" : "device_zones.counter")}
                      </td>
                      <td>
                        <label
                          ><input
                            type="radio"
                            name="starting-zone"
                            value=${zone.id}
                            aria-label=${`${t("device_zones.opens_first")} ${zone.name}`}
                            aria-invalid=${startError ? "true" : "false"}
                            aria-describedby=${startError ? "start-error" : nothing}
                            .checked=${live(this.draft.startingZoneId === zone.id)}
                            ?disabled=${this.busy || !allowed || !this.draft.selectedZoneIds.includes(zone.id)}
                            @change=${() => this.#start(zone.id)}
                        /></label>
                      </td>
                    </tr>`;
                  })}
                </tbody>
              </table>`
            : nothing
        }
        <p data-zones-error id="zones-error" ?hidden=${!zonesError}>${zonesError}</p>
        <p data-start-error id="start-error" ?hidden=${!startError}>${startError}</p>
        ${this.readError ? html`<p role="status">${this.readError}</p>` : nothing}
        ${this.readError || this.selection?.zones.length === 0 ? html`<wt-button data-zones-retry variant="secondary" ?disabled=${this.loading || this.busy} @click=${() => this.dispatchEvent(new CustomEvent("retry-device-zones", { bubbles: true, composed: true }))}>${t("find_page.retry")}</wt-button>` : nothing}
        <wt-form-actions
          .error=${correction ? t("form.fix_fields") : refusal ? (refusal.message ?? (refusal.code ? codeMessage(refusal.code) : t("device_zones.write_failed"))) : ""}
        >
          <wt-button
            slot="cancel"
            data-zones-cancel
            variant="secondary"
            ?disabled=${this.busy}
            @click=${() => void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel")}
            >${t("action.cancel")}</wt-button
          >
          <wt-button
            data-zones-save
            variant=${action.variant}
            ?loading=${this.busy}
            ?disabled=${action.unchanged || this.busy || !this.selection || this.selection.zones.length === 0 || correction}
            @click=${() => this.#save()}
            >${t("device_zones.save")}</wt-button
          >
        </wt-form-actions>
      </div>
    </wt-dialog>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "till-device-zones-dialog": DeviceZonesDialog;
  }
}
