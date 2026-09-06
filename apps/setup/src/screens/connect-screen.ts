import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-input.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import { dispatchAdoptRequested, dispatchSetupGoto } from "../events.js";
import type { AdoptBody } from "../api/client.js";

/**
 * The MIRROR path's only data-collection step (C2b Task 13): connect this fresh box to an existing
 * primary. The operator types two things — the primary's **address** and an **admin login** for it
 * (`personId` + `password`, optional `totp`) — and on `Connect` the mirror calls its OWN
 * `POST /setup-api/adopt`, which fetches the primary's mirror bundle server-side (so the admin
 * credential never touches a browser→primary hop), adopts the venue into this box's database, and
 * restarts into read-only mirror mode (spec §5/§8).
 *
 * The credential is assembled as the STRUCTURED OBJECT `{ personId, password, totp? }` and carried in
 * the `adopt-requested` event's detail — never a JSON string in a single field (Task 9 deliberately
 * widened it), and never merged into the shell's provision draft (a mirror files nothing, and the
 * password must not be persisted). The shell forwards that body straight to `SetupApi.adopt`.
 *
 * On `Connect` it client-validates the three required fields non-empty (`totp` is optional) — a blank
 * one shows a SINGLE `role="alert"` banner and marks the offending field(s) `invalid`, and nothing is
 * emitted. `Back` returns to the `role` screen (the mirror path skips `mode`/`admin`/`venue`/`cert`/
 * `review` entirely). Both events are the composed/bubbling pair the shell listens for. Following
 * `apps/setup/src/screens/admin-screen.ts` for the field/`wt-change`/banner idiom.
 *
 * The connect screen holds NO seed-from-draft logic (unlike the primary-flow screens): its fields are
 * not part of the accumulated request, and a routed-back adopt failure re-mounts it fresh — the
 * operator re-enters the address and login (the password would have to be re-typed regardless, since
 * it is never stored), then re-submits, which is the mirror path's retry.
 */

/** The four fields. `primaryUrl`/`personId`/`password` are required; `totp` alone may be blank. */
type ConnectField = "primaryUrl" | "personId" | "password" | "totp";

/** The fields a `Connect` must have non-empty — `totp` is optional (the primary may not require it). */
const REQUIRED_FIELDS: readonly ConnectField[] = ["primaryUrl", "personId", "password"];

@customElement("setup-connect-screen")
export class SetupConnectScreen extends LitElement {
  static override styles = [
    baseStyles,
    fieldStyles,
    errorStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];

  /** A server-side adopt failure the shell routed back here (`mirror.bundle_fetch_failed`, a shared
   * `setup.*` guard, or a generic crash), shown as a banner so the operator can correct the address or
   * login and re-submit. `undefined` normally. */
  @property() errorMessage?: string;

  /** The editable fields. All default blank — this screen never seeds from the draft (see the class doc). */
  @state() private values: Record<ConnectField, string> = {
    primaryUrl: "",
    personId: "",
    password: "",
    totp: "",
  };

  /** The fields a `Connect` rejected — drives each field's `invalid` reflection. */
  @state() private invalid = new Set<ConnectField>();

  /** True once a `Connect` was rejected by client validation — drives the `role="alert"` banner. */
  @state() private showError = false;

  #onField(key: ConnectField, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.values = { ...this.values, [key]: event.detail.value };
  }

  /**
   * Validate non-empty, then assemble + emit. A blank required field blocks the emit, shows the banner,
   * and marks the offending field(s) `invalid`; the guard is proven by deletion (drop the `invalid.size`
   * check and a "blank field does not Connect" test flips red). `totp` is OMITTED from the credential
   * when blank (never sent as `""`), matching the server's optional-field contract.
   */
  #connect(): void {
    const invalid = new Set<ConnectField>();
    for (const key of REQUIRED_FIELDS) {
      if (this.values[key].trim() === "") invalid.add(key);
    }
    this.invalid = invalid;
    if (invalid.size > 0) {
      this.showError = true;
      return;
    }
    this.showError = false;

    const totp = this.values.totp.trim();
    // Trim the same fields the non-empty check trims (`primaryUrl`/`personId`/`totp`) so a value that
    // passed validation with trailing whitespace is not sent verbatim — an untrimmed URL fails the
    // primary's `new URL()` parse and an untrimmed personId misses the auth lookup, both confusing.
    // `password` is left verbatim: whitespace can be intentional in a secret.
    const body: AdoptBody = {
      primaryUrl: this.values.primaryUrl.trim(),
      credential: {
        personId: this.values.personId.trim(),
        password: this.values.password,
        ...(totp === "" ? {} : { totp }),
      },
    };
    dispatchAdoptRequested(this, body);
  }

  #back(): void {
    dispatchSetupGoto(this, "role");
  }

  /** Renders one field as a `wt-input`, bound to `this.values[key]` and its `invalid` state. */
  #field(label: string, key: ConnectField, type = "text"): TemplateResult {
    return html`<wt-input
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]"))}
      class="field"
      label=${label}
      data-test=${key}
      type=${type}
      ?invalid=${this.invalid.has(key)}
      .value=${this.values[key]}
      @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(key, e)}
    ></wt-input>`;
  }

  override render(): TemplateResult {
    return html`
      <wt-card>
        <h1>Connect to the primary</h1>
        <p>
          Point this mirror at the primary box and sign in with an admin login for it. The mirror
          copies the venue and then shows its data read-only — it never trades or files anything.
        </p>
        ${this.#field("Primary box address", "primaryUrl", "url")}
        ${this.#field("Admin login (person ID)", "personId")}
        ${this.#field("Admin password", "password", "password")}
        ${this.#field("Authenticator code (if required)", "totp")}
        ${
          // A SINGLE live alert region — two simultaneous `role="alert"` nodes double-announce to a
          // screen reader (backlog #149 (j)). The client-validation banner takes precedence: it names
          // a problem in what the operator just typed, so a stale server-routed message must not sit
          // beside it. The routed-back server banner shows only when there is NO client error.
          this.showError
            ? html`<p class="error" role="alert" data-test="error">
                Enter the primary box address, an admin person ID, and the admin password.
              </p>`
            : this.errorMessage === undefined
              ? nothing
              : html`<p class="error" role="alert" data-test="server-error">
                  ${this.errorMessage}
                </p>`
        }
        <div class="actions">
          <wt-button variant="ghost" data-test="back" @click=${() => this.#back()}>Back</wt-button>
          <wt-button variant="primary" data-test="connect" @click=${() => this.#connect()}
            >Connect</wt-button
          >
        </div>
      </wt-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-connect-screen": SetupConnectScreen;
  }
}
