import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "./service-settings-fields.js";
import type { ServiceSettingsValue } from "./service-settings-fields.js";
import type {
  DepartmentSettingsInput,
  DepartmentTransfersView,
  VenueServiceApi,
  VenueServiceView,
} from "./client.js";
import { t } from "./strings.js";
import { format } from "./hours-view.js";

type Field = keyof DepartmentSettingsInput | "receivingProfileId" | "destinationDepartmentIds";
const copy = (value: DepartmentSettingsInput): DepartmentSettingsInput => ({
  ...value,
  ...(value.transfers
    ? {
        transfers: {
          ...value.transfers,
          destinationDepartmentIds: [...value.transfers.destinationDepartmentIds],
        },
      }
    : {}),
});
const equal = (a: DepartmentSettingsInput, b: DepartmentSettingsInput) =>
  a.name.trim() === b.name.trim() &&
  a.tradingName.trim() === b.tradingName.trim() &&
  a.orderStart === b.orderStart &&
  a.paidWhen === b.paidWhen &&
  a.collectionNumber === b.collectionNumber &&
  a.receiptPrintMode === b.receiptPrintMode &&
  a.printTradingName === b.printTradingName &&
  a.transfers?.receivingProfileId === b.transfers?.receivingProfileId &&
  (a.transfers?.destinationDepartmentIds.length ?? 0) ===
    (b.transfers?.destinationDepartmentIds.length ?? 0) &&
  (a.transfers?.destinationDepartmentIds ?? []).every((id) =>
    b.transfers?.destinationDepartmentIds.includes(id),
  );

@customElement("department-settings")
export class DepartmentSettings extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .form {
        display: grid;
        gap: var(--wt-space-5);
        max-width: var(--wt-form-max-width);
      }
      section {
        display: grid;
        gap: var(--wt-space-4);
        min-width: 0;
      }
      h2,
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
      h2 {
        font-size: var(--wt-font-size-lg);
      }
      a {
        color: var(--wt-color-primary-text);
      }
      a:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      fieldset {
        margin: 0;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        padding: var(--wt-space-3);
        min-width: 0;
      }
      legend {
        padding-inline: var(--wt-space-1);
      }
      .destination {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        overflow-wrap: anywhere;
      }
      input {
        accent-color: var(--wt-color-primary);
      }
      .error {
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
      .readonly {
        color: var(--wt-color-text-muted);
      }
    `,
  ];
  @property({ attribute: false }) api?: VenueServiceApi;
  @property({ attribute: false }) model?: VenueServiceView;
  @property() departmentId = "";
  @property({ type: Boolean }) showEnable = true;
  @state() private draft?: DepartmentSettingsInput;
  @state() private busy = false;
  @state() private attempted = false;
  @state() private refused: Partial<Record<Field, string>> = {};
  @state() private failure = "";
  @state() private transferFailure = "";
  @state() private profiles: DepartmentTransfersView["profiles"] = [];
  @state() private clash?: { id: string; name: string };
  private opened = "";
  private baseline?: DepartmentSettingsInput;
  private scope?: DraftScope<DepartmentSettingsInput>;
  private leave?: LeaveCoordinator;
  private generation = {};
  private transferGeneration = {};
  private source?: DepartmentSettingsInput;
  private transferLoading = false;
  private transfersLoaded = false;
  private transfersShown = false;
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback() {
    this.scope?.dispose();
    this.scope = undefined;
    this.leave = undefined;
    this.generation = {};
    this.transferGeneration = {};
    this.busy = false;
    this.transferLoading = false;
    super.disconnectedCallback();
  }
  private get department() {
    return this.model?.departments.find((d) => d.id === this.departmentId);
  }
  private get showsTransfers() {
    return (this.model?.departments.filter((d) => d.active).length ?? 0) >= 2;
  }
  protected override willUpdate() {
    const row = this.department;
    if (!row) return;
    const policy = this.model!.salePolicies.departments.find((p) => p.departmentId === row.id);
    const source: DepartmentSettingsInput = {
      name: row.name,
      tradingName: row.tradingName,
      orderStart:
        policy?.orderStart ?? (row.defaultServiceMode === "table_tab" ? "table" : "counter"),
      paidWhen:
        policy?.paidWhen ??
        (row.defaultServiceMode === "ticket_then_pay" ? "ticket_then_pay" : "prepay"),
      collectionNumber: policy?.collectionNumber ?? "none",
      receiptPrintMode: policy?.receiptPrintMode ?? "auto",
      printTradingName: policy?.printTradingName ?? false,
    };
    if (this.opened !== row.id) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.opened = row.id;
      this.generation = {};
      this.transferGeneration = {};
      this.busy = false;
      this.attempted = false;
      this.refused = {};
      this.failure = "";
      this.clash = undefined;
      this.transferFailure = "";
      this.profiles = [];
      this.transferLoading = false;
      this.transfersLoaded = false;
      this.transfersShown = false;
      this.draft = copy(source);
      this.source = copy(source);
      this.baseline = copy(this.draft);
    }
    if (this.transfersShown !== this.showsTransfers) {
      this.transfersShown = this.showsTransfers;
      this.transfersLoaded = false;
      this.transferLoading = false;
      this.transferFailure = "";
      this.profiles = [];
      this.transferGeneration = {};
      if (!this.showsTransfers) {
        delete this.draft!.transfers;
        delete this.baseline!.transfers;
        this.scope?.commit(this.baseline!);
      }
    }
    if (this.isConnected && !this.scope) {
      const { coordinator, scope } = draftScopeFor(this, {
        id: this,
        current: () => this.draft!,
        snapshot: copy,
        equal,
        restore: (value) => {
          this.draft = copy(value);
          this.attempted = false;
          this.refused = {};
          this.failure = "";
          this.clash = undefined;
        },
      });
      this.scope = scope;
      this.leave = coordinator;
      scope.commit(this.baseline!);
    }
    if (this.scope && !this.scope.isDirty() && !this.busy && !equal(this.source!, source)) {
      this.source = copy(source);
      this.draft = {
        ...source,
        ...(this.draft!.transfers ? { transfers: this.draft!.transfers } : {}),
      };
      this.baseline = copy(this.draft);
      this.scope.commit(this.baseline);
    }
    if (
      this.isConnected &&
      this.showsTransfers &&
      !this.transfersLoaded &&
      !this.transferLoading &&
      this.api
    )
      void this.loadTransfers(row.id, this.transferGeneration);
  }
  private current(id: string, generation: object) {
    return this.isConnected && this.departmentId === id && this.generation === generation;
  }
  private async loadTransfers(id: string, generation: object) {
    this.transferLoading = true;
    try {
      const settings = await this.api!.background.loadDepartmentTransfers(id);
      if (this.isConnected && this.departmentId === id && this.transferGeneration === generation) {
        const transfers = {
          receivingProfileId: settings.receivingProfileId,
          destinationDepartmentIds: [...settings.destinationDepartmentIds],
        };
        this.draft = { ...this.draft!, transfers };
        this.baseline = {
          ...this.baseline!,
          transfers: copy({ ...this.baseline!, transfers }).transfers,
        };
        this.scope?.commit(this.baseline);
        this.profiles = settings.profiles;
        this.transferFailure = "";
        this.transfersLoaded = true;
      }
    } catch {
      if (this.isConnected && this.departmentId === id && this.transferGeneration === generation) {
        this.transferFailure = t("venue.transfers_load_error");
        this.transfersLoaded = true;
      }
    } finally {
      if (this.isConnected && this.departmentId === id && this.transferGeneration === generation) {
        this.transferLoading = false;
        this.requestUpdate();
      }
    }
  }
  private emit(name: string, detail: object) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  private changed(field: Field, value: unknown) {
    if (this.busy || !this.department?.active) return;
    if (field === "receivingProfileId")
      this.draft = {
        ...this.draft!,
        transfers: { ...this.draft!.transfers!, receivingProfileId: (value as string) || null },
      };
    else if (field === "destinationDepartmentIds")
      this.draft = {
        ...this.draft!,
        transfers: { ...this.draft!.transfers!, destinationDepartmentIds: value as string[] },
      };
    else this.draft = { ...this.draft!, [field]: value };
    const refused = { ...this.refused };
    delete refused[field];
    this.refused = refused;
    if (field === "name") this.clash = undefined;
    this.scope?.changed();
  }
  private get errors(): Partial<Record<Field, string>> {
    return this.draft?.name.trim() ? {} : { name: t("venue.field_required") };
  }
  private fieldRefusal(error: unknown) {
    const { code, params } = (error ?? {}) as { code?: string; params?: Record<string, unknown> };
    let field: Field | undefined;
    let message = t("venue.field_refused");
    const fields: Field[] = [
      "name",
      "tradingName",
      "orderStart",
      "paidWhen",
      "collectionNumber",
      "receiptPrintMode",
      "printTradingName",
      ...(this.draft?.transfers
        ? (["receivingProfileId", "destinationDepartmentIds"] as const)
        : []),
    ];
    if (code === "management.request_invalid" && fields.includes(params?.field as Field))
      field = params!.field as Field;
    if (code === "department.name_taken" || code === "department.name_disabled") {
      field = "name";
      message = t(
        code === "department.name_disabled"
          ? "venue.department_name_disabled"
          : "venue.department_name_taken",
      );
      if (
        code === "department.name_disabled" &&
        typeof params?.departmentId === "string" &&
        typeof params.name === "string"
      )
        this.clash = { id: params.departmentId, name: params.name };
    }
    if (
      code === "department_transfer.settings_invalid" &&
      this.draft?.transfers &&
      (params?.field === "receivingProfileId" || params?.field === "destinationDepartmentIds")
    ) {
      field = params.field;
      message = t(
        field === "receivingProfileId"
          ? "venue.transfer_profile_refused"
          : "venue.transfer_destinations_refused",
      );
    }
    if (field) {
      this.refused = { [field]: message };
      void this.updateComplete.then(() => {
        if (this.isConnected) focusFirstInvalid(this.shadowRoot!);
      });
    } else this.failure = t("venue.save_error");
  }
  private async save() {
    const id = this.departmentId,
      generation = this.generation;
    if (
      !this.isConnected ||
      this.busy ||
      !this.department?.active ||
      saveActionState(this.scope).unchanged
    )
      return;
    this.attempted = true;
    this.refused = {};
    this.failure = "";
    this.clash = undefined;
    if (Object.keys(this.errors).length) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    if (!this.api) return;
    const submitted = copy(this.draft!);
    submitted.name = submitted.name.trim();
    submitted.tradingName = submitted.tradingName.trim();
    if (!this.showsTransfers) delete submitted.transfers;
    this.busy = true;
    try {
      await this.api.saveDepartmentSettings(id, submitted);
      if (this.current(id, generation)) {
        const committed = copy(submitted);
        if (!this.showsTransfers) delete committed.transfers;
        this.baseline = committed;
        this.scope?.commit(committed);
        this.emit("saved", { departmentId: id });
      }
    } catch (error) {
      if (this.current(id, generation)) this.fieldRefusal(error);
    } finally {
      if (this.current(id, generation)) this.busy = false;
    }
  }
  private async cancel() {
    if (this.busy || !this.scope) return;
    const id = this.departmentId,
      generation = this.generation;
    const proceed = () => {
      if (this.current(id, generation)) {
        this.draft = copy(this.baseline!);
        this.attempted = false;
        this.refused = {};
        this.failure = "";
        this.clash = undefined;
        this.emit("cancelled", { departmentId: id });
      }
    };
    if (this.leave)
      await this.leave.request({ scopes: [this.scope.id], reason: "cancel", proceed });
    else proceed();
  }
  private get differing() {
    const draft = this.draft!;
    const fields = ["orderStart", "paidWhen", "collectionNumber", "receiptPrintMode"] as const;
    return (this.model?.zones ?? [])
      .filter((z) => z.departmentId === this.departmentId)
      .flatMap((zone) => {
        const overrides = this.model!.salePolicies.zones.find((p) => p.zoneId === zone.id);
        if (!overrides) return [];
        const labels = fields
          .filter((field) => overrides[field] !== null && overrides[field] !== draft[field])
          .map((field) => {
            switch (field) {
              case "orderStart":
                return t(
                  overrides.orderStart === "counter"
                    ? "venue.counter_service"
                    : "venue.table_service",
                );
              case "paidWhen":
                return t(
                  overrides.paidWhen === "prepay"
                    ? "venue.paid_before_preparation"
                    : "venue.paid_at_collection",
                );
              case "collectionNumber":
                return t(
                  overrides.collectionNumber === "numbered" ? "venue.print" : "venue.dont_print",
                );
              case "receiptPrintMode":
                return t(
                  overrides.receiptPrintMode === "auto"
                    ? "venue.always"
                    : "venue.receipt_on_request",
                );
            }
          });
        return labels.length ? [{ zone, labels }] : [];
      });
  }
  override render() {
    const row = this.department,
      draft = this.draft;
    if (!row || !draft) return nothing;
    const errors = { ...(this.attempted ? this.errors : {}), ...this.refused },
      disabled = this.busy || !row.active,
      state = saveActionState(this.scope);
    const serviceErrors: Partial<Record<keyof ServiceSettingsValue, string>> = {};
    for (const field of ["orderStart", "paidWhen", "collectionNumber", "receiptPrintMode"] as const)
      if (errors[field]) serviceErrors[field] = errors[field];
    return html`<div
      class="form"
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=save-editor]"))}
    >
      ${
        !row.active
          ? html`<p class="readonly">${t("venue.enable_department_settings")}</p>
              ${this.showEnable ? html`<wt-button data-test="enable-department" @click=${() => this.emit("enable-department", { departmentId: row.id })}>${t("venue.enable")}</wt-button>` : nothing}`
          : nothing
      }
      <wt-input
        name="name"
        label=${t("venue.name")}
        required
        .value=${draft.name}
        error=${errors.name ?? ""}
        ?disabled=${disabled}
        @wt-change=${(e: CustomEvent<{ value: string }>) => {
          e.stopPropagation();
          this.changed("name", e.detail.value);
        }}
      ></wt-input>
      ${this.clash ? html`<wt-button variant="secondary" data-test="enable-name-clash" ?disabled=${this.busy} @click=${() => this.emit("enable-department", { departmentId: this.clash!.id })}>${format("venue.enable_name", { name: this.clash.name })}</wt-button>` : nothing}
      <section aria-label=${t("venue.service_settings")}>
        <h2>${t("venue.service_settings")}</h2>
        <dashboard-service-settings-fields
          .value=${draft}
          .errors=${serviceErrors}
          ?disabled=${disabled}
          @service-settings-change=${(e: CustomEvent<{ value: ServiceSettingsValue }>) => {
            e.stopPropagation();
            for (const field of [
              "orderStart",
              "paidWhen",
              "collectionNumber",
              "receiptPrintMode",
            ] as const)
              this.changed(field, e.detail.value[field]);
          }}
        ></dashboard-service-settings-fields>
        ${
          this.differing.length
            ? html`<p data-test="zones-that-differ">
                ${t("venue.zones_that_differ")}:
                ${this.differing.map(
                  ({ zone, labels }, index) =>
                    html`${index ? ", " : nothing}<a
                        data-zone=${zone.id}
                        href=${`/manage/venue-operations/department/${encodeURIComponent(row.id)}/view/zones/zone/${encodeURIComponent(zone.id)}`}
                        @click=${(e: MouseEvent) => {
                          if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                          e.preventDefault();
                          this.emit("zone-change", { zoneId: zone.id });
                        }}
                        >${zone.name} (${labels.join(", ")})</a
                      >`,
                )}
              </p>`
            : nothing
        }
      </section>
      <section aria-label=${t("venue.on_receipt")}>
        <h2>${t("venue.on_receipt")}</h2>
        <wt-input
          name="tradingName"
          label=${t("venue.trading_name")}
          .value=${draft.tradingName}
          error=${errors.tradingName ?? ""}
          ?disabled=${disabled}
          @wt-change=${(e: CustomEvent<{ value: string }>) => {
            e.stopPropagation();
            this.changed("tradingName", e.detail.value);
          }}
        ></wt-input>
        <div>
          <wt-switch
            name="printTradingName"
            label=${t("venue.print_trading_name")}
            .checked=${draft.printTradingName}
            ?disabled=${disabled}
            @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
              e.stopPropagation();
              this.changed("printTradingName", e.detail.checked);
            }}
          ></wt-switch
          >${errors.printTradingName ? html`<p class="error" data-field-error="printTradingName">${errors.printTradingName}</p>` : nothing}
        </div>
        <a
          data-test="edit-receipt"
          href=${`/manage/venue-settings/view/receipts?departmentId=${encodeURIComponent(row.id)}`}
          >${t("venue.edit_receipt")}</a
        >
      </section>
      ${
        this.showsTransfers
          ? html`<section data-test="transfers-section" aria-label=${t("venue.tab_transfers")}>
              <h2>${t("venue.tab_transfers")}</h2>
              ${
                this.transferFailure
                  ? html`<p class="error" data-test="transfers-load-error" role="alert">
                      ${this.transferFailure}
                    </p>`
                  : draft.transfers
                    ? html` <fieldset ?disabled=${disabled}>
                          <legend>${t("venue.transfer_destinations")}</legend>
                          ${this.model!.departments.filter((d) => d.active && d.id !== row.id).map(
                            (d) =>
                              html`<label class="destination"
                                ><input
                                  type="checkbox"
                                  name=${`transferDestination-${d.id}`}
                                  .checked=${draft.transfers!.destinationDepartmentIds.includes(d.id)}
                                  @change=${(e: Event) => {
                                    e.stopPropagation();
                                    const checked = (e.target as HTMLInputElement).checked;
                                    this.changed(
                                      "destinationDepartmentIds",
                                      checked
                                        ? [...draft.transfers!.destinationDepartmentIds, d.id]
                                        : draft.transfers!.destinationDepartmentIds.filter(
                                            (id) => id !== d.id,
                                          ),
                                    );
                                  }}
                                />${d.name}</label
                              >`,
                          )}${errors.destinationDepartmentIds ? html`<p class="error" data-field-error="destinationDepartmentIds">${errors.destinationDepartmentIds}</p>` : nothing}
                        </fieldset>
                        <wt-combobox
                          name="receivingProfileId"
                          label=${t("venue.receiving_profile")}
                          search="never"
                          .options=${[{ value: "", label: t("venue.none") }, ...this.profiles.map((p) => ({ value: p.id, label: p.name })), ...(draft.transfers.receivingProfileId && !this.profiles.some((p) => p.id === draft.transfers!.receivingProfileId) ? [{ value: draft.transfers.receivingProfileId, label: t("venue.transfer_profile_unavailable") }] : [])]}
                          .value=${draft.transfers.receivingProfileId ?? ""}
                          error=${errors.receivingProfileId ?? ""}
                          ?disabled=${disabled}
                          @wt-change=${(e: CustomEvent<{ value: string }>) => {
                            e.stopPropagation();
                            this.changed("receivingProfileId", e.detail.value);
                          }}
                        ></wt-combobox>`
                    : nothing
              }
            </section>`
          : nothing
      }
      ${row.active ? html`<wt-form-actions .error=${[this.failure, Object.keys(errors).length ? t("venue.fix_fields") : ""].filter(Boolean).join(" ")}><wt-button slot="cancel" variant="secondary" data-test="cancel-editor" ?disabled=${this.busy} @click=${() => void this.cancel()}>${t("venue.cancel")}</wt-button><wt-button data-test="save-editor" variant=${state.variant} ?disabled=${this.busy || state.unchanged || (this.attempted && Object.keys(this.errors).length > 0)} @click=${() => void this.save()}>${t("venue.save")}</wt-button></wt-form-actions>` : nothing}
    </div>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "department-settings": DepartmentSettings;
  }
}
