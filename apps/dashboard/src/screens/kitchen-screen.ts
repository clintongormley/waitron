import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  focusFirstInvalid,
  submitOnEnter,
  leaveCoordinatorFor,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import { live } from "lit/directives/live.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "../widgets/course-list.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { BumpMode, DashboardApi, FireControl, KitchenTimingDefaults } from "../api/client.js";

const TIMING_FIELDS = ["warmAfterMinutes", "overdueAfterMinutes", "forgottenAfterMinutes"] as const;
type TimingField = (typeof TIMING_FIELDS)[number];
type TimingSnapshot = Record<TimingField, string | number>;
const TIMING_LABELS = {
  warmAfterMinutes: "kitchen.station_warm",
  overdueAfterMinutes: "kitchen.station_overdue",
  forgottenAfterMinutes: "kitchen.station_forgotten",
} as const;

@customElement("dashboard-kitchen-screen")
export class KitchenScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .panel-title {
        margin: 0 0 var(--wt-space-3);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      .bump {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-6);
        color: var(--wt-color-text);
      }
      .bump-options {
        display: flex;
        gap: var(--wt-space-2);
      }
      .timing > wt-button {
        align-self: flex-start;
      }
      .timing-values {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }
      .timing-form {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
        max-width: var(--wt-form-max-width);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) readOnly = false;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => this.#showReadError(error),
    () => {
      if (this.#readErrorShown) this.#showError(null);
    },
  );

  @state() private timing?: KitchenTimingDefaults;
  @state() private timingDraft?: Record<TimingField, string>;
  @state() private timingAttempted = false;
  @state() private timingSaving = false;
  @state() private timingRefusals: Partial<Record<TimingField, string>> = {};
  @state() private timingSaveError = "";
  #timingScope?: DraftScope<TimingSnapshot>;
  #timingIdentity?: object;
  #leave?: LeaveCoordinator;

  @state() private bumpMode: BumpMode = "line";
  @state() private fireControl: FireControl = "waiter";
  @state() private errorKey: string | null = null;
  /** Whether `errorKey` is a read's failure, the only message the reads' recovery may clear. */
  #readErrorShown = false;

  #showError(code: string | null, fromRead = false): void {
    this.errorKey = code;
    this.#readErrorShown = fromRead;
  }

  /** A read's failure never replaces an action's message. */
  #showReadError(error: unknown): void {
    if (this.errorKey === null || this.#readErrorShown) this.#showError(codeOf(error), true);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  override disconnectedCallback(): void {
    this.#closeTiming();
    this.timingSaving = false;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  #timingValue(): TimingSnapshot {
    const value = (field: TimingField): string | number => {
      const raw = this.timingDraft![field];
      const number = Number(raw);
      return raw.trim() !== "" && Number.isInteger(number) && number >= 1 && number <= 2_147_483_647
        ? number
        : raw;
    };
    return {
      warmAfterMinutes: value("warmAfterMinutes"),
      overdueAfterMinutes: value("overdueAfterMinutes"),
      forgottenAfterMinutes: value("forgottenAfterMinutes"),
    };
  }

  #sameTiming(a: TimingSnapshot, b: TimingSnapshot): boolean {
    return TIMING_FIELDS.every((field) => a[field] === b[field]);
  }

  #timingCurrent(identity: object | undefined): boolean {
    return this.isConnected && identity === this.#timingIdentity;
  }

  #closeTiming(): void {
    this.#timingScope?.dispose();
    this.#timingScope = undefined;
    this.#timingIdentity = undefined;
    this.timingDraft = undefined;
  }

  #cancelTiming(reason: LeaveReason, identity: object | undefined): void {
    if (!this.#timingCurrent(identity) || this.timingSaving) return;
    const proceed = () => {
      if (this.#timingCurrent(identity) && !this.timingSaving) this.#closeTiming();
    };
    if (!this.#timingScope) proceed();
    else void this.#leave!.request({ scopes: [this.#timingScope.id], reason, proceed });
  }

  async #load(): Promise<void> {
    this.#showError(null);
    await Promise.all([
      this.#loadTiming(),
      this.#queries
        .watch("getBumpMode", [], (bump) => {
          this.bumpMode = bump.mode;
        })
        .catch((error: unknown) => this.#showReadError(error)),
      this.#queries
        .watch("getFireControl", [], (fire) => {
          this.fireControl = fire.mode;
        })
        .catch((error: unknown) => this.#showReadError(error)),
    ]);
  }

  async #loadTiming(): Promise<void> {
    try {
      await this.#queries.watch("getKitchenTimingDefaults", [], (value) => {
        this.timing = value;
      });
    } catch (error) {
      this.#showReadError(error);
    }
  }

  #openTiming(): void {
    if (!this.timing || this.readOnly || this.timingDraft) return;
    this.timingDraft = {
      warmAfterMinutes: String(this.timing.warmAfterMinutes),
      overdueAfterMinutes: String(this.timing.overdueAfterMinutes),
      forgottenAfterMinutes: String(this.timing.forgottenAfterMinutes),
    };
    this.timingAttempted = false;
    this.timingRefusals = {};
    this.timingSaveError = "";
    const id = (this.#timingIdentity = {});
    this.#leave ??= leaveCoordinatorFor(this);
    this.#timingScope = this.#leave?.register({
      id,
      parent: this,
      current: () => this.#timingValue(),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => this.#sameTiming(a, b),
      restore: (value) => {
        this.timingDraft = {
          warmAfterMinutes: String(value.warmAfterMinutes),
          overdueAfterMinutes: String(value.overdueAfterMinutes),
          forgottenAfterMinutes: String(value.forgottenAfterMinutes),
        };
        this.timingAttempted = false;
        this.timingRefusals = {};
        this.timingSaveError = "";
      },
    });
  }

  #timingErrors(): Partial<Record<TimingField, string>> {
    const draft = this.timingDraft;
    if (!draft) return {};
    const errors: Partial<Record<TimingField, string>> = {};
    for (const field of TIMING_FIELDS) {
      const value = Number(draft[field]);
      if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647)
        errors[field] = t("kitchen.timing_positive");
    }
    if (
      !errors.warmAfterMinutes &&
      !errors.overdueAfterMinutes &&
      Number(draft.overdueAfterMinutes) <= Number(draft.warmAfterMinutes)
    )
      errors.overdueAfterMinutes = t("kitchen.timing_after_warm");
    if (
      !errors.overdueAfterMinutes &&
      !errors.forgottenAfterMinutes &&
      Number(draft.forgottenAfterMinutes) <= Number(draft.overdueAfterMinutes)
    )
      errors.forgottenAfterMinutes = t("kitchen.timing_after_overdue");
    return errors;
  }

  async #saveTiming(identity: object | undefined): Promise<void> {
    const draft = this.timingDraft;
    if (!this.#timingCurrent(identity) || !draft || this.timingSaving || this.readOnly) return;
    this.timingAttempted = true;
    this.timingRefusals = {};
    this.timingSaveError = "";
    if (Object.keys(this.#timingErrors()).length) {
      await this.updateComplete;
      await focusFirstInvalid(
        this.renderRoot.querySelector<HTMLElement>('[data-test="timing-form"]')!,
      );
      return;
    }
    this.timingSaving = true;
    const scope = this.#timingScope;
    const submitted = {
      warmAfterMinutes: Number(draft.warmAfterMinutes),
      overdueAfterMinutes: Number(draft.overdueAfterMinutes),
      forgottenAfterMinutes: Number(draft.forgottenAfterMinutes),
    };
    scope?.changed();
    try {
      await this.api.setKitchenTimingDefaults(submitted);
      if (!this.#timingCurrent(identity)) return;
      scope?.commit(submitted);
    } catch (error) {
      if (!this.#timingCurrent(identity)) return;
      const code = codeOf(error);
      const params = (error as { params?: { field?: unknown; name?: unknown } } | null)?.params;
      const field = TIMING_FIELDS.find((field) => field === params?.field);
      const message =
        code === "station.thresholds_invalid" && typeof params?.name === "string"
          ? t("kitchen.timing_station_invalid").replace("{name}", params.name)
          : code === "management.request_invalid" && field
            ? t("kitchen.timing_positive")
            : codeMessage(code);
      if (field) this.timingRefusals = { [field]: message };
      else this.timingSaveError = message;
      await this.updateComplete;
      if (field && this.#timingCurrent(identity))
        await focusFirstInvalid(
          this.renderRoot.querySelector<HTMLElement>('[data-test="timing-form"]')!,
        );
      return;
    } finally {
      if (this.#timingCurrent(identity)) this.timingSaving = false;
    }
    if (this.#sameTiming(this.#timingValue(), submitted)) this.#closeTiming();
    await this.#loadTiming();
  }

  #timingPanel(): TemplateResult {
    const identity = this.#timingIdentity;
    const errors = {
      ...this.timingRefusals,
      ...(this.timingAttempted ? this.#timingErrors() : {}),
    };
    const localInvalid = this.timingAttempted && Object.keys(this.#timingErrors()).length > 0;
    const message = [Object.keys(errors).length ? t("form.fix_fields") : "", this.timingSaveError]
      .filter(Boolean)
      .join(" ");
    return html`<section class="bump timing" aria-labelledby="timing-title">
      <h2 id="timing-title" class="panel-title">${t("kitchen.timing_title")}</h2>
      ${
        this.timingDraft
          ? html`<div
              class="timing-form"
              data-test="timing-form"
              @keydown=${(event: KeyboardEvent) => {
                if (!this.#timingCurrent(identity)) return;
                if (event.key === "Escape" && !this.timingSaving) {
                  event.preventDefault();
                  event.stopPropagation();
                  this.#cancelTiming("escape", identity);
                } else
                  submitOnEnter(event, this.renderRoot.querySelector('[data-test="save-timing"]'));
              }}
            >
              ${TIMING_FIELDS.map(
                (field) =>
                  html`<wt-input
                    name=${field}
                    label=${t(TIMING_LABELS[field])}
                    type="number"
                    required
                    .value=${live(this.timingDraft![field])}
                    .error=${errors[field] ?? ""}
                    ?disabled=${this.timingSaving}
                    @wt-change=${(event: CustomEvent<{ value: string }>) => {
                      event.stopPropagation();
                      if (!this.#timingCurrent(identity)) return;
                      this.timingDraft = { ...this.timingDraft!, [field]: event.detail.value };
                      this.#timingScope?.changed();
                      const refusals = { ...this.timingRefusals };
                      delete refusals[field];
                      this.timingRefusals = refusals;
                    }}
                  ></wt-input>`,
              )}
              <wt-form-actions .error=${message}>
                <wt-button
                  slot="cancel"
                  variant="secondary"
                  data-test="cancel-timing"
                  ?disabled=${this.timingSaving}
                  @click=${() => this.#cancelTiming("cancel", identity)}
                  >${t("action.cancel")}</wt-button
                >
                <wt-button
                  data-test="save-timing"
                  ?disabled=${this.timingSaving || localInvalid}
                  @click=${() => void this.#saveTiming(identity)}
                  >${t("action.save")}</wt-button
                >
              </wt-form-actions>
            </div>`
          : this.timing
            ? html`
                <div class="timing-values" data-test="timing-values">
                  ${TIMING_FIELDS.map((field) => html`<span>${t(TIMING_LABELS[field])}: ${this.timing![field]}</span>`)}
                </div>
                ${this.readOnly ? nothing : html`<wt-button variant="secondary" data-test="edit-timing" @click=${() => this.#openTiming()}>${t("kitchen.timing_edit")}</wt-button>`}
              `
            : html`<p role="status">${t("kitchen.timing_loading")}</p>`
      }
    </section>`;
  }

  async #setBump(mode: BumpMode): Promise<void> {
    this.#showError(null);
    this.bumpMode = mode;
    try {
      await this.api.setBumpMode(mode);
    } catch (error) {
      this.#showError(codeOf(error));
    }
  }

  async #setFire(mode: FireControl): Promise<void> {
    this.#showError(null);
    this.fireControl = mode;
    try {
      await this.api.setFireControl(mode);
    } catch (error) {
      this.#showError(codeOf(error));
    }
  }

  #bumpOption(mode: BumpMode, label: string): TemplateResult {
    return html`<wt-button
      variant=${this.bumpMode === mode ? "primary" : "secondary"}
      size="sm"
      data-test="bump-${mode}"
      @click=${() => void this.#setBump(mode)}
      >${label}</wt-button
    >`;
  }

  #fireOption(mode: FireControl, label: string): TemplateResult {
    return html`<wt-button
      variant=${this.fireControl === mode ? "primary" : "secondary"}
      size="sm"
      data-test="fire-${mode}"
      @click=${() => void this.#setFire(mode)}
      >${label}</wt-button
    >`;
  }

  override render(): TemplateResult {
    return html`
      <section data-test="courses-panel">
        <h2 class="panel-title">${t("kitchen.courses_title")}</h2>
        <dashboard-course-list .api=${this.api} .readOnly=${this.readOnly}></dashboard-course-list>
      </section>

      <section class="bump" role="group" aria-label=${t("kitchen.bump_mode")}>
        <span class="panel-title">${t("kitchen.bump_mode")}</span>
        <div class="bump-options">
          ${this.readOnly ? (this.bumpMode === "line" ? t("kitchen.bump_line") : t("kitchen.bump_ticket")) : html`${this.#bumpOption("line", t("kitchen.bump_line"))}${this.#bumpOption("ticket", t("kitchen.bump_ticket"))}`}
        </div>
      </section>

      <section class="bump" role="group" aria-label=${t("kitchen.fire_mode")}>
        <span class="panel-title">${t("kitchen.fire_mode")}</span>
        <div class="bump-options">
          ${this.readOnly ? t(this.fireControl === "waiter" ? "kitchen.fire_waiter" : this.fireControl === "kitchen" ? "kitchen.fire_kitchen" : "kitchen.fire_expo") : html`${this.#fireOption("waiter", t("kitchen.fire_waiter"))}${this.#fireOption("kitchen", t("kitchen.fire_kitchen"))}${this.#fireOption("expo", t("kitchen.fire_expo"))}`}
        </div>
      </section>

      ${this.#timingPanel()}
      ${this.errorKey ? html`<p class="error" role="alert" data-test="kitchen-error">${codeMessage(this.errorKey)}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-kitchen-screen": KitchenScreen;
  }
}
