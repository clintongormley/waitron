import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import {
  baseStyles,
  draftScopeFor,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { isSharedDisplay } from "../device-profile-types.js";
import type { DashboardApi } from "../api/client.js";
import { codeOf, codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

export interface EquipmentProfileAssignment {
  name: string;
  kind: "reader" | "receipt" | "office";
  selectEligible?: boolean;
  load(): Promise<{ id: string; name: string; eligible: boolean }[]>;
  save(profileIds: string[]): Promise<void>;
}

type PrinterProfiles = Pick<DashboardApi, "listDeviceProfiles" | "assignPrinterProfiles">;

export function printerProfileAssignment(
  api: PrinterProfiles,
  id: string,
  name: string,
  kind: "receipt" | "office",
): EquipmentProfileAssignment {
  return {
    name,
    kind,
    load: async () =>
      (await api.listDeviceProfiles())
        .filter(({ formFactor }) => !isSharedDisplay(formFactor))
        .map(({ id, name }) => ({ id, name, eligible: true })),
    save: (profileIds) => api.assignPrinterProfiles(id, profileIds),
  };
}

@customElement("dashboard-equipment-profile-picker")
export class EquipmentProfilePicker extends LitElement {
  static override styles = [
    baseStyles,
    css`
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      li {
        border-bottom: 1px solid var(--wt-color-border);
      }
      label {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-block-size: var(--wt-tap-min);
        overflow-wrap: anywhere;
        cursor: pointer;
      }
      input {
        margin: 0;
        accent-color: var(--wt-color-primary);
      }
      label:has(:disabled) {
        cursor: default;
      }
      small,
      .hint {
        display: block;
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) assignment!: EquipmentProfileAssignment;
  @state() private choices?: Awaited<ReturnType<EquipmentProfileAssignment["load"]>>;
  @state() private selected: string[] = [];
  @state() private busy = false;
  @state() private error: string | null = null;
  #scope?: DraftScope<string[]>;
  #leave?: LeaveCoordinator;

  override firstUpdated(): void {
    void this.#load();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    super.disconnectedCallback();
  }

  async #load(): Promise<void> {
    this.error = null;
    try {
      const choices = await this.assignment.load();
      if (!this.isConnected) return;
      this.choices = choices;
      this.selected = this.assignment.selectEligible
        ? choices
            .filter(({ eligible }) => eligible)
            .map(({ id }) => id)
            .sort()
        : [];
      ({ scope: this.#scope, coordinator: this.#leave } = draftScopeFor(this, {
        id: this,
        snapshot: (ids) => [...ids],
        equal: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]),
        current: () => this.selected,
        restore: (ids) => {
          this.selected = ids;
        },
      }));
    } catch (error) {
      this.error = codeOf(error);
    }
  }

  readonly #beforeClose = async (reason: LeaveReason) =>
    !this.busy &&
    (!this.#leave ||
      !this.#scope ||
      (await this.#leave.request({ scopes: [this.#scope.id], reason, proceed: () => {} })) ===
        "proceeded");

  #select(id: string, checked: boolean): void {
    this.selected = checked
      ? [...this.selected, id].sort()
      : this.selected.filter((value) => value !== id);
    this.#scope?.changed();
  }

  async #save(): Promise<void> {
    if (this.busy || this.selected.length === 0) return;
    this.error = null;
    this.busy = true;
    const submitted = this.selected;
    try {
      await this.assignment.save(submitted);
      if (!this.isConnected) return;
      this.#scope?.commit(submitted);
      this.renderRoot.querySelector<WtDialog>("wt-dialog")!.closeAfter("saved");
    } catch (error) {
      this.error = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  override render() {
    const { kind, name } = this.assignment;
    const action = saveActionState(this.#scope, {
      savableAtOpen: this.assignment.selectEligible ?? false,
    });
    return html`<wt-dialog
      data-test="equipment-profile-picker"
      heading=${t(kind === "reader" ? "equipment_profiles.reader_heading" : "equipment_profiles.printer_heading")}
      .open=${true}
      .beforeClose=${this.#beforeClose}
      @wt-close=${() => this.dispatchEvent(new CustomEvent("equipment-profiles-closed"))}
    >
      <p>
        ${name}
        ${kind === "reader" ? nothing : html`<span class="hint">${t(`equipment_profiles.${kind}`)}</span>`}
      </p>
      ${
        this.choices === undefined
          ? this.error === null
            ? html`<p role="status">${t("equipment_profiles.loading")}</p>`
            : nothing
          : this.choices.length === 0
            ? html`<p>${t("equipment_profiles.empty")}</p>`
            : html`<ul>
                ${this.choices.map(
                  ({ id, name, eligible }) =>
                    html`<li>
                      <label for=${`equipment-profile-${id}`}>
                        <input
                          type="checkbox"
                          name="profileIds"
                          id=${`equipment-profile-${id}`}
                          data-test=${`equipment-profile-${id}`}
                          .checked=${this.selected.includes(id)}
                          ?disabled=${!eligible || this.busy}
                          aria-describedby=${ifDefined(eligible ? undefined : `equipment-profile-unavailable-${id}`)}
                          @change=${(event: Event) => this.#select(id, (event.currentTarget as HTMLInputElement).checked)}
                        />
                        ${name}
                      </label>
                      ${eligible ? nothing : html`<small id=${`equipment-profile-unavailable-${id}`}>${t("equipment_profiles.reader_unavailable")}</small>`}
                    </li>`,
                )}
              </ul>`
      }
      <wt-form-actions slot="footer" .error=${this.error === null ? "" : codeMessage(this.error)}>
        <wt-button
          slot="cancel"
          data-test="leave-equipment-unassigned"
          ?disabled=${this.busy}
          @click=${() => void this.renderRoot.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel")}
        >
          ${t("equipment_profiles.leave")}
        </wt-button>
        ${
          this.choices === undefined && this.error !== null
            ? html`<wt-button variant="primary" @click=${() => void this.#load()}
                >${t("equipment_profiles.retry")}</wt-button
              >`
            : html`<wt-button
                data-test="save-equipment-profiles"
                variant=${this.selected.length === 0 ? "secondary" : action.variant}
                ?disabled=${this.selected.length === 0}
                ?loading=${this.busy}
                @click=${() => void this.#save()}
                >${t("equipment_profiles.save")}</wt-button
              >`
        }
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-equipment-profile-picker": EquipmentProfilePicker;
  }
}
