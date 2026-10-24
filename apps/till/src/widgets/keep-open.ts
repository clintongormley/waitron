import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import type {
  TillApi,
  MenuState,
  KeepOpenZone,
  ZoneExtensionWrite,
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
  @property({ attribute: false }) zoneKeepOpen: MenuState["service"]["zoneKeepOpen"] = null;
  @state() private busy = false;
  @state() private zone: KeepOpenZone | null = null;
  @state() private refusal: string | null = null;
  @state() private refusalField: string | null = null;
  @state() private authorizers: StaffMember[] | null = null;
  @state() private pinError: string | null = null;
  #intent?: ZoneExtensionWrite;
  #generation = 0;
  override disconnectedCallback(): void {
    this.#reset();
    super.disconnectedCallback();
  }
  override willUpdate(changed: PropertyValues): void {
    const old = changed.get("zoneKeepOpen") as typeof this.zoneKeepOpen | undefined;
    if (
      changed.has("zoneId") ||
      (changed.has("zoneKeepOpen") && old?.zoneId !== this.zoneKeepOpen?.zoneId)
    )
      this.#reset();
  }
  #reset(): void {
    this.#generation++;
    this.busy = false;
    this.zone = null;
    this.refusal = null;
    this.refusalField = null;
    this.authorizers = null;
    this.pinError = null;
    this.#intent = undefined;
  }
  #current(generation: number, zone: string, subjectId: string): boolean {
    return (
      this.isConnected &&
      generation === this.#generation &&
      this.zoneId === zone &&
      this.zoneKeepOpen?.zoneId === subjectId
    );
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
      !this.zoneKeepOpen ||
      this.busy ||
      this.zone ||
      this.authorizers
    )
      return;
    const generation = ++this.#generation,
      zone = this.zoneId,
      subjectId = this.zoneKeepOpen.zoneId;
    this.busy = true;
    this.refusal = null;
    try {
      const answer = await this.api.keepOpen(zone);
      if (this.#current(generation, zone, subjectId)) this.zone = answer.zone;
    } catch (error) {
      if (this.#current(generation, zone, subjectId)) this.refusal = this.#code(error);
    } finally {
      if (this.#current(generation, zone, subjectId)) this.busy = false;
    }
  }
  async #write(intent: ZoneExtensionWrite, override?: OverrideConfirmDetail): Promise<void> {
    if (!this.isConnected || !this.api || !this.zoneKeepOpen || !this.zone || this.busy) return;
    const generation = ++this.#generation,
      zone = this.zoneId,
      subjectId = this.zoneKeepOpen.zoneId;
    this.#intent = intent;
    this.busy = true;
    this.refusal = null;
    this.refusalField = null;
    this.pinError = null;
    try {
      await this.api.keepZoneOpen(zone, override ? { ...intent, override } : intent);
      if (!this.#current(generation, zone, subjectId)) return;
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
      if (!this.#current(generation, zone, subjectId)) return;
      const code = this.#code(error);
      if (this.authorizers && (code === "pin.invalid" || code === "pin.throttled"))
        this.pinError = code;
      else if (code === "authorization.not_permitted") {
        try {
          const people = await this.api.serviceDayAuthorizers();
          if (this.#current(generation, zone, subjectId)) this.authorizers = people;
        } catch (readError) {
          if (this.#current(generation, zone, subjectId)) this.refusal = this.#code(readError);
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
        if (code.startsWith("zone_extension.")) {
          try {
            const answer = await this.api.keepOpen(zone);
            if (this.#current(generation, zone, subjectId)) this.zone = answer.zone;
          } catch {
            /* The write refusal survives a failed refresh. */
          }
        }
      }
    } finally {
      if (this.#current(generation, zone, subjectId)) this.busy = false;
    }
  }
  override render() {
    const subject = this.zoneKeepOpen;
    if (!subject) return nothing;
    return html`<wt-button
        data-action
        variant="secondary"
        ?disabled=${this.busy || this.zone !== null || this.authorizers !== null}
        @click=${() => this.#act()}
        >${t("keep_open.zone_button").replace("{zone}", () => subject.zoneName)}</wt-button
      >
      ${this.refusal && this.zone === null ? html`<p class="refusal" role="alert">${codeMessage(this.refusal)}</p>` : nothing}
      ${
        this.zone !== null
          ? html`<till-keep-open-dialog
              .zone=${this.zone}
              .busy=${this.busy || this.authorizers !== null}
              .refusal=${this.refusal}
              .refusalField=${this.refusalField}
              @close=${(e: Event) => {
                e.stopPropagation();
                this.#reset();
              }}
              @keep-open-confirm=${(e: CustomEvent<{ zoneId: string; until: string | null }>) => {
                e.stopPropagation();
                if (e.detail.zoneId === this.zone?.id) void this.#write({ until: e.detail.until });
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
