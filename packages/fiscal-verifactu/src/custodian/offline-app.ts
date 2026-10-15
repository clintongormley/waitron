import { LitElement, css, html, nothing } from "lit";
import { state } from "lit/decorators.js";
import { applyTokens } from "@waitron/ui/src/tokens/index.js";
import { submitOnEnter } from "@waitron/ui/src/submit-on-enter.js";
import { focusFirstInvalid } from "@waitron/ui/src/interactive.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-textarea.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { CustodySession } from "./custody-state.js";
import type { CustodyCheckReceipt } from "./challenge.js";
import {
  custodyStrings,
  custodyStateLabel,
  custodyValueLabel,
  type CustodyLocale,
} from "./strings.js";
import { text } from "./internal.js";

const fieldsForAction: Record<string, readonly string[]> = {
  create: ["custodian"],
  "save-key": ["passphrase", "confirmation"],
  reopen: ["passphrase"],
  "paper-check": ["paper", "fingerprint"],
  "original-kept": ["incident"],
  "original-spoiled": ["incident"],
  reserve: ["incident"],
  consume: ["incident"],
  handover: ["successor"],
  "handover-finish": ["retained"],
  stop: ["stop-reference"],
};

export class OfflineCustodyApp extends LitElement {
  static override styles = css`
    :host {
      display: block;
      color: var(--wt-color-text);
      background: var(--wt-color-bg);
      font: var(--wt-font-size-md) var(--wt-font-family);
      min-height: 100vh;
    }
    main {
      max-width: calc(var(--wt-tap-min) * 21);
      padding: var(--wt-space-5);
    }
    header,
    .actions {
      display: flex;
      gap: var(--wt-space-3);
      flex-wrap: wrap;
      align-items: center;
    }
    section {
      display: grid;
      gap: var(--wt-space-4);
      padding: var(--wt-space-5);
      margin-block: var(--wt-space-5);
      border: 1px solid var(--wt-color-border);
      border-radius: var(--wt-radius-md);
      background: var(--wt-color-surface);
    }
    h1 {
      font-size: var(--wt-font-size-xl);
      margin: 0;
    }
    h2 {
      font-size: var(--wt-font-size-lg);
      margin: 0;
    }
    p {
      margin: 0;
    }
    .fingerprint,
    .rows {
      overflow-wrap: anywhere;
    }
    dl {
      display: grid;
      gap: var(--wt-space-2);
      margin: 0;
    }
    dt {
      font-weight: var(--wt-font-weight-bold);
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
      font-family: var(--wt-font-family-mono);
    }
    .fingerprint {
      font-family: var(--wt-font-family-mono);
    }
    .hint {
      color: var(--wt-color-text-muted);
    }
    label.file {
      display: grid;
      gap: var(--wt-space-2);
    }
    input[type="file"] {
      font: inherit;
      color: inherit;
      max-width: 100%;
      min-height: var(--wt-tap-min);
    }
    wt-input,
    wt-textarea {
      max-width: 100%;
    }
    .rows {
      display: grid;
      gap: var(--wt-space-3);
    }
    .row {
      padding: var(--wt-space-3);
      border: 1px solid var(--wt-color-border);
      border-radius: var(--wt-radius-md);
    }
    @media (max-width: 600px) {
      main {
        padding: var(--wt-space-3);
      }
      section {
        padding: var(--wt-space-4);
      }
    }
  `;
  @state() private locale: CustodyLocale = "en";
  @state() private theme: "light" | "dark" = "light";
  @state() private error: "" | "unsupported" | "refusal" | "correct" = "";
  @state() private fieldErrors: Record<string, string> = {};
  @state() private values: Record<string, string> = {};
  @state() private choices: Record<string, boolean> = {};
  @state() private action = "";
  @state() private revision = 0;
  #session: CustodySession | null = null;
  #masterAnswered = false;
  #created = false;
  #fileMode = false;
  #protectedOutput = false;
  #secretOutput = false;
  #files = new Map<string, File>();
  #urls = new Set<string>();
  #receipt: CustodyCheckReceipt | null = null;
  #input: unknown = null;
  #selected = "";
  #reserved = false;
  #checked = new Set<string>();
  #unload = () => this.clearSecrets();
  private get t() {
    return custodyStrings(this.locale);
  }
  override connectedCallback(): void {
    super.connectedCallback();
    applyTokens(this);
    this.dataset.theme = this.theme;
    window.addEventListener("pagehide", this.#unload);
  }
  override disconnectedCallback(): void {
    this.clearSecrets();
    window.removeEventListener("pagehide", this.#unload);
    super.disconnectedCallback();
  }
  private clearSecrets(): void {
    this.#session?.close();
    this.values = {};
    this.fieldErrors = {};
    this.#checked.clear();
    this.error = "";
    this.choices = {};
    this.#files.clear();
    this.#receipt = null;
    this.#input = null;
    for (const url of this.#urls) URL.revokeObjectURL(url);
    this.#urls.clear();
    document.querySelector("#custody-print")?.remove();
    this.revision++;
  }
  private async run(name: string, body: () => unknown | Promise<unknown>): Promise<void> {
    if (this.action) return;
    this.action = name;
    this.error = "";
    try {
      await body();
    } catch {
      this.error = name === "create" ? "unsupported" : "refusal";
    } finally {
      this.action = "";
      this.revision++;
    }
  }
  private required(names: string[]): boolean {
    const errors: Record<string, string> = {};
    for (const name of names) {
      this.#checked.add(name);
      const error = this.fieldError(name);
      if (error) errors[name] = error;
    }
    this.fieldErrors = errors;
    if (Object.keys(errors).length) {
      this.error = "correct";
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return false;
    }
    return true;
  }
  private clearFields(names: string[]): void {
    const values = { ...this.values },
      errors = { ...this.fieldErrors };
    for (const name of names) {
      values[name] = "";
      errors[name] = "";
      this.#checked.delete(name);
    }
    this.values = values;
    this.fieldErrors = errors;
  }
  private fieldError(name: string): string {
    const value = this.values[name] ?? "";
    if (!value) return this.t.required;
    const bytes = new TextEncoder().encode(value).length;
    let valid: boolean;
    if (name === "passphrase" || name === "confirmation")
      valid =
        bytes >= 12 &&
        bytes <= 1024 &&
        (name !== "confirmation" || value === this.values.passphrase);
    else if (name === "fingerprint") valid = /^[0-9a-f]{64}$/.test(value);
    else if (name === "paper") valid = bytes <= 16384;
    else valid = text(value);
    return valid ? "" : this.t.invalid;
  }
  private field(name: string, label: string, type = "text", multiline = false) {
    const change = (event: CustomEvent<{ value: string }>) => {
      this.values = { ...this.values, [name]: event.detail.value };
      const errors = { ...this.fieldErrors };
      for (const checked of this.#checked) errors[checked] = this.fieldError(checked);
      this.fieldErrors = errors;
      if (Object.values(errors).some(Boolean)) this.error = "correct";
      else if (this.error === "correct") this.error = "";
    };
    return multiline
      ? html`<wt-textarea
          name=${name}
          label=${label}
          required
          .value=${this.values[name] ?? ""}
          .error=${this.fieldErrors[name] ? this.fieldError(name) : ""}
          autocomplete="off"
          .spellcheck=${false}
          @wt-change=${change}
        ></wt-textarea>`
      : html`<wt-input
          name=${name}
          label=${label}
          type=${type}
          required
          .value=${this.values[name] ?? ""}
          .error=${this.fieldErrors[name] ? this.fieldError(name) : ""}
          autocomplete="off"
          @wt-change=${change}
          @keydown=${(event: KeyboardEvent) => this.submitField(name, event)}
        ></wt-input>`;
  }
  private submitField(name: string, event: KeyboardEvent): void {
    const actions: Record<string, string> = {
      custodian: "create",
      passphrase: this.#fileMode ? "reopen" : "save-key",
      confirmation: "save-key",
      fingerprint: this.#session?.mode === "recovery" ? "paper-check" : "attest",
      incident:
        this.#session?.originalStatus === "issued-unknown"
          ? "original-kept"
          : this.#reserved
            ? "consume"
            : "reserve",
      successor: "handover",
      retained: "handover-finish",
      "stop-reference": "stop",
    };
    submitOnEnter(
      event,
      this.shadowRoot!.querySelector<HTMLElement>(`[data-action="${actions[name]}"]`),
    );
  }
  private choice(name: string, label: string) {
    return html`<wt-switch
      name=${name}
      .label=${label}
      .checked=${this.choices[name] ?? false}
      @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
        this.choices = { ...this.choices, [name]: event.detail.checked };
      }}
    ></wt-switch>`;
  }
  private file(name: string, label: string) {
    return html`<label class="file"
      ><span>${label}<span aria-hidden="true"> *</span></span
      ><input
        type="file"
        name=${name}
        aria-label=${label}
        required
        accept=".json,application/json"
        @change=${(event: Event) => {
          const input = event.target as HTMLInputElement;
          this.#files.delete(name);
          if (input.files?.[0]) this.#files.set(name, input.files[0]);
          this.revision++;
        }}
    /></label>`;
  }
  private button(
    name: string,
    label: string,
    body: () => unknown | Promise<unknown>,
    enabled = true,
  ) {
    enabled =
      enabled &&
      !(fieldsForAction[name] ?? []).some(
        (field) => this.#checked.has(field) && Boolean(this.fieldError(field)),
      );
    return html`<wt-button
      data-action=${name}
      variant=${enabled || this.action === name ? "primary" : "secondary"}
      ?disabled=${!enabled || Boolean(this.action)}
      ?loading=${this.action === name}
      @click=${() => this.run(name, body)}
      >${label}</wt-button
    >`;
  }
  private async json(name: string, limit = 16384): Promise<unknown> {
    const file = this.#files.get(name);
    if (!file || file.size > limit) throw new Error("Refused");
    return JSON.parse(await file.text()) as unknown;
  }
  private download(value: unknown, name: string, raw = false): void {
    const url = URL.createObjectURL(
      new Blob([raw ? (value as string) : JSON.stringify(value)], { type: "application/json" }),
    );
    this.#urls.add(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      this.#urls.delete(url);
    }, 0);
  }
  private print(documentText: string): void {
    document.querySelector("#custody-print")?.remove();
    const print = document.createElement("div");
    print.id = "custody-print";
    print.innerHTML = documentText;
    document.body.append(print);
    applyTokens(print);
    print.dataset.theme = "light";
    const clear = () => print.remove();
    window.addEventListener("afterprint", clear, { once: true });
    try {
      window.print();
    } catch {
      clear();
      throw new Error("Refused");
    }
  }
  private start(mode: "new" | "resume" | "recovery"): void {
    if (this.#session !== null) return;
    this.#session = new CustodySession(mode);
    this.revision++;
  }
  override render() {
    const t = this.t,
      session = this.#session,
      kit = session?.publicKit,
      stopped = session?.state === "stopped";
    return html`<main lang=${this.locale}>
      <header>
        <h1>${t.title}</h1>
        <span class="hint">${t.version}</span>
        <wt-button
          variant="secondary"
          @click=${() => {
            this.locale = "en";
          }}
          >EN</wt-button
        >
        <wt-button
          variant="secondary"
          @click=${() => {
            this.locale = "es";
          }}
          >ES</wt-button
        >
        <wt-button
          variant="secondary"
          @click=${() => {
            this.theme = this.theme === "light" ? "dark" : "light";
            this.dataset.theme = this.theme;
          }}
          >${this.theme === "light" ? t.dark : t.light}</wt-button
        >
      </header>
      <p>${t.separate}</p>
      ${session === null ? html`<section><div class="actions">${this.button("new", t.newMode, () => this.start("new"))}${this.button("resume", t.resumeMode, () => this.start("resume"))}${this.button("recovery", t.recoveryMode, () => this.start("recovery"))}</div></section>` : nothing}
      ${
        session !== null && !stopped
          ? html`
              <p role="status">
                ${t.state}:
                ${session.mode === "recovery" && this.#receipt?.kind === "secret-paper" ? t.paperChecked : custodyStateLabel(session.state, this.locale)}
              </p>
              ${session.mode === "existing" ? html`<section><p>${t.existingCare}</p></section>` : nothing}
              ${
                session.request
                  ? html`<section>
                      <h2>${t.bindings}</h2>
                      <dl>
                        ${[
                          [t.attempt, session.request.attemptId],
                          [t.event, session.request.binding.eventId],
                          [t.source, session.request.binding.sourceId],
                          [t.node, session.request.binding.targetNodeId],
                          [t.operator, session.request.operatorId],
                        ].map(
                          ([label, value]) =>
                            html`<dt>${label}</dt>
                              <dd>${value}</dd>`,
                        )}
                      </dl>
                    </section>`
                  : nothing
              }
              ${
                session.mode !== "recovery" && session.request === null
                  ? html`<section>
                      ${this.file("host-request", t.hostRequest)}${this.button(
                        "load-request",
                        t.loadRequest,
                        async () => {
                          await session.loadRequest(await this.json("host-request", 65536));
                        },
                        this.#files.has("host-request"),
                      )}
                    </section>`
                  : nothing
              }
              ${
                session.mode === "new" && session.request && !this.#masterAnswered
                  ? html`<section>
                      <h2>${t.existingQuestion}</h2>
                      <div class="actions">
                        ${this.button("exists", t.yes, () => {
                          session.answerMaster(true);
                          this.#masterAnswered = true;
                        })}${this.button("first", t.no, () => {
                          session.answerMaster(false);
                          this.#masterAnswered = true;
                        })}
                      </div>
                    </section>`
                  : nothing
              }
              ${
                session.mode === "new" && this.#masterAnswered && !kit
                  ? html`<section>
                      ${this.field("custodian", t.custodian)}${this.button(
                        "create",
                        t.create,
                        async () => {
                          if (!this.required(["custodian"])) return;
                          await session.createKit(this.values.custodian!);
                          this.#created = true;
                        },
                        !this.fieldErrors.custodian || Boolean(this.values.custodian),
                      )}
                    </section>`
                  : nothing
              }
              ${
                session.mode !== "new" && kit === null
                  ? html`<section>
                      ${this.file("kit-request", t.kitRequest)}${this.button(
                        "load-kit",
                        t.loadKit,
                        async () => {
                          await session.loadKitRequest(await this.json("kit-request"));
                        },
                        this.#files.has("kit-request"),
                      )}
                    </section>`
                  : nothing
              }
              ${
                kit
                  ? html`<section>
                      <h2>${t.fingerprint}</h2>
                      <p class="fingerprint">${kit.public.fingerprint}</p>
                      <p>
                        ${kit.public.scope.custodianId} / ${kit.public.scope.taxpayerNif} /
                        ${kit.public.scope.softwareId} /
                        ${custodyValueLabel(kit.public.scope.environment, this.locale)}
                      </p>
                      ${this.button("download-request", t.downloadRequest, () => this.download(kit, "kit-check-request.json"))}
                      ${this.button("public-key", t.saveKey, () => this.download({ custodianId: kit.public.scope.custodianId, publicKey: kit.public.publicKey, fingerprint: kit.public.fingerprint }, "custodian-public.json"))}
                    </section>`
                  : nothing
              }
              ${
                kit && this.#created && !this.#fileMode
                  ? html`<section>
                      ${this.field("passphrase", t.passphrase, "password")}${this.field("confirmation", t.confirmation, "password")}
                      ${this.button("save-key", t.saveFile, async () => {
                        if (!this.required(["passphrase", "confirmation"])) return;
                        try {
                          this.download(
                            await session.protectedFile(
                              this.values.passphrase!,
                              this.values.confirmation!,
                            ),
                            "custodian-key.json",
                            true,
                          );
                          this.#protectedOutput = true;
                        } finally {
                          this.clearFields(["passphrase", "confirmation"]);
                        }
                      })}
                      <p>${t.separation}</p>
                      ${this.button("secret-print", t.secretPrint, async () => {
                        this.print(await session.secretDocument(this.locale));
                        this.#secretOutput = true;
                      })}
                      <p>${t.secretWarning}</p>
                      <p>${t.printCare}</p>
                    </section>`
                  : nothing
              }
              ${
                kit && session.mode === "new"
                  ? html`<section>
                      <p>${t.originalWarning}</p>
                      ${this.button("original", t.originalPrint, () => this.print(session.originalDocument(this.locale)), session.originalStatus === "unissued")}
                      ${
                        session.originalStatus === "issued-unknown"
                          ? html`<p>${t.originalUnknown}</p>
                              ${this.field("incident", t.incident)}${this.button(
                                "original-kept",
                                t.originalKept,
                                () => {
                                  if (this.required(["incident"]))
                                    session.reconcileOriginal("kept", this.values.incident!);
                                },
                              )}${this.button("original-spoiled", t.originalSpoiled, () => {
                                if (this.required(["incident"]))
                                  session.reconcileOriginal("spoiled", this.values.incident!);
                              })}`
                          : nothing
                      }
                    </section>`
                  : nothing
              }
              ${
                kit && session.mode !== "recovery"
                  ? html`<section>
                      ${
                        !this.#fileMode
                          ? this.button(
                              "file-mode",
                              t.beginCheck,
                              () => {
                                session.beginFileCheck();
                                this.#fileMode = true;
                                this.values = { ...this.values, passphrase: "", confirmation: "" };
                              },
                              session.mode !== "new" ||
                                (session.originalStatus === "kept" &&
                                  this.#protectedOutput &&
                                  this.#secretOutput),
                            )
                          : nothing
                      }
                      ${
                        this.#fileMode
                          ? html`${this.file("saved-file", t.savedFile)}${this.field("passphrase", t.passphrase, "password")}${this.button(
                              "reopen",
                              t.reopen,
                              async () => {
                                this.#receipt = null;
                                this.#reserved = false;
                                this.#selected = "";
                                this.choices = {
                                  ...this.choices,
                                  attest: false,
                                  reserve: false,
                                  consume: false,
                                };
                                if (!this.required(["passphrase"])) return;
                                try {
                                  this.#receipt = await session.reopenFile(
                                    this.#files.get("saved-file")!,
                                    this.values.passphrase!,
                                  );
                                } finally {
                                  this.clearFields(["passphrase"]);
                                  this.#files.delete("saved-file");
                                  const input = this.shadowRoot?.querySelector<HTMLInputElement>(
                                    'input[name="saved-file"]',
                                  );
                                  if (input) input.value = "";
                                }
                              },
                              this.#files.has("saved-file"),
                            )}`
                          : nothing
                      }
                      <p>${t.paperLimit}</p>
                    </section>`
                  : nothing
              }
              ${
                session.mode === "recovery"
                  ? html`<section>
                      <p>${t.paperLimit}</p>
                      ${this.field("paper", t.paper, "text", true)}${this.field("fingerprint", t.fingerprint)}${this.button(
                        "paper-check",
                        t.checkPaper,
                        async () => {
                          this.#receipt = null;
                          if (!this.required(["paper", "fingerprint"])) return;
                          try {
                            this.#receipt = await session.checkPaper(
                              this.values.paper!,
                              this.values.fingerprint!,
                            );
                          } finally {
                            this.clearFields(["paper"]);
                          }
                        },
                        kit !== null,
                      )}
                    </section>`
                  : nothing
              }
              ${this.#receipt ? html`<section>${this.button("receipt", t.receipt, () => this.download(this.#receipt, `${this.#receipt!.kind}-check.json`))}</section>` : nothing}
              ${
                kit && (session.mode === "resume" || session.mode === "existing")
                  ? html`<section>
                      ${this.file("file-receipt", t.fileReceipt)}${this.file("paper-receipt", t.paperReceipt)}
                      ${this.button(
                        "verify",
                        t.verifyReceipts,
                        async () => {
                          await session.verifyChecks(
                            await this.json("file-receipt"),
                            await this.json("paper-receipt"),
                          );
                        },
                        this.#files.has("file-receipt") && this.#files.has("paper-receipt"),
                      )}
                      ${this.field("fingerprint", t.fingerprint)}${this.choice("attest", t.actualAttestation)}
                      ${this.button("attest", t.attest, () => session.attestCustody({ sameCurrentMaster: true, actualPaperCleanSession: true, originalIssueRecorded: true, custodyAccepted: true }, this.values.fingerprint ?? ""), this.choices.attest === true && session.state === "file-checked")}
                    </section>`
                  : nothing
              }
              ${
                session.mode !== "recovery"
                  ? html`<section>
                      ${session.mode !== "new" || session.originalStatus !== "issued-unknown" ? this.field("incident", t.incident) : nothing}
                      ${this.choice("reserve", t.consult)}${this.choice("parallel", t.noParallel)}
                      ${this.button(
                        "reserve",
                        t.reserve,
                        () => {
                          if (!this.required(["incident"])) return;
                          session.reserve({
                            currentOriginal: true,
                            otherSystemsChecked: true,
                            rowsReservedInInk: true,
                            oldMachineAbsent: true,
                            noParallelSetup: true,
                            incidentEvidence: this.values.incident,
                          });
                          this.#reserved = true;
                        },
                        session.state === "ready" &&
                          !this.#reserved &&
                          this.choices.reserve === true &&
                          this.choices.parallel === true,
                      )}
                      <div class="rows">
                        ${session.request?.candidates.map(
                          (a) =>
                            html`<div class="row">
                              ${this.button(
                                `select-${a.allocationId}`,
                                a.installationIdentity,
                                () => {
                                  this.#selected = a.allocationId;
                                },
                                this.#reserved && this.#input === null,
                              )}
                              <p>
                                ${a.series.map((s) => `${s.code} / ${custodyValueLabel(s.purpose, this.locale)}`).join(" · ")}
                              </p>
                              ${this.#selected === a.allocationId ? html`<span>${t.selected}</span>` : nothing}
                            </div>`,
                        )}
                      </div>
                      ${this.choice("consume", t.consumed)}${this.button(
                        "consume",
                        t.consume,
                        async () => {
                          if (this.required(["incident"]))
                            this.#input = await session.consume(
                              this.#selected,
                              this.values.incident!,
                            );
                        },
                        this.#reserved &&
                          Boolean(this.#selected) &&
                          this.choices.consume === true &&
                          this.#input === null &&
                          session.state === "ready",
                      )}
                      ${this.#input ? html`${this.button("save-input", t.saveInput, () => this.download(this.#input, "initial-allocation.json"))}${this.button("save-block", t.saveBlock, () => this.download(session.signedBlock, "signed-block.json"))}${this.button("snapshot", t.snapshotPrint, () => this.print(session.snapshotDocument(this.locale)))}` : nothing}
                    </section>`
                  : nothing
              }
              ${
                kit && session.mode !== "recovery"
                  ? html`<section>
                      <p>${t.handoverCare}</p>
                      ${this.field("successor", t.successor)}${this.button(
                        "handover",
                        t.handover,
                        () => {
                          if (this.required(["successor"])) {
                            session.beginHandover(this.values.successor!);
                            this.#reserved = false;
                            this.#fileMode = true;
                            this.#input = null;
                            this.#receipt = null;
                            this.#files.clear();
                            this.choices = {};
                          }
                        },
                        session.state !== "handover",
                      )}
                      ${
                        session.state === "handover"
                          ? html`${this.choice("transferred", t.handoverAttestation)}${this.field("retained", t.retainedCopies)}${this.button(
                              "handover-finish",
                              t.finishHandover,
                              () => {
                                if (this.required(["retained"]))
                                  session.finishHandover({
                                    transferred: true,
                                    currentOriginal: true,
                                    retainedCopies: this.values.retained,
                                  });
                              },
                              this.choices.transferred === true,
                            )}`
                          : nothing
                      }
                    </section>`
                  : nothing
              }
              <section>
                <p>${t.loss}</p>
                ${this.field("stop-reference", t.stopReason)}${this.button("stop", t.stop, () => {
                  if (this.required(["stop-reference"])) {
                    session.stop("uncertain", this.values["stop-reference"]!);
                    this.clearSecrets();
                  }
                })}
              </section>
            `
          : nothing
      }
      ${
        stopped
          ? html`<section>
              <p role="status">${t.state}: ${custodyStateLabel("stopped", this.locale)}</p>
              <p>${t.loss}</p>
            </section>`
          : nothing
      }
      ${session !== null ? html`<section><wt-form-actions .error=${this.error ? t[this.error] : ""}>${this.button("incident", t.saveIncident, () => this.download(session.incidentRecord(), "custody-history.json"))}${this.button("close", t.close, () => this.clearSecrets())}</wt-form-actions></section>` : nothing}
    </main>`;
  }
}
customElements.define("waitron-custody-tool", OfflineCustodyApp);
const host = document.getElementById("custodian-tool");
if (host) host.append(new OfflineCustodyApp());
