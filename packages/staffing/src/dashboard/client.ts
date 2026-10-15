import type { RosterBreach, WorkTimeRuleset } from "@waitron/workforce/roster-validation";
import type { DashboardRequest, LiveData, QueryController } from "@waitron/dashboard-kit";
import type { DeleteImpact } from "@waitron/shared";
import type { AreaRef } from "../slots.js";
import type {
  RotaWeek,
  RotaShiftInput,
  RotaShiftPatch,
  CalendarColour,
  SeasonStaffing,
  SeasonStaffingEdit,
  SpecialDayStaffing,
  SpecialDayStaffingEdit,
  StaffingArea,
  StaffingMonth,
  StaffRole,
} from "../staffing-types.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";

export type {
  AreaRef,
  CalendarColour,
  SeasonStaffing,
  SeasonStaffingEdit,
  SpecialDayStaffing,
  SpecialDayStaffingEdit,
  StaffingArea,
  StaffingMonth,
  StaffRole,
};

export interface StaffRoleInput {
  name: string;
  colour: CalendarColour;
}

/** The part of `GET /management-api/staff`'s answer the staff-role dialog shows. */
export interface StaffPerson {
  personId: string;
  displayName: string;
  status: "pending" | "active" | "suspended";
}

const BASE = "/management-api/staffing/staff-roles";
const path = (staffRoleId: string) => `${BASE}/${encodeURIComponent(staffRoleId)}`;
const seasonPath = (seasonId: string) =>
  `/management-api/staffing/seasons/${encodeURIComponent(seasonId)}`;
const specialDayPath = (specialDayId: string) =>
  `/management-api/staffing/special-days/${encodeURIComponent(specialDayId)}`;

export class StaffingApi {
  constructor(
    private readonly request: DashboardRequest,
    readonly liveData?: LiveData,
  ) {}

  /** Keeps `apply` fed with the staff roles in position order; resolves after the first read. */
  watchStaffRoles(
    queries: QueryController,
    apply: (staffRoles: StaffRole[]) => void | Promise<void>,
  ): Promise<void> {
    return queries.watch(
      "staff-roles",
      {
        key: "staffing:staff-roles",
        dependencies: QUERY_DEPENDENCIES["staff-roles"].map((type) => ({ type })),
        read: async () =>
          (
            await this.request<{ staffRoles: StaffRole[] }>(BASE, "GET", undefined, {
              passive: true,
            })
          ).staffRoles,
      },
      apply,
    );
  }

  /** Keeps `apply` fed with what deleting the staff role would do; resolves after the first read. */
  watchStaffRoleDeleteImpact(
    queries: QueryController,
    staffRoleId: string,
    apply: (impact: DeleteImpact) => void,
  ): Promise<void> {
    return queries.watch(
      "delete-impact",
      {
        key: `staffing:staff-role-delete-impact:${staffRoleId}`,
        dependencies: QUERY_DEPENDENCIES["staff-role-delete-impact"].map((type) => ({ type })),
        read: () =>
          this.request<DeleteImpact>(`${path(staffRoleId)}/delete-impact`, "GET", undefined, {
            passive: true,
          }),
      },
      apply,
    );
  }

  /** Keeps `apply` fed with `month` (YYYY-MM); resolves after the first read. */
  watchMonth(
    queries: QueryController,
    month: string,
    apply: (read: StaffingMonth) => void | Promise<void>,
  ): Promise<void> {
    return queries.watch(
      "staffing-month",
      {
        key: `staffing:month:${month}`,
        dependencies: QUERY_DEPENDENCIES["staffing-month"].map((type) => ({ type })),
        read: () =>
          this.request<StaffingMonth>(
            `/management-api/staffing/month?month=${encodeURIComponent(month)}`,
            "GET",
            undefined,
            { passive: true },
          ),
      },
      apply,
    );
  }

  watchRota(
    queries: QueryController,
    week: string,
    apply: (read: RotaWeek) => void,
  ): Promise<void> {
    return queries.watch(
      "rota",
      {
        key: `staffing:rota:${week}`,
        dependencies: QUERY_DEPENDENCIES.rota.map((type) => ({ type })),
        read: () =>
          this.request<RotaWeek>(
            `/management-api/staffing/rota?week=${encodeURIComponent(week)}`,
            "GET",
            undefined,
            { passive: true },
          ),
      },
      apply,
    );
  }
  watchRotaWarnings(
    queries: QueryController,
    locationId: string,
    week: string,
    apply: (read: { breaches: RosterBreach[]; ruleset: WorkTimeRuleset | null }) => void,
  ): Promise<void> {
    return queries.watch(
      "rota-warnings",
      {
        key: `staffing:rota-warnings:${locationId}:${week}`,
        dependencies: QUERY_DEPENDENCIES["rota-warnings"].map((type) => ({ type })),
        read: async () => {
          try {
            return await this.request<{ breaches: RosterBreach[]; ruleset: WorkTimeRuleset }>(
              `/management-api/roster/breaches?locationId=${encodeURIComponent(locationId)}&period=${encodeURIComponent(week)}`,
              "GET",
              undefined,
              { passive: true },
            );
          } catch (error) {
            // On this read, 409 means that rules are not configured; the host owns its country code.
            if ((error as { status?: number } | null)?.status === 409)
              return { breaches: [], ruleset: null };
            throw error;
          }
        },
      },
      apply,
    );
  }
  changeRotaWeek(
    week: string,
  ): Promise<{ versionId: string; openSwaps: { swapId: string; fromShiftId: string }[] }> {
    return this.request("/management-api/staffing/rota/change-week", "POST", { week });
  }
  publishRota(versionId: string): Promise<{ breaches: RosterBreach[] }> {
    return this.request(`/management-api/roster/${encodeURIComponent(versionId)}/publish`, "POST");
  }
  addRotaShift(input: RotaShiftInput): Promise<{ shiftId: string }> {
    return this.request("/management-api/staffing/rota/shifts", "POST", input);
  }
  updateRotaShift(shiftId: string, patch: RotaShiftPatch): Promise<void> {
    return this.request(
      `/management-api/staffing/rota/shifts/${encodeURIComponent(shiftId)}`,
      "PATCH",
      patch,
    );
  }
  removeRotaShift(shiftId: string): Promise<void> {
    return this.request(
      `/management-api/staffing/rota/shifts/${encodeURIComponent(shiftId)}`,
      "DELETE",
    );
  }

  readSeason(seasonId: string): Promise<SeasonStaffing> {
    return this.request(seasonPath(seasonId), "GET", undefined, { passive: true });
  }

  /** Replaces only the (area, weekday) pairs `edits` names. */
  saveSeason(seasonId: string, edits: readonly SeasonStaffingEdit[]): Promise<void> {
    return this.request(seasonPath(seasonId), "PUT", { edits });
  }

  readSpecialDay(specialDayId: string): Promise<SpecialDayStaffing> {
    return this.request(specialDayPath(specialDayId), "GET", undefined, { passive: true });
  }

  /** Replaces only the (area, date) pairs `edits` names; `blocks: null` follows the season. */
  saveSpecialDay(specialDayId: string, edits: readonly SpecialDayStaffingEdit[]): Promise<void> {
    return this.request(specialDayPath(specialDayId), "PUT", { edits });
  }

  createStaffRole(input: StaffRoleInput): Promise<StaffRole> {
    return this.request(BASE, "POST", input);
  }

  updateStaffRole(staffRoleId: string, input: StaffRoleInput): Promise<StaffRole> {
    return this.request(path(staffRoleId), "PUT", input);
  }

  setHolders(staffRoleId: string, personIds: readonly string[]): Promise<StaffRole> {
    return this.request(`${path(staffRoleId)}/holders`, "PUT", { personIds });
  }

  /** `staffRoleIds` is every staff role, once each, in the new order. */
  reorder(staffRoleIds: readonly string[]): Promise<void> {
    return this.request(`${BASE}/order`, "PUT", { staffRoleIds });
  }

  deleteStaffRole(staffRoleId: string): Promise<DeleteImpact> {
    return this.request(path(staffRoleId), "DELETE");
  }

  /** The route is gated by `person.manage`, not by `staffing.manage`. */
  async listPeople(): Promise<StaffPerson[]> {
    const people = await this.request<StaffPerson[]>("/management-api/staff", "GET");
    return people.map(({ personId, displayName, status }) => ({ personId, displayName, status }));
  }
}
