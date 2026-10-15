import { css, html, nothing } from "lit";
import { codeMessage, codeOf, currentLocale } from "@waitron/dashboard-kit";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import { areaKey, type AreaRef, type StaffingBlock } from "../slots.js";
import type { StaffRole } from "../staffing-types.js";
import type { StaffingApi } from "./client.js";
import { t, tf } from "./strings.js";
import "./staff-role-dialog.js";

/** What the season and special-day staffing painters share: their chip row, area picker, staff role
 *  dialog, refusal reading and styles. */

export const MAX_HEADCOUNT = 50;
export const NOTHING_BY_KEY: ReadonlyMap<string, never> = new Map<string, never>();

export const painterStyles = css`
  :host {
    display: contents;
  }
  .how-many {
    display: inline-flex;
    align-items: center;
  }
  .message {
    margin: var(--wt-space-3) 0;
    color: var(--wt-color-text-muted);
  }
  .message[role="alert"] {
    color: var(--wt-color-danger);
  }
  staffing-grid {
    container-type: size;
  }
`;

export const sameDay = (a: readonly StaffingBlock[] = [], b: readonly StaffingBlock[] = []) =>
  a.length === b.length &&
  a.every(
    (block, index) =>
      block.staffRoleId === b[index]!.staffRoleId &&
      block.headcount === b[index]!.headcount &&
      block.startsAt === b[index]!.startsAt &&
      block.endsAt === b[index]!.endsAt,
  );

const listOf = (names: readonly string[]) =>
  new Intl.ListFormat(currentLocale().startsWith("es") ? "es-ES" : "en-GB", {
    type: "conjunction",
  }).format(names);

/** What a painter says beside Save when a re-read dropped edits: the areas, then the dates, that
 *  are gone. Empty when it dropped none. */
export function droppedNotice(areas: readonly string[], dates: readonly string[] = []): string {
  return [
    areas.length
      ? tf(areas.length === 1 ? "staffing.painter.removed_one" : "staffing.painter.removed_many", {
          names: listOf(areas),
        })
      : "",
    dates.length
      ? tf(
          dates.length === 1
            ? "staffing.painter.dates_removed_one"
            : "staffing.painter.dates_removed_many",
          { dates: listOf(dates) },
        )
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The edit a refusal names: `staffing.invalid` whose field is `edits.<i>…` names the i-th sent. */
export function refusedEdit<E>(error: unknown, edits: readonly E[]): { message: string; edit?: E } {
  const code = codeOf(error);
  const message = codeMessage(code);
  const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
  const match = /^edits\.(\d+)(?=\.|$)/.exec(typeof field === "string" ? field : "");
  return {
    message,
    edit: code === "staffing.invalid" && match ? edits[Number(match[1])] : undefined,
  };
}

export function areaPicker(
  areas: readonly { area: AreaRef; name: string }[],
  shown: string,
  disabled: boolean,
  pick: (value: string) => void,
) {
  const group = (kind: string) =>
    kind === "department" ? t("staffing.painter.departments") : t("staffing.painter.stations");
  const options = [...areas]
    .sort((a, b) => Number(a.area.kind === "station") - Number(b.area.kind === "station"))
    .map(({ area, name }) => ({ value: areaKey(area), label: name, group: group(area.kind) }));
  return html`<wt-combobox
    slot="picker"
    name="area"
    label=${t("staffing.painter.area")}
    hide-label
    search="never"
    ?disabled=${disabled}
    .value=${shown}
    .options=${options}
    @wt-change=${(event: CustomEvent<{ value: string }>) => {
      event.stopPropagation();
      pick(event.detail.value);
    }}
  ></wt-combobox>`;
}

export interface PaintRowOptions {
  staffRoles: readonly StaffRole[];
  chosen: string | undefined;
  /** Read when How many changes or is left, so its handlers never see a stale number. */
  headcount: () => number;
  rolesError: string | undefined;
  choose: (staffRoleId: string) => void;
  setHeadcount: (headcount: number) => void;
  newStaffRole: () => void;
}

/** The staff role chips, + New staff role and How many, in the frame's `row` slot. */
export function paintRow(options: PaintRowOptions) {
  const { staffRoles, chosen, headcount, rolesError } = options;
  return html`<div slot="row" class="paint" data-test="paint-row">
    <div class="pots">
      <span class="label">${t("staffing.painter.paint")}</span>
      ${staffRoles.map(
        (staffRole) =>
          html`<span class="pot">
            <button
              type="button"
              data-test=${`staff-role-${staffRole.id}`}
              aria-pressed=${chosen === staffRole.id ? "true" : "false"}
              @click=${() => options.choose(staffRole.id)}
            >
              <span class="swatch" data-colour=${staffRole.colour}></span>${staffRole.name}
            </button>
          </span>`,
      )}
      <button type="button" class="new" data-test="new-staff-role" @click=${options.newStaffRole}>
        ${t("staffing.painter.new_staff_role")}
      </button>
    </div>
    <wt-number-stepper
      class="how-many"
      name="headcount"
      label=${t("staffing.grid.how_many")}
      min="1"
      max=${MAX_HEADCOUNT}
      .value=${String(headcount())}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        // A blank waits for the field to be left, so it can be cleared and typed again.
        if (event.detail.value === "") return;
        const value = Number(event.detail.value);
        const next = Number.isInteger(value)
          ? Math.min(Math.max(value, 1), MAX_HEADCOUNT)
          : headcount();
        options.setHeadcount(next);
        (event.currentTarget as HTMLElementTagNameMap["wt-number-stepper"]).value = String(next);
      }}
      @focusout=${(event: FocusEvent) => {
        (event.currentTarget as HTMLElementTagNameMap["wt-number-stepper"]).value =
          String(headcount());
      }}
    ></wt-number-stepper>
    ${
      rolesError
        ? html`<p class="message" role="alert" data-test="roles-error">${rolesError}</p>`
        : nothing
    }
  </div>`;
}

/** The staff role dialog, a sibling after `<painter-frame>`; `saved` takes the staff role it saved. */
export function staffRoleDialog(
  api: StaffingApi,
  open: boolean,
  saved: (staffRole: StaffRole) => void,
  close: () => void,
) {
  return html`<staff-role-dialog
    .api=${api}
    .open=${open}
    @staff-role-saved=${(event: CustomEvent<StaffRole>) => {
      event.stopPropagation();
      saved(event.detail);
    }}
    @staff-role-close=${(event: Event) => {
      event.stopPropagation();
      close();
    }}
  ></staff-role-dialog>`;
}
