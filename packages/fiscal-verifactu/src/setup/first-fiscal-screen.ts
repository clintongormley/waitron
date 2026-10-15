import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, focusFirstInvalid, type DraftScope } from "@waitron/ui";
import type { InitialSetupActions, SetupContribution } from "@waitron/module/src/setup-contract.js";
interface CustodyRequest {
  softwareId: string;
  binding: {
    module: string;
    action: string;
    eventId: string;
    sourceId: string;
    targetNodeId: string;
  };
  operatorId: string;
  recipientVenueId: string;
  requiredBases: readonly { code: string; purpose: string }[];
}
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-textarea.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { fiscalSetupStrings } from "./strings.js";

type Context = {
  status: string;
  environment: "production" | "preproduction";
  venue: {
    taxId: string;
    seriesCode: string;
    fullSeriesCode?: string;
    rectificativeSeriesCode: string;
  };
};
type Input = {
  allocation: {
    allocationId: string;
    installationIdentity: string;
    series: { code: string; purpose: string }[];
    reservationEvidence: {
      block: { payload: { custodianId: string; generationId: string; blockId: string } };
    };
  };
  approval: { incidentEvidence: string };
};
type PublicKey = { custodianId: string; publicKey: string; fingerprint: string };
interface Draft {
  route?: "new" | "existing";
  serials: string;
  fingerprint: string;
  incident: string;
  consulted: boolean;
  consumed: boolean;
  allocationFile?: File;
  keyFile?: File;
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function publicOnly(value: unknown, depth = 0): void {
  if (depth > 30) throw new Error("public input");
  if (Array.isArray(value)) {
    for (const item of value) publicOnly(item, depth + 1);
    return;
  }
  if (object(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (
        /password|private|secret|pkcs8|encrypted|passphrase|credential|recoveryKey|recoveryPack/i.test(
          key,
        )
      )
        throw new Error("public input");
      publicOnly(item, depth + 1);
    }
  } else if (
    typeof value === "string" &&
    /-----BEGIN (?:.*PRIVATE KEY|ENCRYPTED)|SECRET \/ SECRETO/.test(value)
  )
    throw new Error("public input");
}
async function readPublic(file?: File): Promise<unknown> {
  if (!file || file.size > 65536) throw new Error("public input");
  const value: unknown = JSON.parse(await file.text());
  publicOnly(value);
  return value;
}

@customElement("vf-first-fiscal-screen")
export class FirstFiscalScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      section {
        margin-block: var(--wt-space-4);
      }
      wt-input,
      wt-textarea {
        display: block;
        margin-block: var(--wt-space-3);
      }
      label {
        display: block;
        margin-block: var(--wt-space-3);
      }
      input[type="file"] {
        max-width: 100%;
        min-height: var(--wt-tap-min);
        font: inherit;
        color: var(--wt-color-text);
      }
      p,
      dd {
        overflow-wrap: anywhere;
      }
      dt {
        color: var(--wt-color-text-muted);
      }
      dd {
        margin-inline-start: 0;
        margin-block-end: var(--wt-space-2);
      }
      .error {
        color: var(--wt-color-danger);
      }
      .choices {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
      }
    `,
  ];
  @property({ attribute: false }) context!: Context;
  @property({ attribute: false }) api!: InitialSetupActions;
  @property({ attribute: "lang" }) locale: "en" | "es" = "en";
  @state() private draft: Draft = {
    serials: "",
    fingerprint: "",
    incident: "",
    consulted: false,
    consumed: false,
  };
  @state() private request?: CustodyRequest;
  @state() private imported?: Input;
  @state() private enrolled = false;
  @state() private confirmed = false;
  @state() private busy = false;
  @state() private serialAttempted = false;
  @state() private fingerprintAttempted = false;
  @state() private error?: "serials" | "allocation" | "key" | "general";
  #scope?: DraftScope<Draft>;
  #baseline: Draft = { ...this.draft };
  #generation = 0;
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback() {
    ++this.#generation;
    this.busy = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }
  override willUpdate() {
    if (this.isConnected && !this.#scope) {
      this.#scope = draftScopeFor(this, {
        id: this,
        parent:
          this.getRootNode() instanceof ShadowRoot
            ? (this.getRootNode() as ShadowRoot).host
            : undefined,
        current: () => this.draft,
        snapshot: (value) => ({ ...value }),
        equal: (a, b) =>
          Object.keys({ ...a, ...b }).every(
            (key) => a[key as keyof Draft] === b[key as keyof Draft],
          ),
        restore: (value) => {
          this.draft = value;
          this.confirmed = false;
        },
      }).scope;
      this.#scope.commit(this.#baseline);
    }
  }
  #commit(): void {
    this.#baseline = { ...this.draft };
    this.#scope?.commit(this.#baseline);
  }
  #change(patch: Partial<Draft>) {
    this.draft = { ...this.draft, ...patch };
    this.confirmed = false;
    this.error = undefined;
    if ("fingerprint" in patch || "keyFile" in patch) this.enrolled = false;
    this.#scope?.changed();
    this.dispatchEvent(new CustomEvent("initial-setup-changed", { bubbles: true, composed: true }));
  }
  #serials(): number[] | null {
    const text = this.draft.serials.trim();
    if (!/^\d+(?:\s*,\s*\d+)*$/.test(text)) return null;
    const values = text.split(",").map((value) => Number(value.trim()));
    return values.length > 100 ||
      new Set(values).size !== values.length ||
      values.some((value) => value < 1 || value > 999999 || !Number.isSafeInteger(value))
      ? null
      : values;
  }
  async #run(
    kind: NonNullable<FirstFiscalScreen["error"]>,
    body: (current: () => void) => Promise<void>,
  ) {
    if (this.busy || !this.isConnected) return;
    this.busy = true;
    this.error = undefined;
    const generation = this.#generation;
    const current = () => {
      if (!this.isConnected || generation !== this.#generation) throw new Error("stale screen");
    };
    try {
      await body(current);
    } catch {
      if (this.isConnected && generation === this.#generation) this.error = kind;
    } finally {
      if (this.isConnected && generation === this.#generation) this.busy = false;
    }
  }
  async #candidates() {
    this.serialAttempted = true;
    const serials = this.#serials();
    if (!serials) {
      await this.updateComplete;
      void focusFirstInvalid(this.shadowRoot!);
      return;
    }
    await this.#run("serials", async (current) => {
      const request = await this.api.candidates({ serials });
      current();
      this.request = request as CustodyRequest;
      this.#commit();
    });
  }
  async #resume() {
    await this.#run("general", async (current) => {
      const request = await this.api.request();
      current();
      this.request = request as CustodyRequest;
    });
  }
  async #import() {
    await this.#run("allocation", async (current) => {
      const input = await readPublic(this.draft.allocationFile);
      if (
        !object(input) ||
        Object.keys(input).length !== 2 ||
        !object(input.allocation) ||
        !object(input.approval)
      ) {
        throw new Error("public allocation");
      }
      current();
      await this.api.importInput(input);
      current();
      this.imported = input as Input;
      this.enrolled = false;
      this.confirmed = false;
      this.#commit();
    });
  }
  async #enrol() {
    this.fingerprintAttempted = true;
    if (!/^[a-f0-9]{64}$/.test(this.draft.fingerprint)) {
      await this.updateComplete;
      void focusFirstInvalid(this.shadowRoot!);
      return;
    }
    await this.#run("key", async (current) => {
      const key = await readPublic(this.draft.keyFile);
      current();
      if (
        !object(key) ||
        Object.keys(key).length !== 3 ||
        typeof key.custodianId !== "string" ||
        typeof key.publicKey !== "string" ||
        key.fingerprint !== this.draft.fingerprint
      )
        throw new Error("public key");
      await this.api.enrol(key as unknown as PublicKey, this.draft.fingerprint);
      current();
      this.enrolled = true;
      this.#commit();
    });
  }
  #canConfirm() {
    return (
      this.enrolled &&
      this.draft.consulted &&
      this.draft.consumed &&
      this.imported !== undefined &&
      this.draft.incident !== "" &&
      this.draft.incident === this.imported.approval.incidentEvidence
    );
  }
  async #confirm() {
    if (!this.#canConfirm() || !this.request || !this.imported) return;
    const request = this.request,
      input = this.imported;
    await this.#run("general", async (current) => {
      await this.api.confirm({
        version: 1,
        allocationId: input.allocation.allocationId,
        binding: request.binding,
        operatorId: request.operatorId,
        priorActivation: ["activation-started", "committed", "publication"].includes(
          this.context.status,
        )
          ? "committed"
          : "none",
        incidentEvidence: this.draft.incident,
        requiredBases: request.requiredBases,
        recipientVenueId: request.recipientVenueId,
        generationId: input.allocation.reservationEvidence.block.payload.generationId,
        blockId: input.allocation.reservationEvidence.block.payload.blockId,
        currentRegisterConfirmed: true,
        consumptionConfirmed: true,
        currentEntryState: "consumed-for-event",
      });
      current();
      this.confirmed = true;
      this.#commit();
    });
  }
  #download() {
    if (!this.request) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(this.request)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "public-setup-request.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  #file(test: "allocation-file" | "key-file", label: string, field: "allocationFile" | "keyFile") {
    return html`<label
      >${label} *<input
        type="file"
        accept="application/json,.json"
        name=${field === "allocationFile" ? "fiscal-public-allocation" : "custodian-public-key"}
        data-test=${test}
        ?disabled=${this.busy}
        @change=${(event: Event) => {
          event.stopPropagation();
          this.#change({ [field]: (event.target as HTMLInputElement).files?.[0] });
          if (field === "allocationFile") {
            this.imported = undefined;
            this.enrolled = false;
          }
        }}
    /></label>`;
  }
  override render() {
    const t = fiscalSetupStrings[this.locale];
    const serialInvalid = this.serialAttempted && !this.#serials();
    const fingerprintInvalid =
      this.fingerprintAttempted && !/^[a-f0-9]{64}$/.test(this.draft.fingerprint);
    return html`<h2>${t.heading}</h2>
      <p>
        ${this.context.environment === "production" ? t.production : t.preproduction} ·
        ${this.context.venue.taxId}
      </p>
      ${
        !this.draft.route && !this.request
          ? html`<p>${t.question}</p>
              <div class="choices">
                <wt-button data-test="new" @click=${() => this.#change({ route: "new" })}
                  >${t.newKit}</wt-button
                ><wt-button data-test="existing" @click=${() => this.#change({ route: "existing" })}
                  >${t.existing}</wt-button
                >
              </div>`
          : nothing
      }
      ${this.draft.route ? html`<p>${this.draft.route === "new" ? t.outside : t.existingHelp}</p>` : nothing}
      ${this.context.status !== "claimed" && !this.request ? html`<wt-button data-test="resume" ?disabled=${this.busy} @click=${() => void this.#resume()}>${t.resume}</wt-button>` : nothing}
      ${
        this.draft.route && !this.request && this.context.status === "claimed"
          ? html`<wt-input
                data-test="serials"
                name="proposed-fiscal-serials"
                label=${t.serials}
                placeholder=${t.serialsHint}
                required
                .value=${this.draft.serials}
                ?invalid=${serialInvalid}
                error=${serialInvalid ? t.serialsError : ""}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.#change({ serials: event.detail.value });
                }}
              ></wt-input
              ><wt-form-actions
                .error=${serialInvalid ? t.fix : this.error === "serials" ? t.refusal : ""}
                ><wt-button
                  data-test="candidates"
                  variant=${this.busy ? "secondary" : "primary"}
                  ?disabled=${this.busy || serialInvalid}
                  @click=${() => void this.#candidates()}
                  >${t.candidates}</wt-button
                ></wt-form-actions
              >`
          : nothing
      }
      ${
        this.request
          ? html`<section>
              <p>${t.validated}</p>
              <wt-button data-test="download-request" @click=${() => this.#download()}
                >${t.download}</wt-button
              >
              <p>${t.publicOnly}</p>
              ${this.#file("allocation-file", t.allocation, "allocationFile")}
              ${this.error === "allocation" ? html`<p class="error" data-test="allocation-error" role="alert">${t.inputError}</p>` : nothing}
              <wt-form-actions .error=${this.error === "allocation" ? t.fix : ""}
                ><wt-button
                  data-test="import"
                  variant=${this.draft.allocationFile ? "primary" : "secondary"}
                  ?disabled=${this.busy || !this.draft.allocationFile}
                  @click=${() => void this.#import()}
                  >${t.import}</wt-button
                ></wt-form-actions
              >
            </section>`
          : nothing
      }
      ${
        this.imported
          ? html`<section>
              <h3>${t.assignment}</h3>
              <dl>
                <dt>${t.installation}</dt>
                <dd>${this.imported.allocation.installationIdentity}</dd>
                <dt>${t.series}</dt>
                <dd data-test="review-series">
                  ${this.imported.allocation.series.map((series) => html`<div>${series.code} · ${series.purpose === "standard" ? t.standard : series.purpose === "full" ? t.full : t.rectificative}</div>`)}
                </dd>
                <dt>${t.software}</dt>
                <dd>${this.request?.softwareId}</dd>
                <dt>${t.event}</dt>
                <dd data-test="review-event">${this.request?.binding.eventId}</dd>
                <dt>${t.source}</dt>
                <dd>${this.request?.binding.sourceId}</dd>
                <dt>${t.box}</dt>
                <dd data-test="review-box">${this.request?.binding.targetNodeId}</dd>
                <dt>${t.operator}</dt>
                <dd data-test="review-operator">${this.request?.operatorId}</dd>
                <dt>${t.custodian}</dt>
                <dd data-test="review-custodian">
                  ${this.imported.allocation.reservationEvidence.block.payload.custodianId}
                </dd>
                <dt>${t.generation}</dt>
                <dd data-test="review-generation">
                  ${this.imported.allocation.reservationEvidence.block.payload.generationId}
                </dd>
                <dt>${t.block}</dt>
                <dd data-test="review-block">
                  ${this.imported.allocation.reservationEvidence.block.payload.blockId}
                </dd>
              </dl>
              ${this.#file("key-file", t.key, "keyFile")}
              <wt-textarea
                data-test="fingerprint"
                name="independent-custodian-fingerprint"
                label=${t.fingerprint}
                required
                .value=${this.draft.fingerprint}
                ?invalid=${fingerprintInvalid || this.error === "key"}
                error=${fingerprintInvalid ? t.fingerprintError : this.error === "key" ? t.keyError : ""}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.#change({ fingerprint: event.detail.value });
                }}
              ></wt-textarea>
              <wt-form-actions .error=${fingerprintInvalid || this.error === "key" ? t.fix : ""}
                ><wt-button
                  data-test="enrol"
                  variant=${this.draft.keyFile ? "primary" : "secondary"}
                  ?disabled=${this.busy || !this.draft.keyFile || fingerprintInvalid}
                  @click=${() => void this.#enrol()}
                  >${t.enrol}</wt-button
                ></wt-form-actions
              >
              <wt-switch
                data-test="consulted"
                label=${t.consulted}
                name="current-original-consulted"
                .checked=${this.draft.consulted}
                @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                  event.stopPropagation();
                  this.#change({ consulted: event.detail.checked });
                }}
              ></wt-switch>
              <wt-switch
                data-test="consumed"
                label=${t.consumed}
                name="current-original-consumed"
                .checked=${this.draft.consumed}
                @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                  event.stopPropagation();
                  this.#change({ consumed: event.detail.checked });
                }}
              ></wt-switch>
              <wt-input
                data-test="incident"
                name="current-original-record-reference"
                label=${t.incident}
                required
                .value=${this.draft.incident}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.#change({ incident: event.detail.value });
                }}
              ></wt-input>
              <wt-form-actions .error=${this.error === "general" ? t.refusal : ""}
                ><wt-button
                  data-test="confirm"
                  variant=${this.#canConfirm() ? "primary" : "secondary"}
                  ?disabled=${this.busy || !this.#canConfirm()}
                  @click=${() => void this.#confirm()}
                  >${t.confirm}</wt-button
                ></wt-form-actions
              >
            </section>`
          : nothing
      }
      ${this.confirmed ? html`<p role="status">${t.confirmed}</p>` : nothing}
      ${this.error === "general" && !this.imported ? html`<p role="alert">${t.refusal}</p>` : nothing}`;
  }
}
export const FISCAL_SETUP: SetupContribution = {
  module: "fiscal-verifactu",
  create({ locale, request, api }) {
    const element = document.createElement("vf-first-fiscal-screen");
    element.locale = locale;
    element.context = request as Context;
    element.api = api;
    return element;
  },
};
declare global {
  interface HTMLElementTagNameMap {
    "vf-first-fiscal-screen": FirstFiscalScreen;
  }
}
