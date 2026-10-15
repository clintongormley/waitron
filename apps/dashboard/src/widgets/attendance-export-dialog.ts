import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import type {
  AttendanceExportOptions,
  AttendanceExportSelection,
} from "@waitron/dashboard-modules";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { AttendanceExportApi } from "../api/attendance-export.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";

interface Draft {
  from: string;
  before: string;
  personId: string;
  audience: "standard" | "representatives";
  format: "pdf" | "csv";
}
function validDate(value: string): boolean {
  const instant = Date.parse(`${value}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    Number.isFinite(instant) &&
    new Date(instant).toISOString().slice(0, 10) === value
  );
}
@customElement("dashboard-attendance-export-dialog")
export class AttendanceExportDialog extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this, () => {
      this.#invalidate();
      this.requestUpdate();
    });
  }
  static override styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      .fields {
        display: grid;
        gap: var(--wt-space-3);
        width: var(--wt-form-max-width);
        max-width: 100%;
      }
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) request!: DashboardRequest;
  @property() scopeKey = "";
  @property() mode: "own" | "manager" = "own";
  @property() locationId = "";
  @property({ attribute: false }) period = { start: "", end: "" };
  @property({ attribute: false }) people: readonly { personId: string; displayName: string }[] = [];
  @property() personId?: string;
  @state() private draft: Draft = {
    from: "",
    before: "",
    personId: "",
    audience: "standard",
    format: "pdf",
  };
  @state() private options: AttendanceExportOptions | null = null;
  @state() private busy = false;
  @state() private attempted = false;
  @state() private readError = "";
  @state() private actionError = "";
  @state() private refusals: Record<string, string> = {};
  #opened = false;
  #identity = "";
  #request?: DashboardRequest;
  #period = "";
  #generation = 0;
  #readGeneration = 0;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  #url?: string;
  #binding() {
    return JSON.stringify([
      this.scopeKey,
      this.mode,
      this.locationId,
      this.personId ?? "",
      this.period.start,
      this.period.end,
      currentLocale(),
    ]);
  }
  #invalidate() {
    this.#generation++;
    this.busy = false;
    this.#revoke();
  }
  #revoke() {
    if (this.#url) {
      URL.revokeObjectURL(this.#url);
      this.#url = undefined;
    }
  }
  #release() {
    this.#invalidate();
    this.#readGeneration++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.#opened = false;
    this.options = null;
    this.draft = { from: "", before: "", personId: "", audience: "standard", format: "pdf" };
    this.refusals = {};
    this.actionError = "";
    this.readError = "";
    this.attempted = false;
  }
  override disconnectedCallback(): void {
    this.#release();
    this.open = false;
    super.disconnectedCallback();
  }
  override willUpdate(changed: PropertyValues): void {
    if (!this.isConnected) return;
    if (!this.open) {
      if (this.#opened) this.#release();
      return;
    }
    const identity = JSON.stringify([
      this.scopeKey,
      this.mode,
      this.locationId,
      this.personId ?? "",
    ]);
    if (this.#opened && (identity !== this.#identity || this.request !== this.#request))
      this.#release();
    if (!this.#opened) {
      this.#opened = true;
      this.#identity = identity;
      this.#request = this.request;
      this.#period = JSON.stringify(this.period);
      this.draft = {
        from: this.period.start,
        before: this.period.end,
        personId: this.personId ?? "",
        audience: "standard",
        format: "pdf",
      };
      const { coordinator, scope } = draftScopeFor<Draft>(this, {
        id: this,
        current: () => this.draft,
        snapshot: (v) => ({ ...v }),
        equal: (a, b) =>
          a.from === b.from &&
          a.before === b.before &&
          a.personId === b.personId &&
          a.audience === b.audience &&
          a.format === b.format,
        restore: (value) => {
          this.#invalidate();
          this.draft = { ...value };
        },
      });
      this.#scope = scope;
      this.#leave = coordinator;
      scope.commit({ ...this.draft });
      void this.#loadOptions();
    } else if (JSON.stringify(this.period) !== this.#period) {
      this.#period = JSON.stringify(this.period);
      this.#invalidate();
    }
    if (
      changed.has("people") &&
      this.mode === "manager" &&
      this.draft.personId &&
      !this.people.some((person) => person.personId === this.draft.personId)
    )
      this.#invalidate();
  }
  async #loadOptions() {
    if (!this.scopeKey || !this.locationId || typeof this.request !== "function") return;
    const generation = ++this.#readGeneration,
      request = this.request,
      locationId = this.locationId;
    this.readError = "";
    try {
      const options = await new AttendanceExportApi(request).options(locationId);
      if (
        !this.isConnected ||
        !this.open ||
        generation !== this.#readGeneration ||
        request !== this.request ||
        locationId !== this.locationId
      )
        return;
      this.options = options;
      this.readError = "";
    } catch (error) {
      if (this.isConnected && this.open && generation === this.#readGeneration)
        this.readError = codeMessage(codeOf(error));
    }
  }
  #errors(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!validDate(this.draft.from)) errors.from = t("attendance_export.invalid_date");
    if (!validDate(this.draft.before)) errors.before = t("attendance_export.invalid_date");
    if (!errors.from && !errors.before && this.draft.from >= this.draft.before)
      errors.from = errors.before = t("attendance_export.invalid_range");
    if (
      this.mode === "manager" &&
      this.draft.personId &&
      !this.people.some((p) => p.personId === this.draft.personId)
    )
      errors.personId = t("attendance_export.invalid_person");
    if (this.draft.audience !== "standard" && this.draft.audience !== "representatives")
      errors.audience = t("attendance_export.invalid_choice");
    if (this.draft.format !== "pdf" && this.draft.format !== "csv")
      errors.format = t("attendance_export.invalid_choice");
    return errors;
  }
  #change(event: CustomEvent<{ value: string }>, key: keyof Draft) {
    event.stopPropagation();
    this.#invalidate();
    this.draft = { ...this.draft, [key]: event.detail.value };
    const refusals = { ...this.refusals };
    delete refusals[key];
    this.refusals = refusals;
    this.actionError = "";
    this.#scope?.changed();
  }
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#leave ||
    (await this.#leave.request({ scopes: [this], reason, proceed() {} })) === "proceeded";
  #close() {
    this.#release();
    this.open = false;
    this.dispatchEvent(new CustomEvent("export-close", { bubbles: true, composed: true }));
  }
  async #download() {
    if (
      !this.open ||
      !this.isConnected ||
      this.busy ||
      !this.options?.available ||
      (this.mode === "manager" && !this.options.canExportAll)
    )
      return;
    this.attempted = true;
    this.refusals = {};
    this.actionError = "";
    if (Object.keys(this.#errors()).length) {
      await this.updateComplete;
      focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const sent = { ...this.draft };
    const selection: AttendanceExportSelection = {
      locationId: this.locationId,
      from: sent.from,
      before: sent.before,
      format: sent.format,
      audience: sent.audience,
      locale: currentLocale().startsWith("es") ? "es" : "en",
    };
    const generation = ++this.#generation,
      binding = this.#binding(),
      request = this.request;
    const current = () =>
      this.isConnected &&
      this.open &&
      generation === this.#generation &&
      binding === this.#binding() &&
      request === this.request &&
      Object.keys(this.#errors()).length === 0;
    this.busy = true;
    try {
      const api = new AttendanceExportApi(request);
      const file = await (this.mode === "own"
        ? api.own(selection)
        : api.manager({ ...selection, ...(sent.personId ? { personId: sent.personId } : {}) }));
      if (!current()) return;
      this.#url = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = this.#url;
      anchor.download = `time-record-${selection.from}-${selection.before}-${selection.audience}.${selection.format}`;
      anchor.click();
      if (current()) this.#scope?.commit(sent);
    } catch (error) {
      if (!current()) return;
      const field = (error as { params?: { field?: string } } | null)?.params?.field;
      if (field && ["from", "before", "personId", "audience", "format"].includes(field))
        this.refusals = { [field]: codeMessage(codeOf(error)) };
      else this.actionError = codeMessage(codeOf(error));
    } finally {
      if (current()) this.busy = false;
      this.#revoke();
    }
  }
  override render() {
    const ownErrors = this.attempted ? this.#errors() : {};
    const errors = { ...ownErrors, ...this.refusals };
    const ready =
      !!this.scopeKey &&
      !!this.request &&
      !!this.locationId &&
      this.options?.available &&
      (this.mode === "own" || this.options.canExportAll);
    const bottom = [
      this.actionError,
      this.readError,
      Object.keys(errors).length ? t("form.fix_fields") : "",
      this.options && !this.options.available ? t("attendance_export.unavailable") : "",
    ]
      .filter(Boolean)
      .join(" ");
    const dialog = () => this.shadowRoot!.querySelector<WtDialog>("wt-dialog");
    return html`<wt-dialog
      .open=${this.open}
      heading=${t("attendance_export.heading")}
      .beforeClose=${this.#beforeClose}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#close();
      }}
    >
      ${
        this.open
          ? html`<div
              class="fields"
              @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=export-download]"))}
            >
              <wt-input
                name="exportFrom"
                type="date"
                required
                label=${t("attendance_export.from")}
                .value=${this.draft.from}
                .error=${errors.from ?? ""}
                ?disabled=${this.busy}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#change(e, "from")}
              ></wt-input>
              <wt-input
                name="exportBefore"
                type="date"
                required
                label=${t("attendance_export.before")}
                .value=${this.draft.before}
                .error=${errors.before ?? ""}
                ?disabled=${this.busy}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#change(e, "before")}
              ></wt-input>
              <p>${t("attendance_export.range_note")}</p>
              ${this.mode === "manager" ? html`<wt-combobox name="exportPerson" label=${t("attendance_export.person")} .value=${this.draft.personId} .options=${[{ value: "", label: t("attendance_export.everyone") }, ...this.people.map((p) => ({ value: p.personId, label: p.displayName }))]} .error=${errors.personId ?? ""} ?disabled=${this.busy} @wt-change=${(e: CustomEvent<{ value: string }>) => this.#change(e, "personId")}></wt-combobox>` : nothing}
              <wt-combobox
                name="exportAudience"
                required
                label=${t("attendance_export.audience")}
                .value=${this.draft.audience}
                .options=${[
                  { value: "standard", label: t("attendance_export.standard") },
                  { value: "representatives", label: t("attendance_export.representatives") },
                ]}
                .error=${errors.audience ?? ""}
                ?disabled=${this.busy}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#change(e, "audience")}
              ></wt-combobox>
              ${this.draft.audience === "representatives" ? html`<p>${t("attendance_export.representatives_note")}</p>` : nothing}
              <wt-combobox
                name="exportFormat"
                required
                label=${t("attendance_export.format")}
                .value=${this.draft.format}
                .options=${[
                  { value: "pdf", label: "PDF" },
                  { value: "csv", label: "CSV" },
                ]}
                .error=${errors.format ?? ""}
                ?disabled=${this.busy}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#change(e, "format")}
              ></wt-combobox>
              ${this.readError ? html`<wt-button variant="secondary" @click=${() => void this.#loadOptions()}>${t("attendance_export.retry_options")}</wt-button>` : nothing}
            </div>`
          : nothing
      }
      <wt-form-actions slot="footer" .error=${bottom}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="export-cancel"
          @click=${() => void dialog()?.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="export-download"
          variant=${ready ? "primary" : "secondary"}
          ?loading=${this.busy}
          ?disabled=${!ready || Object.keys(ownErrors).length > 0}
          @click=${() => void this.#download()}
          >${t("attendance_export.download")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}
