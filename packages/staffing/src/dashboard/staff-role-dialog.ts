import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { codeMessage, codeOf } from "@waitron/dashboard-kit";
import { CALENDAR_COLOURS } from "@waitron/venue-service/hours-types";
import type { CalendarColour, StaffPerson, StaffRole, StaffingApi } from "./client.js";
import { colourName, t, tf } from "./strings.js";

type Draft = { name: string; colour: CalendarColour; holderIds: string[] };
type Refusal = { code: string; params?: Record<string, unknown> };

const sorted = (ids: readonly string[]) => [...ids].sort();
const copy = (draft: Draft): Draft => ({ ...draft, holderIds: sorted(draft.holderIds) });
const sameHolders = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && sorted(a).every((id, index) => id === sorted(b)[index]);
const sameDetails = (a: Draft, b: Draft) =>
  a.name.trim() === b.name.trim() && a.colour === b.colour;
const same = (a: Draft, b: Draft) => sameDetails(a, b) && sameHolders(a.holderIds, b.holderIds);
const draftOf = (staffRole?: StaffRole): Draft =>
  staffRole
    ? { name: staffRole.name, colour: staffRole.colour, holderIds: sorted(staffRole.holderIds) }
    : { name: "", colour: "blue", holderIds: [] };

/**
 * Adds or edits one staff role and who holds it. A new staff role is created first and its people
 * set after; when only that second write fails, the dialog stays open on the created staff role,
 * says so above the buttons, and Save sends only the people again.
 */
@customElement("staff-role-dialog")
export class StaffRoleDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .form {
        display: grid;
        gap: var(--wt-space-4);
        padding-block: var(--wt-space-3);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) api!: StaffingApi;
  /** The staff role being edited; absent for a new one. */
  @property({ attribute: false }) staffRole?: StaffRole;
  @state() private draft: Draft = draftOf();
  @state() private attempted = false;
  @state() private busy = false;
  @state() private refusal?: Refusal;
  /** Set when a write of the details succeeded and the holders' write after it did not. */
  @state() private holdersRefused?: string;
  @state() private people?: StaffPerson[];
  @state() private peopleError?: string;
  /** Whether any write succeeded since the dialog opened, so the host knows to read again. */
  private wrote = false;
  /** The id written to: the edited staff role, or the one this dialog has created. */
  @state() private savedId?: string;
  private scope?: DraftScope<Draft>;
  private leave?: LeaveCoordinator;
  private identity?: object;
  private openedFor?: string;
  private baseline?: Draft;
  private generation = {};

  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback() {
    this.scope?.dispose();
    this.scope = undefined;
    this.leave = undefined;
    this.generation = {};
    this.busy = false;
    super.disconnectedCallback();
  }
  protected override willUpdate() {
    if (!this.open) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.identity = undefined;
      this.baseline = undefined;
      this.generation = {};
      return;
    }
    if (!this.identity || this.openedFor !== this.staffRole?.id) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.identity = {};
      this.generation = {};
      this.openedFor = this.staffRole?.id;
      this.savedId = this.staffRole?.id;
      this.wrote = false;
      this.draft = draftOf(this.staffRole);
      this.baseline = copy(this.draft);
      this.attempted = false;
      this.busy = false;
      this.refusal = undefined;
      this.holdersRefused = undefined;
      this.people = undefined;
      this.peopleError = undefined;
    }
    if (this.isConnected && !this.scope) {
      const { scope, coordinator } = draftScopeFor(this, {
        id: this.identity,
        current: () => copy(this.draft),
        snapshot: copy,
        equal: same,
        restore: (value) => {
          this.draft = copy(value);
        },
      });
      this.scope = scope;
      this.leave = coordinator;
      scope.commit(this.baseline!);
      // A read started before a disconnect is dropped with its generation, so it starts again here.
      if (this.people === undefined && this.peopleError === undefined) this.loadPeople();
    }
  }
  private loadPeople() {
    const generation = this.generation;
    this.api.listPeople().then(
      (people) => {
        if (generation === this.generation) this.people = people;
      },
      (error: unknown) => {
        if (generation === this.generation) this.peopleError = codeMessage(codeOf(error));
      },
    );
  }
  private get refusedName(): string {
    const refusal = this.refusal;
    if (refusal?.code === "staff_role.name_taken") return codeMessage(refusal.code);
    if (refusal?.code === "staffing.invalid" && refusal.params?.field === "name")
      return t("staffing.role.name_required");
    return "";
  }
  private get nameError(): string {
    if (this.refusedName) return this.refusedName;
    return this.attempted && this.draft.name.trim() === "" ? t("staffing.role.name_required") : "";
  }
  private get failsOwnChecks(): boolean {
    return this.draft.name.trim() === "";
  }
  private bottomMessage(): string {
    const messages: string[] = [];
    if (this.peopleError)
      messages.push(tf("staffing.role.people_error", { reason: this.peopleError }));
    if (this.holdersRefused)
      messages.push(tf("staffing.role.people_not_saved", { reason: this.holdersRefused }));
    if (this.refusal && this.refusedName === "") messages.push(codeMessage(this.refusal.code));
    if (this.nameError) messages.push(t("staffing.role.fix_fields"));
    if (messages.length < 2) return messages.join("");
    return messages.map((message) => (/[.!?]$/.test(message) ? message : `${message}.`)).join(" ");
  }
  private change(next: Draft, field: "name" | "other") {
    if (field === "name" && this.refusedName) this.refusal = undefined;
    this.draft = next;
    this.scope?.changed();
  }
  private emit(name: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  private async save() {
    if (!this.open || !this.isConnected || this.busy || saveActionState(this.scope).unchanged)
      return;
    this.attempted = true;
    this.refusal = undefined;
    this.holdersRefused = undefined;
    if (this.failsOwnChecks) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    const generation = this.generation;
    const identity = this.identity;
    const submitted = copy({ ...this.draft, name: this.draft.name.trim() });
    const details = { name: submitted.name, colour: submitted.colour };
    const baseline = this.baseline!;
    this.busy = true;
    let saved: StaffRole | undefined;
    try {
      if (this.savedId === undefined) saved = await this.api.createStaffRole(details);
      else if (!sameDetails(submitted, baseline))
        saved = await this.api.updateStaffRole(this.savedId, details);
    } catch (error) {
      if (generation !== this.generation) return;
      this.busy = false;
      const { params } = error as { params?: Record<string, unknown> };
      this.refusal = { code: codeOf(error), params };
      return;
    }
    // Taken out of the page and put back still open on the same subject, the dialog keeps the
    // created id, or its next Save would create a second staff role.
    if (saved && this.open && identity === this.identity) {
      this.savedId = saved.id;
      this.wrote = true;
    }
    if (generation !== this.generation) return;
    if (saved) {
      this.baseline = { ...baseline, name: saved.name, colour: saved.colour };
      this.scope?.commit(this.baseline);
    }
    if (!sameHolders(submitted.holderIds, this.baseline!.holderIds)) {
      try {
        saved = await this.api.setHolders(this.savedId!, submitted.holderIds);
        this.wrote = true;
      } catch (error) {
        if (generation !== this.generation) return;
        this.busy = false;
        this.holdersRefused = codeMessage(codeOf(error));
        return;
      }
      if (generation !== this.generation) return;
    }
    this.busy = false;
    this.baseline = submitted;
    this.scope?.commit(submitted);
    this.emit("staff-role-saved", saved);
    this.shadowRoot!.querySelector("wt-modal")!.closeAfter("saved");
  }
  private readonly beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (!this.isConnected || this.busy) return false;
    if (!this.scope || !this.leave) return true;
    const generation = this.generation;
    const outcome = await this.leave.request({ scopes: [this.scope.id], reason, proceed() {} });
    return this.isConnected && generation === this.generation && outcome === "proceeded";
  };
  private peopleOptions() {
    const offered = (this.people ?? []).filter(
      (person) => person.status !== "suspended" || this.draft.holderIds.includes(person.personId),
    );
    return offered.map((person) => ({ value: person.personId, label: person.displayName }));
  }
  private form() {
    const action = saveActionState(this.scope);
    return html`<div class="form">
        <wt-input
          name="name"
          label=${t("staffing.role.name")}
          required
          .value=${this.draft.name}
          .error=${this.nameError}
          ?disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.change({ ...this.draft, name: event.detail.value }, "name");
          }}
        ></wt-input>
        <wt-combobox
          name="colour"
          label=${t("staffing.role.colour")}
          search="never"
          .value=${this.draft.colour}
          .options=${CALENDAR_COLOURS.map((colour) => ({ value: colour, label: colourName(colour) }))}
          ?disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ value: CalendarColour }>) => {
            event.stopPropagation();
            this.change({ ...this.draft, colour: event.detail.value }, "other");
          }}
        ></wt-combobox>
        <wt-combobox
          name="people"
          label=${t("staffing.role.people")}
          multiple
          placeholder=${t("staffing.role.people_placeholder")}
          searchPlaceholder=${t("staffing.role.search")}
          noResultsLabel=${t("staffing.role.no_results")}
          .countLabel=${(count: number) => tf("staffing.role.holders_other", { count: String(count) })}
          .values=${this.draft.holderIds}
          .options=${this.peopleOptions()}
          ?disabled=${this.busy || this.people === undefined}
          @wt-change=${(event: CustomEvent<{ values: string[] }>) => {
            event.stopPropagation();
            this.change({ ...this.draft, holderIds: sorted(event.detail.values) }, "other");
          }}
        ></wt-combobox>
      </div>
      <wt-form-actions slot="footer" .error=${this.bottomMessage()}>
        <wt-button
          slot="cancel"
          data-test="cancel-staff-role"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel")}
          >${t("staffing.role.cancel")}</wt-button
        >
        <wt-button
          data-test="save-staff-role"
          variant=${action.variant}
          ?disabled=${action.unchanged || this.busy || (this.attempted && this.failsOwnChecks)}
          ?loading=${this.busy}
          @click=${() => void this.save()}
          >${t("staffing.role.save")}</wt-button
        >
      </wt-form-actions>`;
  }
  override render(): unknown {
    if (!this.open) return nothing;
    const generation = this.generation;
    const current = () => this.isConnected && this.open && generation === this.generation;
    return keyed(
      generation,
      html`<wt-modal
        open
        size="compact"
        heading=${t(this.savedId ? "staffing.role.heading_edit" : "staffing.role.heading_new")}
        .dismissible=${!this.busy}
        .beforeClose=${this.beforeClose}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (current()) {
            this.open = false;
            this.emit("staff-role-close", { wrote: this.wrote });
          }
        }}
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=save-staff-role]"))}
      >
        ${this.form()}
      </wt-modal>`,
    );
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "staff-role-dialog": StaffRoleDialog;
  }
}
