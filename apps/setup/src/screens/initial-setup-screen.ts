import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, focusFirstInvalid, type DraftScope } from "@waitron/ui";
import type { InitialSetupActions, SetupContribution } from "@waitron/module/src/setup-contract.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { FirstSetupSession } from "../first-setup-session.js";
import { initialSetupStrings } from "./initial-setup-strings.js";

@customElement("setup-initial-setup-screen")
export class InitialSetupScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      section {
        margin-block: var(--wt-space-4);
      }
      p {
        overflow-wrap: anywhere;
      }
      a {
        color: var(--wt-color-primary);
        display: inline-flex;
        align-items: center;
        min-height: var(--wt-tap-min);
      }
    `,
  ];
  @property({ attribute: false }) session!: FirstSetupSession;
  @property({ attribute: false }) contributions: readonly SetupContribution[] = [];
  @property({ attribute: false }) offerings: readonly { module: string; version: string }[] = [];
  @property() locale: "en" | "es" = "en";
  @state() private moduleScreens: HTMLElement[] = [];
  @state() private unavailable = true;
  @state() private proof?: "block-use" | "activation";
  @state() private password = "";
  @state() private attempted = false;
  @state() private recovery = false;
  @state() private ready = new Set<string>();
  #generation = 0;
  #draftRevision = 0;
  #resolve?: (value: string) => void;
  #reject?: (reason: unknown) => void;
  #scope?: DraftScope<string>;

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback(): void {
    ++this.#generation;
    this.#cancelProof();
    this.password = "";
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }
  override willUpdate(changed: PropertyValues<this>): void {
    if (this.isConnected && !this.#scope) {
      this.#scope = draftScopeFor(this, {
        id: this,
        current: () => this.password,
        snapshot: (value) => value,
        equal: (a, b) => a === b,
        restore: (value) => {
          this.password = value;
        },
      }).scope;
      this.#scope.commit("");
    }
    if (changed.has("session") || changed.has("contributions") || changed.has("offerings"))
      this.#mount();
    for (const child of this.moduleScreens) child.lang = this.locale;
  }
  #mount(): void {
    const generation = ++this.#generation;
    this.#cancelProof();
    this.ready = new Set();
    const state = this.session?.state;
    this.unavailable =
      !state ||
      this.offerings.length === 0 ||
      this.offerings.some(
        (offering) =>
          !state.modules.some(
            (module) => module.module === offering.module && module.version === offering.version,
          ) || !this.contributions.some((contribution) => contribution.module === offering.module),
      );
    this.moduleScreens = this.unavailable
      ? []
      : this.offerings.map(({ module }) => {
          const contribution = this.contributions.find((entry) => entry.module === module)!;
          const current = () => {
            if (!this.isConnected || generation !== this.#generation)
              throw { code: "setup.attempt_conflict" };
          };
          const run = async <T>(body: () => Promise<T>): Promise<T> => {
            current();
            this.ready = new Set();
            try {
              const value = await body();
              current();
              return value;
            } catch (error) {
              if (
                this.isConnected &&
                generation === this.#generation &&
                this.session.recoveryRequired
              )
                this.recovery = true;
              throw error;
            }
          };
          const request = async () => {
            const result = await this.session.request();
            current();
            const value = result.modules.find((entry) => entry.module === module);
            if (!value) throw { code: "setup.attempt_conflict" };
            return value.request;
          };
          const api: InitialSetupActions = {
            stageNodeKey: () =>
              run(async () => {
                const password = await this.#password("block-use");
                current();
                return this.session.stageNodeKey(module, password);
              }),
            registerRecoveryDocument: (value) =>
              run(() => this.session.registerRecoveryDocument(module, value)),
            confirmRecoveryDocument: (value) =>
              run(async () => {
                const revision = this.#draftRevision;
                const password = await this.#password("activation");
                current();
                await this.session.confirmRecoveryDocument(module, value, password);
                current();
                if (revision !== this.#draftRevision) return;
                this.ready = new Set([...this.ready, module]);
              }),
            preparation: (proposal) => run(() => this.session.preparation(module, proposal)),
            candidates: (proposal) =>
              run(async () => {
                const password = await this.#password("block-use");
                current();
                const pending = await this.session.candidates(module, proposal, password);
                current();
                return pending === undefined ? request() : pending;
              }),
            request: () => run(request),
            importInput: (input) => run(() => this.session.importInput(module, input)),
            enrol: (key, comparison) => run(() => this.session.enrol(module, key, comparison)),
            confirm: (statement) =>
              run(async () => {
                const password = await this.#password("activation");
                current();
                await this.session.confirm(module, statement, password);
                current();
                this.ready = new Set([...this.ready, module]);
              }),
          };
          return contribution.create({ locale: this.locale, request: state, api });
        });
  }
  async #password(purpose: "block-use" | "activation"): Promise<string> {
    if (this.proof) throw { code: "setup.attempt_conflict" };
    this.password = "";
    this.attempted = false;
    this.proof = purpose;
    const result = new Promise<string>((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
    await this.updateComplete;
    this.shadowRoot?.querySelector<HTMLElement>("[data-test=owner-password]")?.focus();
    return result;
  }
  #cancelProof(): void {
    this.#reject?.({ code: "setup.attempt_conflict" });
    this.#resolve = undefined;
    this.#reject = undefined;
    this.proof = undefined;
    this.password = "";
    this.#scope?.commit("");
  }
  async #confirmProof(): Promise<void> {
    this.attempted = true;
    if (!this.password) {
      await this.updateComplete;
      void focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const password = this.password;
    const resolve = this.#resolve;
    this.#resolve = undefined;
    this.#reject = undefined;
    this.proof = undefined;
    this.password = "";
    this.#scope?.commit("");
    resolve?.(password);
  }
  override render() {
    const t = initialSetupStrings[this.locale];
    const canContinue =
      !this.unavailable &&
      !this.recovery &&
      this.offerings.every(({ module }) => this.ready.has(module));
    return html`<h1>${t.heading}</h1>
      ${
        this.unavailable
          ? html`<p role="alert">${t.unavailable}</p>`
          : html`<section
              @initial-setup-changed=${() => {
                ++this.#draftRevision;
                this.ready = new Set();
              }}
            >
              ${this.moduleScreens}
            </section>`
      }
      ${
        this.recovery
          ? html`<p role="alert">${t.reconnect}</p>
              <wt-button
                data-test="reconnect"
                @click=${() => this.dispatchEvent(new CustomEvent("initial-reconnect", { bubbles: true, composed: true }))}
                >${t.reload}</wt-button
              >`
          : nothing
      }
      ${
        this.proof
          ? html`<section aria-label=${t.proof}>
              <h2>${t.proof}</h2>
              <p>${this.proof === "block-use" ? t.block : t.activation}</p>
              <wt-input
                data-test="owner-password"
                name="setup-administrator-password"
                type="password"
                autocomplete="current-password"
                label=${t.password}
                required
                .value=${this.password}
                ?invalid=${this.attempted && !this.password}
                error=${this.attempted && !this.password ? t.required : ""}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  this.password = event.detail.value;
                  this.#scope?.changed();
                }}
              ></wt-input>
              <wt-form-actions .error=${this.attempted && !this.password ? t.fix : ""}>
                <wt-button slot="cancel" variant="ghost" @click=${() => this.#cancelProof()}
                  >${t.cancel}</wt-button
                >
                <wt-button
                  data-test="reconfirm"
                  variant="primary"
                  ?disabled=${this.attempted && !this.password}
                  @click=${() => void this.#confirmProof()}
                  >${t.confirm}</wt-button
                >
              </wt-form-actions>
            </section>`
          : nothing
      }
      <wt-form-actions
        ><wt-button
          data-test="next"
          variant=${canContinue ? "primary" : "secondary"}
          ?disabled=${!canContinue}
          @click=${() => {
            if (canContinue)
              this.dispatchEvent(
                new CustomEvent("initial-setup-ready", { bubbles: true, composed: true }),
              );
          }}
          >${t.next}</wt-button
        ></wt-form-actions
      >`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "setup-initial-setup-screen": InitialSetupScreen;
  }
}
