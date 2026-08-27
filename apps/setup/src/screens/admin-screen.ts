import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-input.js";

/**
 * The wizard's second step: the first operator's credentials — a display name, a login password, and
 * a numeric PIN. All three are required; the server hashes `pin`/`password` at the boundary
 * (`apps/server/src/setup-api.ts`), so they travel plaintext and the wizard never hashes.
 *
 * On `Next` it client-validates that none is blank — a blank one shows a `role="alert"` banner and
 * marks the offending field(s) `invalid`, and nothing is emitted — then emits the admin slice as a
 * `setup-patch` and navigates to `venue`. `Back` returns to `mode`. Both nav events are the composed/
 * bubbling pair the shell listens for. Following `apps/dashboard/src/screens/login-screen.ts` for the
 * field/`wt-change`/error idiom.
 */
@customElement("setup-admin-screen")
export class SetupAdminScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }

      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }

      .actions {
        display: flex;
        gap: var(--wt-space-3);
        margin-top: var(--wt-space-4);
      }
    `,
  ];

  @state() private displayName = "";
  @state() private password = "";
  @state() private pin = "";
  @state() private invalid = new Set<"displayName" | "password" | "pin">();

  /** True once a `Next` with a blank field has been rejected — drives the `role="alert"` banner. */
  @state() private showError = false;

  #onDisplayName(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.displayName = event.detail.value;
  }

  #onPassword(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.password = event.detail.value;
  }

  #onPin(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.pin = event.detail.value;
  }

  /**
   * Validate non-empty, then emit. A blank field blocks the emit, shows the banner, and marks the
   * blank field(s) `invalid`; the guard is proven by deletion (drop the `invalid.size` check and a
   * "blank fields do not advance" test flips red).
   */
  #next(): void {
    const invalid = new Set<"displayName" | "password" | "pin">();
    if (this.displayName.trim() === "") invalid.add("displayName");
    if (this.password.trim() === "") invalid.add("password");
    if (this.pin.trim() === "") invalid.add("pin");
    this.invalid = invalid;
    if (invalid.size > 0) {
      this.showError = true;
      return;
    }
    this.showError = false;
    this.dispatchEvent(
      new CustomEvent("setup-patch", {
        detail: {
          patch: {
            venue: {
              admin: {
                displayName: this.displayName,
                pin: this.pin,
                password: this.password,
              },
            },
          },
        },
        bubbles: true,
        composed: true,
      }),
    );
    this.dispatchEvent(
      new CustomEvent("setup-goto", { detail: { screen: "venue" }, bubbles: true, composed: true }),
    );
  }

  #back(): void {
    this.dispatchEvent(
      new CustomEvent("setup-goto", { detail: { screen: "mode" }, bubbles: true, composed: true }),
    );
  }

  override render(): TemplateResult {
    return html`
      <wt-card>
        <h1>The first operator</h1>
        <p>Create the account that manages this box. You can add more people later.</p>
        <wt-input
          class="field"
          label="Display name"
          data-test="displayName"
          ?invalid=${this.invalid.has("displayName")}
          .value=${this.displayName}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onDisplayName(e)}
        ></wt-input>
        <wt-input
          class="field"
          label="Password"
          type="password"
          data-test="password"
          ?invalid=${this.invalid.has("password")}
          .value=${this.password}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPassword(e)}
        ></wt-input>
        <wt-input
          class="field"
          label="PIN"
          type="password"
          data-test="pin"
          ?invalid=${this.invalid.has("pin")}
          .value=${this.pin}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPin(e)}
        ></wt-input>
        ${
          this.showError
            ? html`<p class="error" role="alert" data-test="error">
                Enter a display name, password and PIN for the first operator.
              </p>`
            : nothing
        }
        <div class="actions">
          <wt-button variant="ghost" data-test="back" @click=${() => this.#back()}>Back</wt-button>
          <wt-button variant="primary" data-test="next" @click=${() => this.#next()}
            >Next</wt-button
          >
        </div>
      </wt-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-admin-screen": SetupAdminScreen;
  }
}
