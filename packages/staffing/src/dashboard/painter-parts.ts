import { css, html, nothing } from "lit";
import { codeMessage, codeOf } from "@waitron/dashboard-kit";
import { conjunctionList } from "@waitron/shared";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import { MAX_HEADCOUNT } from "../block-model.js";
import { areaKey, type AreaRef } from "../slots.js";
import type { StaffRole, StaffingGuideRange } from "../staffing-types.js";
import type { StaffingApi } from "./client.js";
import { formatLocale } from "./format.js";
import type { StaffingColumn } from "./staffing-grid.js";
import { t, tf } from "./strings.js";
import "./staff-role-dialog.js";

/** What the season and special-day staffing painters share: their chip row, area picker, staff role
 *  dialog, refusal reading and styles. */

export const NOTHING_BY_KEY: ReadonlyMap<string, never> = new Map<string, never>();

type Guides = ReadonlyMap<string, readonly StaffingGuideRange[]>;
type GuideRecord = Readonly<Record<string, readonly StaffingGuideRange[]>>;
const NO_GUIDES: GuideRecord = {};

/** The grid lays its columns out again whenever `guides` is a new object, so a painter keeps one map
 *  while the read's hours for the shown area and the columns stay the same. */
export function guidesKeeper(): (
  from: GuideRecord | undefined,
  columns: readonly StaffingColumn[],
) => Guides {
  let kept: { from: GuideRecord; columns: readonly StaffingColumn[]; guides: Guides } | undefined;
  return (from = NO_GUIDES, columns) => {
    if (kept?.from !== from || kept.columns !== columns)
      kept = {
        from,
        columns,
        guides: new Map(columns.map(({ key }) => [key, from[key] ?? []])),
      };
    return kept.guides;
  };
}

/** Keeps one column-errors map while the refusal it is read from stays the same, as `guidesKeeper`
 *  keeps the hours. */
export function columnErrorsKeeper(): (
  refused: { area?: string; column?: string; reason?: string } | undefined,
  shown: string,
) => ReadonlyMap<string, string> {
  let kept: { refused: object; errors: ReadonlyMap<string, string> } | undefined;
  return (refused, shown) => {
    if (refused?.area !== shown || refused.column === undefined) return NOTHING_BY_KEY;
    if (kept?.refused !== refused)
      kept = { refused, errors: new Map([[refused.column, refused.reason!]]) };
    return kept.errors;
  };
}

export const painterStyles = css`
  :host {
    display: contents;
  }
  .how-many {
    display: inline-flex;
    align-items: center;
  }
  .paint .hint {
    flex: 1 1 calc(var(--wt-space-6) * 12);
    min-inline-size: 0;
    margin-inline-start: auto;
    text-align: end;
  }
  .guide-read-only {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
    padding-block: var(--wt-space-2);
  }
  @media (width < 720px) {
    .paint .hint {
      flex-basis: 100%;
      margin-inline-start: 0;
      text-align: start;
    }
  }
  .message {
    margin: var(--wt-space-3) 0;
    color: var(--wt-color-text-muted);
  }
  .message[role="alert"] {
    color: var(--wt-color-danger);
  }
  /* The days fill the grid's slot: less the heading row and its line, and the grid's two borders. */
  staffing-grid {
    container-type: size;
    --paint-grid-fill: calc(100cqb - var(--wt-tap-min) - 3px);
  }
`;

const listOf = (names: readonly string[]) => conjunctionList(names, formatLocale());

/** What a painter says beside Save when a re-read dropped edits: the areas, then the dates, that
 *  are gone. Empty when it dropped none. */
export function droppedNotice(areas: readonly string[], dates: readonly string[] = []): string {
  return [
    areas.length
      ? tf(areas.length === 1 ? "staffing.painter.removed_one" : "staffing.painter.removed_other", {
          names: listOf(areas),
        })
      : "",
    dates.length
      ? tf(
          dates.length === 1
            ? "staffing.painter.dates_removed_one"
            : "staffing.painter.dates_removed_other",
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

export function guideText(area: { area: AreaRef; name: string }): string {
  return area.area.kind === "department"
    ? tf("staffing.painter.guide_department", { department: area.name })
    : tf("staffing.painter.guide_station", { station: area.name });
}

export interface PaintRowOptions {
  guideText: string;
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
    <span class="hint" data-test="guide-hint">${options.guideText}</span>
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
