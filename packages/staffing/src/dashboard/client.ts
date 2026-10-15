import type { DashboardRequest, LiveData, QueryController } from "@waitron/dashboard-kit";
import type { DeleteImpact } from "@waitron/shared";
import type { AreaRef } from "../slots.js";
import type { CalendarColour, StaffingMonth, StaffRole } from "../staffing-types.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";

export type { AreaRef, CalendarColour, StaffingMonth, StaffRole };

/** A staffing area by name, in the order the venue lists them. */
export interface StaffingArea {
  area: AreaRef;
  name: string;
}

/** The month's staffing and the names of the areas it can list. */
export interface StaffingMonthRead {
  month: StaffingMonth;
  areas: StaffingArea[];
}

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

  /** Keeps `apply` fed with `month` (YYYY-MM) and the areas' names; resolves after the first read. */
  watchMonth(
    queries: QueryController,
    month: string,
    apply: (read: StaffingMonthRead) => void | Promise<void>,
  ): Promise<void> {
    return queries.watch(
      "staffing-month",
      {
        key: `staffing:month:${month}`,
        dependencies: QUERY_DEPENDENCIES["staffing-month"].map((type) => ({ type })),
        read: async () => ({
          month: await this.request<StaffingMonth>(
            `/management-api/staffing/month?month=${encodeURIComponent(month)}`,
            "GET",
            undefined,
            { passive: true },
          ),
          areas: (
            await this.request<{ areas: StaffingArea[] }>(
              "/management-api/staffing/areas",
              "GET",
              undefined,
              { passive: true },
            )
          ).areas,
        }),
      },
      apply,
    );
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
