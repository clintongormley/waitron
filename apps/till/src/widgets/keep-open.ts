import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import type {
  TillApi,
  MenuState,
  KeepOpenPeriod,
  PeriodExtensionWrite,
  StaffMember,
} from "../api/client.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./keep-open-dialog.js";
import "./supervisor-override-dialog.js";
import type { OverrideConfirmDetail } from "./supervisor-override-dialog.js";

@customElement("till-keep-open")
export class TillKeepOpen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .refusal {
        color: var(--wt-color-danger);
        margin: var(--wt-space-2) 0;
      }
    `,
  ];
  @property({ attribute: false }) api?: TillApi;
  @property() zoneId = "";
  @property() subject: "period" | "zone" = "period";
  @property({ attribute: false }) zoneKeepOpen: MenuState["service"]["zoneKeepOpen"] = null;
  @property({ attribute: false }) keepOpen: MenuState["service"]["keepOpen"] = null;
  @state() private busy = false;
  @state() private period: KeepOpenPeriod | null = null;
  @state() private refusal: string | null = null;
  @state() private refusalField: string | null = null;
  @state() private authorizers: StaffMember[] | null = null;
  @state() private pinError: string | null = null;
  #intent?: PeriodExtensionWrite;
  #generation = 0;
  override disconnectedCallback(): void {
    this.#reset();
    super.disconnectedCallback();
  }
  override willUpdate(changed: PropertyValues): void {
    const old = changed.get("keepOpen") as typeof this.keepOpen | undefined;
    const oldZone = changed.get("zoneKeepOpen") as typeof this.zoneKeepOpen | undefined;
    if (
      changed.has("zoneId") ||
      changed.has("subject") ||
      (this.subject === "zone" &&
        changed.has("zoneKeepOpen") &&
        oldZone?.zoneId !== this.zoneKeepOpen?.zoneId) ||
      (this.subject === "period" &&
        changed.has("keepOpen") &&
        old?.periodId !== this.keepOpen?.periodId)
    )
      this.#reset();
  }
  #reset(): void {
    this.#generation++;
    this.busy = false;
    this.period = null;
    this.refusal = null;
    this.refusalField = null;
    this.authorizers = null;
    this.pinError = null;
    this.#intent = undefined;
  }
  #current(generation: number, zone: string, periodId: string): boolean {
    return (
      this.isConnected &&
      generation === this.#generation &&
      this.zoneId === zone &&
      this.#subjectId() === periodId
    );
  }
  #subjectId(): string | undefined {
    return this.subject === "zone" ? this.zoneKeepOpen?.zoneId : this.keepOpen?.periodId;
  }
  #code(error: unknown): string {
    return typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
      ? error.code
      : "network.error";
  }
  async #act(): Promise<void> {
    if (
      !this.isConnected ||
      !this.api ||
      !this.zoneId ||
      !this.#subjectId() ||
      this.busy ||
      this.period ||
      this.authorizers
    )
      return;
    const generation = ++this.#generation,
      zone = this.zoneId,
      periodId = this.#subjectId()!;
    this.busy = true;
    this.refusal = null;
    try {
      const answer = await this.api.keepOpen(zone);
      if (this.#current(generation, zone, periodId))
        this.period = this.subject === "zone" ? answer.zone : answer.period;
    } catch (error) {
      if (this.#current(generation, zone, periodId)) this.refusal = this.#code(error);
    } finally {
      if (this.#current(generation, zone, periodId)) this.busy = false;
    }
  }
  async #write(intent: PeriodExtensionWrite, override?: OverrideConfirmDetail): Promise<void> {
    if (
      !this.isConnected ||
      !this.api ||
      !this.#subjectId() ||
      !this.period ||
      this.period.id !== intent.periodId ||
      this.busy
    )
      return;
    const generation = ++this.#generation,
      zone = this.zoneId,
      periodId = this.#subjectId()!;
    this.#intent = intent;
    this.busy = true;
    this.refusal = null;
    this.refusalField = null;
    this.pinError = null;
    try {
      if (this.subject === "zone")
        await this.api.keepZoneOpen(
          zone,
          override ? { until: intent.until, override } : { until: intent.until },
        );
      else await this.api.keepPeriodOpen(zone, override ? { ...intent, override } : intent);
      if (!this.#current(generation, zone, periodId)) return;
      this.shadowRoot!.querySelector("till-keep-open-dialog")?.commit();
      this.#reset();
      this.dispatchEvent(
        new CustomEvent("keep-open-changed", {
          detail: { zoneId: zone },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      if (!this.#current(generation, zone, periodId)) return;
      const code = this.#code(error);
      if (this.authorizers && (code === "pin.invalid" || code === "pin.throttled"))
        this.pinError = code;
      else if (code === "authorization.not_permitted") {
        try {
          const people = await this.api.serviceDayAuthorizers();
          if (this.#current(generation, zone, periodId)) this.authorizers = people;
        } catch (readError) {
          if (this.#current(generation, zone, periodId)) this.refusal = this.#code(readError);
        }
      } else {
        this.authorizers = null;
        this.refusal = code;
        this.refusalField =
          typeof error === "object" &&
          error !== null &&
          "field" in error &&
          typeof error.field === "string"
            ? error.field
            : null;
        if (code.startsWith(this.subject === "zone" ? "zone_extension." : "period_extension.")) {
          try {
            const answer = await this.api.keepOpen(zone);
            if (this.#current(generation, zone, periodId))
              this.period = this.subject === "zone" ? answer.zone : answer.period;
          } catch {
            /* The write refusal survives a failed refresh. */
          }
        }
      }
    } finally {
      if (this.#current(generation, zone, periodId)) this.busy = false;
    }
  }
  override render() {
    if (!this.#subjectId()) return nothing;
    return html`<wt-button
        data-action
        variant="secondary"
        ?disabled=${this.busy || this.period !== null || this.authorizers !== null}
        @click=${() => this.#act()}
        >${this.subject === "zone" ? t("keep_open.zone_button").replace("{zone}", () => this.zoneKeepOpen!.zoneName) : t("keep_open.button").replace("{period}", () => this.keepOpen!.periodName)}</wt-button
      >
      ${this.refusal && this.period === null ? html`<p class="refusal" role="alert">${codeMessage(this.refusal)}</p>` : nothing}
      ${
        this.period !== null
          ? html`<till-keep-open-dialog
              .period=${this.period}
              .subject=${this.subject}
              .busy=${this.busy || this.authorizers !== null}
              .refusal=${this.refusal}
              .refusalField=${this.refusalField}
              @close=${(e: Event) => {
                e.stopPropagation();
                this.#reset();
              }}
              @keep-open-confirm=${(e: CustomEvent<PeriodExtensionWrite>) => {
                e.stopPropagation();
                void this.#write(e.detail);
              }}
            ></till-keep-open-dialog>`
          : nothing
      }
      ${
        this.authorizers !== null
          ? html`<till-supervisor-override-dialog
              .authorizers=${this.authorizers}
              .approverRole=${"manager"}
              .error=${this.pinError}
              @override-cancel=${(e: Event) => {
                e.stopPropagation();
                if (!this.busy) {
                  this.authorizers = null;
                  this.pinError = null;
                }
              }}
              @override-confirm=${(e: CustomEvent<OverrideConfirmDetail>) => {
                e.stopPropagation();
                if (this.#intent) void this.#write(this.#intent, e.detail);
              }}
            ></till-supervisor-override-dialog>`
          : nothing
      }`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "till-keep-open": TillKeepOpen;
  }
}
