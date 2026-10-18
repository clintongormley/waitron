import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-notice.js";
import { codeMessage, codeOf, subscribeLocale } from "@waitron/dashboard-kit";
import type { AeatCertificateClient, CertificateCardView, CertificateKind } from "./client.js";
import { t, type AeatCertificateKey } from "./strings.js";
import { day, time } from "./dates.js";
import "./certificate-dialog.js";

type Installed = NonNullable<CertificateCardView["installed"]>;

function moment(iso: string, timeZone: string): string {
  return `${day(iso, timeZone)}, ${time(iso, timeZone)}`;
}

function remaining(c: Installed, timeZone: string): string {
  if (c.stage === "expired")
    return t("aeat_certificate.expired_on", { date: day(c.validUntil, timeZone) });
  if (c.daysLeft === 0)
    return t("aeat_certificate.expires_today", { time: time(c.validUntil, timeZone) });
  if (c.daysLeft === 1) {
    return t("aeat_certificate.expires_tomorrow", { time: time(c.validUntil, timeZone) });
  }
  return t("aeat_certificate.days_left", { days: c.daysLeft });
}

function statusLine(c: Installed, timeZone: string): string {
  const date = day(c.validUntil, timeZone);
  if (c.stage === "expired") return t("aeat_certificate.expired", { date });
  if (c.stage === "urgent") {
    if (c.daysLeft === 0) {
      return t("aeat_certificate.urgent_today", { time: time(c.validUntil, timeZone) });
    }
    if (c.daysLeft === 1) {
      return t("aeat_certificate.urgent_tomorrow", { time: time(c.validUntil, timeZone) });
    }
    return t("aeat_certificate.urgent", { days: c.daysLeft });
  }
  return t(`aeat_certificate.warning_${c.kind}`, { date });
}

@customElement("dashboard-aeat-certificate-card")
export class AeatCertificateCard extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      section {
        display: grid;
        gap: var(--wt-space-4);
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-lg);
        padding: var(--wt-space-5);
        margin: 0;
        min-width: 0;
      }
      header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2) var(--wt-space-3);
      }
      h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }
      p {
        margin: 0;
      }
      .status {
        display: flex;
        align-items: baseline;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-warning);
        border-radius: var(--wt-radius-md);
      }
      .status[data-stage="urgent"],
      .status[data-stage="expired"] {
        border-color: var(--wt-color-danger);
      }
      .status[data-stage="installed"] {
        border-color: var(--wt-color-success);
      }
      .dot {
        flex: none;
        width: var(--wt-space-3);
        height: var(--wt-space-3);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-warning);
      }
      .status[data-stage="urgent"] .dot,
      .status[data-stage="expired"] .dot {
        background: var(--wt-color-danger);
      }
      .status[data-stage="installed"] .dot {
        background: var(--wt-color-success);
      }
      dl {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
        gap: var(--wt-space-3) var(--wt-space-4);
        margin: 0;
      }
      dt,
      .muted {
        color: var(--wt-color-text-muted);
      }
      dd {
        margin: 0;
        color: var(--wt-color-text);
        overflow-wrap: anywhere;
      }
      dd[data-stage="warning"] {
        font-weight: var(--wt-font-weight-bold);
      }
      dd[data-stage="urgent"],
      dd[data-stage="expired"] {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-danger);
      }
      .mismatch,
      .error {
        color: var(--wt-color-danger);
      }
      /* A media query cannot read a custom property; this repeats the settings cards' breakpoint. */
      @media (max-width: 48rem) {
        dl {
          grid-template-columns: minmax(0, 1fr);
          gap: var(--wt-space-1);
        }
        dd {
          margin: 0 0 var(--wt-space-2);
        }
      }
    `,
  ];

  @property({ attribute: false }) client!: AeatCertificateClient;
  @property({ attribute: false }) readOnly = false;
  @state() private card?: CertificateCardView;
  @state() private loadError = "";
  @state() private dialog?: { revision: string | null; kind: CertificateKind };
  /** When AEAT answered the check of a certificate this card just installed. */
  @state() private checkedAt?: string;
  #generation = 0;
  #unsubscribeLocale?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unsubscribeLocale = subscribeLocale(() => this.requestUpdate());
    void this.#load();
  }

  override disconnectedCallback(): void {
    this.#generation += 1;
    this.#unsubscribeLocale?.();
    super.disconnectedCallback();
  }

  async #load(): Promise<void> {
    const generation = ++this.#generation;
    try {
      const card = await this.client.read();
      if (generation !== this.#generation) return;
      this.card = card;
      this.loadError = "";
    } catch (error) {
      if (generation === this.#generation) this.loadError = codeMessage(codeOf(error));
    }
  }

  #action(card: CertificateCardView): TemplateResult | typeof nothing {
    if (this.readOnly || !card.filing) return nothing;
    const urgent = card.installed?.stage === "urgent" || card.installed?.stage === "expired";
    const label = card.revision === null ? "aeat_certificate.install" : "aeat_certificate.replace";
    return html`<wt-button
      data-test="certificate-action"
      variant=${urgent ? "primary" : "secondary"}
      @click=${() => {
        this.checkedAt = undefined;
        this.dialog = { revision: card.revision, kind: card.installed?.kind ?? "sello" };
      }}
      >${t(label)}</wt-button
    >`;
  }

  #row(label: AeatCertificateKey, test: string, value: unknown, stage?: string): TemplateResult {
    return html`<dt>${t(label)}</dt>
      <dd data-test=${test} data-stage=${stage ?? nothing}>${value}</dd>`;
  }

  #taxId(c: Installed): TemplateResult {
    if (c.taxId === null)
      return html`<span class="muted">${t("aeat_certificate.no_tax_id")}</span>`;
    if (c.taxIdMatches === false) {
      return html`${c.taxId}
        <span class="mismatch">· ${t("aeat_certificate.does_not_match")}</span>`;
    }
    return html`${c.taxId} <span class="muted">· ${t("aeat_certificate.matches")}</span>`;
  }

  #installedBy(c: Installed): string {
    if (c.source === "setup") return t("aeat_certificate.during_setup");
    return c.installedByName ?? t("aeat_certificate.not_recorded");
  }

  #body(card: CertificateCardView): TemplateResult {
    const message = (key: AeatCertificateKey) =>
      html`<p data-test="certificate-message">${t(key)}</p>`;
    if (!card.filing) return message("aeat_certificate.not_filing");
    const c = card.installed;
    if (c === null) {
      if (card.revision === null) return message("aeat_certificate.none_installed");
      return html`<dl>
        ${this.#row("aeat_certificate.installed", "installed", t("aeat_certificate.not_recorded"))}
      </dl>`;
    }
    const zone = card.timeZone;
    const until =
      c.stage === "expired"
        ? remaining(c, zone)
        : `${day(c.validUntil, zone)} · ${remaining(c, zone)}`;
    return html`${
        this.checkedAt === undefined
          ? nothing
          : html`<p class="status" data-test="certificate-installed" data-stage="installed">
              <span class="dot" aria-hidden="true"></span
              ><span
                >${t("aeat_certificate.installed_line", { time: time(this.checkedAt, zone) })}</span
              >
            </p>`
      }${
        c.stage === null
          ? nothing
          : html`<wt-notice duration="0">
              <p class="status" data-test="certificate-status" data-stage=${c.stage}>
                <span class="dot" aria-hidden="true"></span><span>${statusLine(c, zone)}</span>
              </p>
            </wt-notice>`
      }
      <dl>
        ${this.#row("aeat_certificate.issued_to", "issued-to", c.organisation ?? "—")}
        ${this.#row("aeat_certificate.tax_id", "tax-id", this.#taxId(c))}
        ${this.#row("aeat_certificate.type", "type", t(`aeat_certificate.kind.${c.kind}`))}
        ${this.#row("aeat_certificate.issued_by", "issued-by", c.issuer ?? "—")}
        ${this.#row("aeat_certificate.valid_from", "valid-from", day(c.validFrom, zone))}
        ${this.#row("aeat_certificate.valid_until", "valid-until", until, c.stage ?? undefined)}
        ${this.#row(
          "aeat_certificate.installed",
          "installed",
          `${moment(c.installedAt, zone)} · ${this.#installedBy(c)}`,
        )}
        ${this.#row(
          "aeat_certificate.last_accepted",
          "last-accepted",
          c.lastAcceptedAt === null
            ? t("aeat_certificate.none_since_installed")
            : moment(c.lastAcceptedAt, zone),
        )}
      </dl>`;
  }

  override render(): TemplateResult {
    const card = this.card;
    const state = this.loadError !== "" ? "failed" : card === undefined ? "loading" : "loaded";
    return html`<section aria-labelledby="aeat-certificate-title" data-state=${state}>
      <header>
        <h2 id="aeat-certificate-title">${t("aeat_certificate.title")}</h2>
        ${state === "loaded" ? this.#action(card!) : nothing}
      </header>
      ${
        state === "failed"
          ? html`<p class="error" role="alert" data-test="certificate-load-error">
              ${this.loadError}
            </p>`
          : state === "loaded"
            ? this.#body(card!)
            : nothing
      }
      ${
        this.dialog === undefined
          ? nothing
          : html`<dashboard-aeat-certificate-dialog
              .client=${this.client}
              .revision=${this.dialog.revision}
              .kind=${this.dialog.kind}
              @aeat-certificate-installed=${(event: CustomEvent<{ checkedAt: string }>) => {
                event.stopPropagation();
                this.checkedAt = event.detail.checkedAt;
                void this.#load();
              }}
              @wt-close=${() => {
                this.dialog = undefined;
              }}
            ></dashboard-aeat-certificate-dialog>`
      }
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-aeat-certificate-card": AeatCertificateCard;
  }
}
