import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  leaveCoordinatorFor,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveReason,
} from "@waitron/ui";
import type { ContentLanguages } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import type { WtModal } from "@waitron/ui/src/components/wt-modal.js";
import type { DashboardApi } from "../api/client.js";
import type { Course } from "../api/kitchen-api.js";
import { codeMessage, codeOf, fieldOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { optionalTextFields } from "./form-fields.js";
import { sameValue } from "./product-editor-model.js";

type Names = Record<string, string>;

@customElement("dashboard-course-names-dialog")
export class CourseNamesDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      fieldset {
        display: grid;
        gap: var(--wt-space-3);
        min-width: 0;
        border: 0;
        margin: 0;
        padding: 0;
      }
      legend {
        padding: 0;
        margin-bottom: var(--wt-space-2);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) course!: Course;
  @property({ attribute: false }) languages!: ContentLanguages;
  @query("wt-modal") private modal!: WtModal;
  @state() private names: Names = {};
  @state() private saving = false;
  @state() private refusal = "";
  #scope?: DraftScope<Names>;
  #saved = false;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("course")) return;
    this.names = { ...this.course.customerNames };
    this.#scope?.dispose();
    this.#scope = draftScopeFor<Names>(this, {
      id: this,
      current: () => this.#submitted(),
      snapshot: (value) => ({ ...value }),
      equal: sameValue,
      restore: (value) => {
        this.names = value;
        this.refusal = "";
      },
    }).scope;
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    super.disconnectedCallback();
  }

  #submitted(): Names {
    return Object.fromEntries(
      Object.entries(this.names)
        .map(([language, name]) => [language, name.trim()])
        .filter(([, name]) => name !== ""),
    );
  }

  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.saving) return false;
    const leave = leaveCoordinatorFor(this);
    return (
      !leave || (await leave.request({ scopes: [this], reason, proceed() {} })) === "proceeded"
    );
  };

  async #save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving || saveActionState(this.#scope).unchanged) return;
    const submitted = this.#submitted();
    this.saving = true;
    this.refusal = "";
    try {
      await this.api.updateCourse(this.course.id, { customerNames: submitted });
      this.#scope?.commit(submitted);
      this.#saved = true;
      this.modal.closeAfter("saved");
    } catch (error) {
      this.refusal = codeMessage(codeOf(error), undefined, { field: fieldOf(error) });
    } finally {
      this.saving = false;
    }
  }

  override render() {
    const action = saveActionState(this.#scope);
    return html`<wt-modal
      size="compact"
      heading=${this.course.name}
      .open=${true}
      .dismissible=${!this.saving}
      .beforeClose=${this.#beforeClose}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.dispatchEvent(
          new CustomEvent("course-names-closed", {
            detail: { saved: this.#saved },
            bubbles: true,
            composed: true,
          }),
        );
      }}
    >
      <form
        @submit=${this.#save}
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.renderRoot.querySelector('[data-test="save"]'))}
      >
        <fieldset>
          <legend>${t("sections.customer_names")}</legend>
          ${optionalTextFields(
            { busy: this.saving, locales: this.languages.languages, error: () => "" },
            "customerNames",
            t("sections.customer_name"),
            this.names,
            (names) => {
              this.names = names;
              this.refusal = "";
              this.#scope?.changed();
            },
            () => this.course.name,
          )}
        </fieldset>
      </form>
      <wt-form-actions slot="footer" .error=${this.refusal}>
        <wt-button
          slot="cancel"
          variant="secondary"
          .disabled=${this.saving}
          @click=${() => void this.modal.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="save"
          variant=${action.variant}
          .disabled=${action.unchanged || this.saving}
          .loading=${this.saving}
          @click=${this.#save}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }
}
