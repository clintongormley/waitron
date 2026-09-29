import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { focusFirstInvalid, submitOnEnter, baseStyles } from "@waitron/ui";
import { deriveDisplayName } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { passwordIcon } from "../password-icon.js";
import { actionsStyles, fieldStyles } from "../form-styles.js";
import { dispatchSetupGoto, dispatchSetupPatch } from "../events.js";
import type { DeepPartial } from "../setup-app.js";
import type { ProvisionBody } from "../api/client.js";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";

type AdminField = "firstNames" | "lastNames" | "displayName" | "email" | "password" | "pin";

const FIELDS: readonly AdminField[] = [
  "firstNames",
  "lastNames",
  "displayName",
  "email",
  "password",
  "pin",
];

interface FieldText {
  label: StringKey;
  error: StringKey;
  helpLabel: StringKey;
  help: StringKey;
}

const FIELD_TEXT: Record<AdminField, FieldText> = {
  firstNames: {
    label: "admin.first_names.label",
    error: "admin.first_names.error",
    helpLabel: "admin.first_names.help_label",
    help: "admin.first_names.help",
  },
  lastNames: {
    label: "admin.last_names.label",
    error: "admin.last_names.error",
    helpLabel: "admin.last_names.help_label",
    help: "admin.last_names.help",
  },
  displayName: {
    label: "admin.display_name.label",
    error: "admin.display_name.error",
    helpLabel: "admin.display_name.help_label",
    help: "admin.display_name.help",
  },
  email: {
    label: "admin.email.label",
    error: "admin.email.error",
    helpLabel: "admin.email.help_label",
    help: "admin.email.help",
  },
  password: {
    label: "admin.password.label",
    error: "admin.password.error",
    helpLabel: "admin.password.help_label",
    help: "admin.password.help",
  },
  pin: {
    label: "admin.pin.label",
    error: "admin.pin.error",
    helpLabel: "admin.pin.help_label",
    help: "admin.pin.help",
  },
};

@customElement("setup-admin-screen")
export class SetupAdminScreen extends LitElement {
  static override styles = [
    baseStyles,
    fieldStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];

  @property({ attribute: false }) draft: DeepPartial<ProvisionBody> = {};

  @state() private values: Record<AdminField, string> = {
    firstNames: "",
    lastNames: "",
    displayName: "",
    email: "",
    password: "",
    pin: "",
  };
  @state() private visible = new Set<AdminField>();
  @state() private attempted = false;

  #seeded = false;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override willUpdate(): void {
    if (this.#seeded) return;
    this.#seeded = true;
    this.#seedFromDraft();
  }

  #seedFromDraft(): void {
    const admin = this.draft.venue?.admin ?? {};
    this.values = {
      firstNames: admin.firstNames ?? this.values.firstNames,
      lastNames: admin.lastNames ?? this.values.lastNames,
      displayName: admin.displayName ?? this.values.displayName,
      email: admin.email ?? this.values.email,
      password: admin.password ?? this.values.password,
      pin: admin.pin ?? this.values.pin,
    };
  }

  #onField(key: AdminField, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const prev = this.values;
    const values = { ...prev, [key]: event.detail.value };
    if (key === "firstNames" || key === "lastNames") {
      values.displayName = deriveDisplayName(
        prev.displayName,
        prev.firstNames,
        prev.lastNames,
        values.firstNames,
        values.lastNames,
      );
    }
    this.values = values;
  }

  #errors(): Set<AdminField> {
    if (!this.attempted) return new Set();
    return new Set(FIELDS.filter((key) => this.values[key].trim() === ""));
  }

  #next(): void {
    this.attempted = true;
    if (this.#errors().size > 0) {
      void this.updateComplete.then(() => {
        if (this.isConnected) void focusFirstInvalid(this.shadowRoot!);
      });
      return;
    }
    dispatchSetupPatch(this, {
      venue: {
        admin: {
          firstNames: this.values.firstNames,
          lastNames: this.values.lastNames,
          displayName: this.values.displayName,
          email: this.values.email,
          pin: this.values.pin,
          password: this.values.password,
        },
      },
    });
    dispatchSetupGoto(this, "venue");
  }

  #back(): void {
    dispatchSetupGoto(this, "mode");
  }

  #field(key: AdminField, invalid: boolean, type = "text"): TemplateResult {
    const text = FIELD_TEXT[key];
    const fieldPurpose = {
      firstNames: { name: "given-name", autocomplete: "given-name" },
      lastNames: { name: "family-name", autocomplete: "family-name" },
      displayName: { name: "name", autocomplete: "name" },
      email: { name: "email", autocomplete: "username" },
      password: { name: "new-password", autocomplete: "new-password" },
      pin: { name: "pin", autocomplete: "off" },
    }[key];
    return html`<wt-input
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=next]"))}
      class="field"
      label=${t(text.label)}
      data-test=${key}
      name=${fieldPurpose.name}
      autocomplete=${fieldPurpose.autocomplete}
      type=${this.visible.has(key) ? "text" : type}
      required
      error=${invalid ? t(text.error) : ""}
      ?invalid=${invalid}
      .value=${this.values[key]}
      @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(key, e)}
    >
      <wt-help-tooltip slot="help" aria-label=${t(text.helpLabel)}>${t(text.help)}</wt-help-tooltip>
      ${
        type === "password"
          ? html`<wt-button
              slot="end"
              variant="ghost"
              data-test=${`toggle-${key}`}
              aria-label=${t(
                key === "pin"
                  ? this.visible.has(key)
                    ? "admin.hide_pin"
                    : "admin.show_pin"
                  : this.visible.has(key)
                    ? "admin.hide_password"
                    : "admin.show_password",
              )}
              @click=${() => {
                const visible = new Set(this.visible);
                if (visible.has(key)) visible.delete(key);
                else visible.add(key);
                this.visible = visible;
              }}
              >${passwordIcon(this.visible.has(key))}</wt-button
            >`
          : nothing
      }
    </wt-input>`;
  }

  override render(): TemplateResult {
    const errors = this.#errors();
    const field = (key: AdminField, type?: string) => this.#field(key, errors.has(key), type);
    return html`
      <h1>${t("admin.heading")}</h1>
      <p>${t("admin.intro")}</p>
      ${field("firstNames")} ${field("lastNames")} ${field("displayName")}
      ${field("email", "email")} ${field("password", "password")} ${field("pin", "password")}
      <wt-form-actions .error=${errors.size > 0 ? t("admin.fix_fields") : ""}>
        <wt-button variant="ghost" slot="cancel" data-test="back" @click=${() => this.#back()}
          >${t("admin.back")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="next"
          ?disabled=${errors.size > 0}
          @click=${() => this.#next()}
          >${t("admin.next")}</wt-button
        >
      </wt-form-actions>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-admin-screen": SetupAdminScreen;
  }
}
