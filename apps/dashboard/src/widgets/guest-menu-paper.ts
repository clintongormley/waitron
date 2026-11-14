import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, saveActionState, type DraftScope } from "@waitron/ui";
import { WAITRON_DEFAULTS } from "@waitron/ui-core/theme/waitron";
import type { GuestMenuPaperAppearance } from "@waitron/shared";
import type { DashboardApi } from "../api/client.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { colorField, colorFieldStyles } from "./color-field.js";
import { printGuestMenu } from "./guest-menu-print.js";
import "./image-upload.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-form-actions.js";

@customElement("dashboard-guest-menu-paper")
export class GuestMenuPaper extends LitElement {
  static override styles = [
    baseStyles,
    colorFieldStyles,
    css`
      :host {
        display: block;
        margin-top: var(--wt-space-5);
      }
      .fields {
        display: grid;
        gap: var(--wt-space-3);
      }
      .member {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
      iframe {
        width: 100%;
        height: calc(var(--wt-space-6) * 18);
        border: 1px solid var(--wt-color-border);
        margin-top: var(--wt-space-3);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property() menuId = "";
  @property() versionId = "";
  @property() language = "en";
  @property({ attribute: false }) members: string[] = [];
  @property({ attribute: false }) draftParent?: object;
  @state() private paper: GuestMenuPaperAppearance = this.#defaults();
  @state() private order: number[] = [];
  @state() private breaks: number[] = [];
  @state() private logo: string | null = null;
  @state() private printed = "";
  @state() private busy = false;
  @state() private status: Awaited<ReturnType<DashboardApi["getGuestMenuSharing"]>> | null = null;
  @state() private error = "";
  #scope?: DraftScope<GuestMenuPaperAppearance>;
  #generation = 0;
  #defaults(): GuestMenuPaperAppearance {
    return {
      preset: "bistro",
      font: "serif",
      spacing: "comfortable",
      key: "end",
      ink: WAITRON_DEFAULTS.light["--wt-color-text"]!,
      accent: WAITRON_DEFAULTS.light["--wt-color-primary-text"]!,
    };
  }
  override disconnectedCallback() {
    this.#generation++;
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }
  protected override willUpdate(changed: PropertyValues) {
    if (changed.has("versionId")) {
      this.#generation++;
      this.order = this.members.map((_, i) => i);
      this.breaks = [];
      this.logo = null;
      this.printed = "";
      this.#scope?.dispose();
      this.#scope = undefined;
      void this.#read();
    }
    if (changed.has("language")) this.printed = "";
  }
  async #read() {
    const generation = this.#generation;
    this.status = null;
    this.error = "";
    try {
      const status = await this.api.getGuestMenuSharing();
      if (generation !== this.#generation || !this.isConnected) return;
      this.status = status;
      this.paper = { ...(status.paper ?? this.#defaults()) };
      this.#scope = draftScopeFor(this, {
        id: this,
        parent: this.draftParent,
        current: () => this.paper,
        snapshot: (v) => ({ ...v }),
        equal: (a, b) =>
          Object.keys(a).every((k) => a[k as keyof typeof a] === b[k as keyof typeof b]),
        restore: (v) => {
          this.paper = { ...v };
          this.printed = "";
        },
      }).scope;
      this.#scope.commit(this.paper);
    } catch (error) {
      if (generation === this.#generation) this.error = codeMessage(codeOf(error));
    }
  }
  #edit(patch: Partial<GuestMenuPaperAppearance>) {
    this.paper = { ...this.paper, ...patch };
    this.printed = "";
    this.error = "";
    this.#scope?.changed();
  }
  async #save() {
    if (!this.status || this.busy || saveActionState(this.#scope).unchanged) return;
    this.busy = true;
    this.error = "";
    const submitted = { ...this.paper };
    try {
      this.status = await this.api.setGuestMenuSharing(
        this.status.enabled,
        this.status.revision,
        submitted,
      );
      this.#scope?.commit(submitted);
    } catch (error) {
      this.error = codeMessage(codeOf(error));
      if (codeOf(error) === "settings.out_of_date") {
        try {
          this.status = await this.api.getGuestMenuSharing();
        } catch {
          /* Retain the write refusal. */
        }
      }
    } finally {
      this.busy = false;
    }
  }
  async #preview() {
    if (!this.status || this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      const answer = await this.api.getGuestMenuPaper(this.menuId, {
        versionId: this.versionId,
        language: this.language,
        paper: this.paper,
        order: this.order,
        breaks: this.breaks,
        logo: this.logo,
      });
      this.printed = answer.html;
    } catch (error) {
      this.error = codeMessage(codeOf(error));
    } finally {
      this.busy = false;
    }
  }
  override render() {
    const action = saveActionState(this.#scope);
    return html`<h2>${t("menus.paper_title")}</h2>
      <div class="fields">
        ${(
          [
            ["preset", ["bistro", "lunch-wine"]],
            ["font", ["serif", "sans"]],
            ["spacing", ["comfortable", "compact"]],
            ["key", ["end", "inline"]],
          ] as const
        ).map(
          ([key, values]) =>
            html` <wt-combobox
              name=${`paper-${key}`}
              label=${t(`menus.paper_${key}`)}
              .value=${this.paper[key]}
              .disabled=${this.busy || !this.status}
              .options=${values.map((value) => ({ value, label: t(`menus.paper_${value}`) }))}
              @wt-change=${(e: CustomEvent<{ value: string }>) => {
                e.stopPropagation();
                this.#edit({ [key]: e.detail.value });
              }}
            ></wt-combobox>`,
        )}
        ${(["ink", "accent"] as const).map((key) => colorField({ color: this.paper[key], noneChoice: { label: t("editor.color_use_default"), chip: this.#defaults()[key] }, name: `paper-${key}`, legend: t(`menus.paper_${key}`), busy: this.busy || !this.status, error: "", errorId: `paper-${key}-error`, change: (value) => this.#edit({ [key]: value ?? this.#defaults()[key] }) }))}
        <dashboard-image-upload
          venue-logo
          .api=${this.api}
          .image=${this.logo}
          .draftParent=${this.draftParent}
          .disabled=${this.busy}
          label=${t("menus.paper_logo")}
          addLabel=${t("menus.paper_logo")}
          @image-changed=${(e: CustomEvent<{ image: string | null }>) => {
            e.stopPropagation();
            this.logo = e.detail.image;
            this.printed = "";
          }}
        ></dashboard-image-upload>
        <h3>${t("menus.paper_order")}</h3>
        ${this.order.map(
          (index, position) =>
            html`<div class="member">
              <span>${this.members[index]}</span>
              <wt-button
                variant="secondary"
                .disabled=${position === 0 || this.busy}
                aria-label=${`${t("menus.paper_up")} ${this.members[index]}`}
                @click=${() => {
                  const order = [...this.order];
                  [order[position - 1], order[position]] = [order[position]!, order[position - 1]!];
                  this.order = order;
                  this.printed = "";
                }}
                >${t("menus.paper_up")}</wt-button
              >
              <wt-switch
                .checked=${this.breaks.includes(index)}
                .disabled=${this.busy || position === 0}
                @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
                  e.stopPropagation();
                  this.breaks = e.detail.checked
                    ? [...this.breaks, index]
                    : this.breaks.filter((i) => i !== index);
                  this.printed = "";
                }}
                >${t("menus.paper_break")}</wt-switch
              >
            </div>`,
        )}
        <wt-form-actions error=${this.error}>
          <wt-button
            id="save-paper"
            variant=${action.variant}
            .disabled=${this.busy || !this.status || action.unchanged}
            @click=${() => this.#save()}
            >${t("menus.paper_save")}</wt-button
          >
        </wt-form-actions>
        ${!this.status && this.error ? html`<wt-button variant="secondary" @click=${() => this.#read()}>${t("content_languages.retry")}</wt-button>` : nothing}
        <wt-button
          id="preview-paper"
          variant=${this.status ? "primary" : "secondary"}
          .disabled=${this.busy || !this.status}
          @click=${() => this.#preview()}
          >${t("menus.paper_preview")}</wt-button
        >
        <wt-button
          id="print-paper"
          variant=${this.printed ? "primary" : "secondary"}
          .disabled=${this.busy || !this.printed}
          @click=${() => printGuestMenu(this.printed)}
          >${t("menus.paper_print")}</wt-button
        >
      </div>
      ${this.printed ? html`<iframe title=${t("menus.paper_preview")} sandbox="allow-same-origin" .srcdoc=${this.printed}></iframe>` : nothing}`;
  }
}
