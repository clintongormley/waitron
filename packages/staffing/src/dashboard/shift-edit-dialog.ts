import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import {
  baseStyles,
  draftScopeFor,
  saveActionState,
  focusFirstInvalid,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import { codeMessage, codeOf } from "@waitron/dashboard-kit";
import { areaKey, blockSpan } from "../slots.js";
import type { RotaWeek } from "../staffing-types.js";
import type { StaffingApi } from "./client.js";
import { wallTime } from "./rota-format.js";
import { t } from "./strings.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";

type Draft = {
  personId: string;
  area: string;
  staffRoleId: string;
  startsAt: string;
  endsAt: string;
};
const fields = ["personId", "area", "staffRoleId", "startsAt", "endsAt"] as const;
type Field = (typeof fields)[number];
const copy = (draft: Draft): Draft => ({ ...draft });
const same = (a: Draft, b: Draft) => fields.every((k) => a[k] === b[k]);
const empty = (): Draft => ({ personId: "", area: "", staffRoleId: "", startsAt: "", endsAt: "" });
@customElement("rota-shift-dialog")
export class ShiftEditDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .form {
        display: grid;
        gap: var(--wt-space-4);
        padding-block: var(--wt-space-3);
      }
      .note {
        color: var(--wt-color-warning);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) api!: StaffingApi;
  @property({ attribute: false }) week!: RotaWeek;
  @property() shiftId?: string;
  @property() businessDay = "";
  @property() personId = "";
  @property() area = "";
  @property() staffRoleId = "";
  @state() private draft: Draft = empty();
  @state() private busy = false;
  @state() private attempted = false;
  @state() private refusal?: { code: string; field?: string };
  @state() private confirmation?: "delete" | "save";
  private identity?: object;
  private subject = "";
  private baseline: Draft = empty();
  private scope?: DraftScope<Draft>;
  private leave?: LeaveCoordinator;
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback() {
    this.scope?.dispose();
    this.scope = undefined;
    this.leave = undefined;
    super.disconnectedCallback();
  }
  override willUpdate() {
    if (!this.open) {
      this.scope?.dispose();
      this.scope = undefined;
      this.identity = undefined;
      return;
    }
    const subject = `${this.week.week}:${this.shiftId ?? `${this.businessDay}:${this.personId}:${this.area}:${this.staffRoleId}`}`;
    if (!this.identity || this.subject !== subject) {
      this.scope?.dispose();
      this.scope = undefined;
      this.identity = {};
      this.subject = subject;
      this.busy = false;
      this.attempted = false;
      this.refusal = undefined;
      this.confirmation = undefined;
      const shift = this.week.shifts.find((s) => s.shiftId === this.shiftId);
      this.draft = shift
        ? {
            personId: shift.personId,
            area: shift.area ? areaKey(shift.area) : "",
            staffRoleId: shift.staffRoleId ?? "",
            startsAt: wallTime(shift.startsAt, shift.startsOffsetMinutes),
            endsAt: wallTime(shift.endsAt, shift.endsOffsetMinutes),
          }
        : {
            ...empty(),
            personId: this.personId,
            area: this.area,
            staffRoleId: this.staffRoleId,
          };
      this.baseline = copy(this.draft);
    }
    if (this.isConnected && !this.scope) {
      const { scope, coordinator } = draftScopeFor(this, {
        id: this.identity,
        current: () => copy(this.draft),
        snapshot: copy,
        equal: same,
        restore: (v) => {
          this.draft = copy(v);
        },
      });
      this.scope = scope;
      this.leave = coordinator;
      scope.commit(this.baseline);
    }
  }
  private ownError(field: Field): string {
    if (!this.draft[field]) return t(`staffing.shift.invalid_${field}`);
    if (
      field === "area" &&
      !this.week.areas.some((a) => a.active && areaKey(a.area) === this.draft.area)
    )
      return t("staffing.shift.invalid_area");
    if (field === "personId" && !this.week.people.some((p) => p.personId === this.draft.personId))
      return t("staffing.shift.invalid_personId");
    if (
      field === "staffRoleId" &&
      !this.week.staffRoles.some((r) => r.id === this.draft.staffRoleId)
    )
      return t("staffing.shift.invalid_staffRoleId");
    if (
      (field === "startsAt" || field === "endsAt") &&
      !/^([01]\d|2[0-3]):(00|15|30|45)$/.test(this.draft[field])
    )
      return t(`staffing.shift.invalid_${field}`);
    if (field === "endsAt" && this.draft.startsAt && this.draft.endsAt) {
      const shift = this.week.shifts.find((s) => s.shiftId === this.shiftId);
      const day = shift?.businessDay ?? this.businessDay;
      const cutover =
        this.week.days.find((d) => d.businessDay === day)?.cutover ?? this.week.days[0]!.cutover;
      const span = blockSpan(this.draft, cutover);
      if (span.end <= span.start) return t("staffing.shift.invalid_endsAt");
    }
    return "";
  }
  private fieldError(field: Field): string {
    if (this.refusal?.field === field) return t(`staffing.shift.invalid_${field}`);
    return this.attempted ? this.ownError(field) : "";
  }
  private bottom(): string {
    if (fields.some((f) => this.fieldError(f))) return t("staffing.role.fix_fields");
    return this.refusal ? codeMessage(this.refusal.code) : "";
  }
  private change(field: Field, value: string) {
    this.draft = { ...this.draft, [field]: value };
    if (this.refusal?.field === field) this.refusal = undefined;
    this.scope?.changed();
  }
  private hasSwap(): boolean {
    return this.week.openSwaps.some(
      (s) => s.fromShiftId === this.shiftId || s.toShiftId === this.shiftId,
    );
  }
  private emit(name: string) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }
  private readonly beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.busy || this.confirmation) return false;
    const identity = this.identity;
    const outcome =
      this.scope && this.leave
        ? await this.leave.request({ scopes: [this.scope.id], reason, proceed() {} })
        : "proceeded";
    return this.isConnected && identity === this.identity && outcome === "proceeded";
  };
  private async save(confirmed = false) {
    if (
      !this.open ||
      !this.isConnected ||
      this.busy ||
      this.confirmation ||
      saveActionState(this.scope).unchanged
    )
      return;
    this.attempted = true;
    this.refusal = undefined;
    if (fields.some((f) => this.ownError(f))) {
      await this.updateComplete;
      focusFirstInvalid(this.shadowRoot!);
      return;
    }
    if (
      !confirmed &&
      this.hasSwap() &&
      ["personId", "startsAt", "endsAt"].some(
        (k) => this.draft[k as Field] !== this.baseline[k as Field],
      )
    ) {
      this.confirmation = "save";
      return;
    }
    const submitted = copy(this.draft),
      identity = this.identity;
    const area = this.week.areas.find((a) => areaKey(a.area) === submitted.area)!.area;
    const input = {
      personId: submitted.personId,
      area,
      staffRoleId: submitted.staffRoleId,
      startsAt: submitted.startsAt,
      endsAt: submitted.endsAt,
    };
    this.busy = true;
    try {
      if (this.shiftId) await this.api.updateRotaShift(this.shiftId, input);
      else
        await this.api.addRotaShift({
          ...input,
          week: this.week.week,
          businessDay: this.businessDay,
        });
      if (identity !== this.identity) return;
      this.scope?.commit(submitted);
      this.open = false;
      this.emit("shift-saved");
    } catch (error) {
      if (identity !== this.identity) return;
      const code = codeOf(error);
      const params = (error as { params?: { field?: string; staffRoleId?: string; area?: string } })
        .params;
      const field =
        params?.field ??
        (code === "staff_role.not_found" && params?.staffRoleId
          ? "staffRoleId"
          : code === "staffing_area.not_found" && params?.area
            ? "area"
            : undefined);
      this.refusal = { code, field };
    } finally {
      if (identity === this.identity) this.busy = false;
    }
  }
  private async deleteShift() {
    if (this.busy || !this.shiftId || !this.open || !this.isConnected) return;
    const identity = this.identity;
    this.busy = true;
    this.refusal = undefined;
    try {
      await this.api.removeRotaShift(this.shiftId);
      if (identity !== this.identity) return;
      this.open = false;
      this.emit("shift-saved");
    } catch (error) {
      if (identity === this.identity) this.refusal = { code: codeOf(error) };
    } finally {
      if (identity === this.identity) this.busy = false;
    }
  }
  override render(): unknown {
    if (!this.open) return nothing;
    const identity = this.identity;
    const action = saveActionState(this.scope);
    const disabled =
      action.unchanged ||
      this.busy ||
      !!this.confirmation ||
      (this.attempted && fields.some((f) => !!this.ownError(f)));
    const choices: Record<"personId" | "area" | "staffRoleId", { value: string; label: string }[]> =
      {
        personId: this.week.people.map((p) => ({ value: p.personId, label: p.name })),
        area: this.week.areas
          .filter((a) => a.active)
          .map((a) => ({ value: areaKey(a.area), label: a.name })),
        staffRoleId: this.week.staffRoles.map((r) => ({ value: r.id, label: r.name })),
      };
    return keyed(
      identity,
      html`<wt-modal
          open
          size="compact"
          heading=${t(this.shiftId ? "staffing.shift.edit" : "staffing.shift.add")}
          .dismissible=${!this.busy && !this.confirmation}
          .beforeClose=${this.beforeClose}
          @wt-close=${(e: Event) => {
            e.stopPropagation();
            if (identity === this.identity) {
              this.open = false;
              this.emit("shift-close");
            }
          }}
          @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector("[data-test=save]"))}
        >
          <div class="form">
            ${(["personId", "area", "staffRoleId"] as const).map(
              (f) =>
                html`<wt-combobox
                  required
                  name=${f}
                  label=${t(`staffing.shift.${f}`)}
                  .value=${this.draft[f]}
                  .options=${choices[f]}
                  .error=${this.fieldError(f)}
                  ?disabled=${this.busy || !!this.confirmation}
                  @wt-change=${(e: CustomEvent<{ value: string }>) => {
                    e.stopPropagation();
                    this.change(f, e.detail.value);
                  }}
                ></wt-combobox>`,
            )}
            ${(["startsAt", "endsAt"] as const).map(
              (f) =>
                html`<wt-input
                  type="time"
                  .step=${900}
                  required
                  name=${f}
                  label=${t(`staffing.shift.${f}`)}
                  .value=${this.draft[f]}
                  .error=${this.fieldError(f)}
                  ?disabled=${this.busy || !!this.confirmation}
                  @wt-change=${(e: CustomEvent<{ value: string }>) => {
                    e.stopPropagation();
                    this.change(f, e.detail.value);
                  }}
                ></wt-input>`,
            )}
          </div>
          <wt-form-actions slot="footer" .error=${this.bottom()}>
            <wt-button
              slot="cancel"
              variant="secondary"
              ?disabled=${this.busy || !!this.confirmation}
              @click=${() => void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel")}
              >${t("staffing.role.cancel")}</wt-button
            >
            ${
              this.shiftId
                ? html`<wt-button
                    slot="secondary"
                    variant="danger"
                    data-test="delete"
                    ?disabled=${this.busy || !!this.confirmation}
                    @click=${() => {
                      this.confirmation = "delete";
                    }}
                    >${t("staffing.grid.delete")}</wt-button
                  >`
                : nothing
            }
            <wt-button
              data-test="save"
              .variant=${action.variant}
              ?disabled=${disabled}
              @click=${() => void this.save()}
              >${t("staffing.role.save")}</wt-button
            >
          </wt-form-actions>
        </wt-modal>
        <wt-dialog
          .open=${!!this.confirmation}
          heading=${t(this.confirmation === "delete" ? "staffing.shift.delete_heading" : "staffing.shift.swap_heading")}
          .dismissible=${!this.busy}
          @wt-close=${() => {
            if (!this.busy) this.confirmation = undefined;
          }}
        >
          <p>
            ${t(this.confirmation === "delete" ? "staffing.shift.delete_question" : "staffing.shift.swap_changed")}
          </p>
          ${this.confirmation === "delete" && this.hasSwap() ? html`<p class="note">${t("staffing.shift.swap_delete")}</p>` : nothing}
          <wt-form-actions slot="footer">
            <wt-button
              slot="cancel"
              variant="secondary"
              data-test="keep"
              @click=${() => {
                this.confirmation = undefined;
              }}
              >${t("staffing.role.cancel")}</wt-button
            >
            <wt-button
              data-test="confirm"
              @click=${() => {
                const kind = this.confirmation;
                this.confirmation = undefined;
                if (kind === "delete") void this.deleteShift();
                else void this.save(true);
              }}
              >${t(this.confirmation === "delete" ? "staffing.grid.delete" : "staffing.role.save")}</wt-button
            >
          </wt-form-actions>
        </wt-dialog>`,
    );
  }
}
