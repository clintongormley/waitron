import type { DashboardRequest, DownloadedFile } from "@waitron/dashboard-kit";
import { type PersonRole, AccountApi, type InvitationResult } from "./account-api.js";

export interface RosterEntry {
  personId: string;
  displayName: string;
}

export interface JobRole {
  id: string;
  name: string;
  holderIds: string[];
}

export interface AccessRole {
  id: string;
  builtInKey: PersonRole | null;
  name: string | null;
  permissions: string[];
  holderCount: number;
}

export interface PersonSummary {
  personId: string;
  displayName: string;
  firstNames?: string | null;
  lastNames?: string | null;
  telephone?: string | null;
  locale?: string | null;
  roleIds: string[];
  status: "pending" | "active" | "suspended";
  hasPassword: boolean;
  hasTotp: boolean;
  email: string | null;
}

export interface PersonPageQuery {
  page: number;
  search: string;
  roleIds: string[];
  status: "current" | "all" | PersonSummary["status"];
  sortKey: "" | "displayName" | "legalName" | "role" | "email" | "telephone" | "status";
  sortDirection: "ascending" | "descending";
  locale: string;
}

export interface PersonPage {
  rows: PersonSummary[];
  page: number;
  pageSize: 50;
  total: number;
  anyPeople: boolean;
}

export interface PersonEditDetails {
  displayName: string;
  firstNames: string;
  lastNames: string;
  telephone: string | null;
  email: string;
  status: "pending" | "active" | "suspended";
  locale: string | null;
}
// ── Shift-planning types ──────────────────────────────────────────────────────────────────────────

export interface RosterVersion {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: "draft" | "published" | "superseded";
  publishedAt: string | null;
  publishedByPersonId: string | null;
}

export interface Shift {
  id: string;
  personId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  rosterVersionId: string;
}

export interface RosterSnapshot {
  version: RosterVersion | null;
  shifts: Shift[];
}

export interface ShiftInput {
  personId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
}

export interface ShiftPatch {
  personId?: string;
  startsAt?: string;
  startsOffsetMinutes?: number;
  endsAt?: string;
  endsOffsetMinutes?: number;
}

export type RosterBreachKind =
  | "rest_too_short"
  | "exceeds_daily_max"
  | "exceeds_weekly_max"
  | "overtime_cap_exceeded"
  | "weekly_rest_insufficient"
  | "break_owed"
  | "night_work"
  | "split_segment_too_short"
  | "split_segment_too_long"
  | "split_gap_too_short";

export interface RosterBreach {
  kind: RosterBreachKind;
  personId: string;
  [detail: string]: unknown;
}

export interface PendingSwap {
  id: string;
  requestedByPersonId: string;
  fromShiftId: string;
  toPersonId: string;
  toShiftId: string | null;
  status: string;
  createdAt: string;
}

export interface PendingAbsence {
  id: string;
  personId: string;
  kind: string;
  startsOn: string;
  endsOn: string;
  status: string;
  note: string | null;
  createdAt: string;
}

export interface PlannedVsActualRow {
  personId: string;
  workDate: string;
  plannedMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  noShow: boolean;
  unplanned: boolean;
}
// ── Staff self-service (my schedule) types ──────────────────────────────────────────────────────

export type AbsenceKind = "holiday" | "sick_leave" | "leave" | "unpaid";

export interface MyShift {
  id: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  description: string | null;
  rosterVersionId: string;
}

export interface MySwap {
  id: string;
  requestedByPersonId: string;
  fromShiftId: string;
  toPersonId: string;
  toShiftId: string | null;
  status: "requested" | "accepted" | "approved" | "rejected";
  createdAt: string;
  direction: "offered_to_me" | "requested_by_me";
}

export interface MyAbsence {
  id: string;
  personId: string;
  kind: AbsenceKind;
  startsOn: string;
  endsOn: string;
  status: "requested" | "approved" | "rejected";
  note: string | null;
  createdAt: string;
}

export class StaffApi extends AccountApi {
  readonly #request: DashboardRequest;
  constructor(request: DashboardRequest) {
    super(request);
    this.#request = request;
  }
  getStaffRoster(): Promise<RosterEntry[]> {
    return this.#request<RosterEntry[]>("/management-api/staff-roster", "GET");
  }
  downloadPersonalData(personId: string): Promise<DownloadedFile> {
    return this.#request<DownloadedFile>(
      `/management-api/staff/${encodeURIComponent(personId)}/personal-data/export`,
      "GET",
      undefined,
      { as: "file" },
    );
  }
  async listJobRoles(): Promise<JobRole[]> {
    const read = await this.#request<{ staffRoles: JobRole[] }>(
      "/management-api/staffing/staff-roles",
      "GET",
      undefined,
      { passive: true },
    );
    return read.staffRoles;
  }
  setPersonJobRoles(
    personId: string,
    staffRoleIds: readonly string[],
    expectedStaffRoleIds: readonly string[],
  ): Promise<{ staffRoleIds: string[] }> {
    return this.#request(
      `/management-api/staffing/people/${encodeURIComponent(personId)}/staff-roles`,
      "PUT",
      { staffRoleIds, expectedStaffRoleIds },
    );
  }
  listAccessRoles(): Promise<AccessRole[]> {
    return this.#request<AccessRole[]>("/management-api/access-roles", "GET");
  }
  createAccessRole(input: {
    name: string;
    permissions: string[];
    copiedFrom?: string;
  }): Promise<{ id: string }> {
    return this.#request("/management-api/access-roles", "POST", input);
  }
  renameAccessRole(id: string, name: string, expectedName: string): Promise<void> {
    return this.#request(`/management-api/access-roles/${encodeURIComponent(id)}/name`, "PUT", {
      name,
      expectedName,
    });
  }
  setAccessRolePermissions(
    id: string,
    permissions: string[],
    expectedPermissions: string[],
  ): Promise<void> {
    return this.#request(
      `/management-api/access-roles/${encodeURIComponent(id)}/permissions`,
      "PUT",
      { permissions, expectedPermissions },
    );
  }
  deleteAccessRole(id: string): Promise<{ removedFrom: number }> {
    return this.#request(`/management-api/access-roles/${encodeURIComponent(id)}`, "DELETE");
  }
  setPersonAccessRoles(
    personId: string,
    roleIds: string[],
    expectedRoleIds: string[],
  ): Promise<{ roleIds: string[] }> {
    return this.#request(
      `/management-api/staff/${encodeURIComponent(personId)}/access-roles`,
      "PUT",
      { roleIds, expectedRoleIds },
    );
  }
  listStaffPage(query: PersonPageQuery): Promise<PersonPage> {
    const { roleIds, ...values } = query;
    const params = new URLSearchParams(
      Object.entries(values).map(([key, value]) => [key, String(value)]),
    );
    for (const id of roleIds) params.append("roleId", id);
    return this.#request<PersonPage>(`/management-api/staff/page?${params}`, "GET");
  }
  listStaff(): Promise<PersonSummary[]> {
    return this.#request<PersonSummary[]>("/management-api/staff", "GET");
  }
  createPerson(input: {
    displayName: string;
    firstNames: string;
    lastNames: string;
    telephone: string | null;
    roleIds: string[];
    email: string;
  }): Promise<{ id: string } & InvitationResult> {
    return this.#request<{ id: string } & InvitationResult>("/management-api/staff", "POST", input);
  }
  resendInvitation(id: string): Promise<InvitationResult> {
    return this.#request<InvitationResult>(`/management-api/staff/${id}/invitation`, "POST");
  }
  savePerson(
    id: string,
    details: Omit<PersonEditDetails, "locale"> & { locale?: string | null },
  ): Promise<void> {
    return this.#request<void>(`/management-api/staff/${id}`, "PUT", details);
  }
  resetPin(id: string): Promise<void> {
    return this.#request<void>(`/management-api/staff/${id}/reset-pin`, "POST");
  }
  deactivatePerson(id: string): Promise<void> {
    return this.#request<void>(`/management-api/staff/${id}/deactivate`, "POST");
  }
  resetLogin(id: string): Promise<InvitationResult> {
    return this.#request<InvitationResult>(`/management-api/staff/${id}/reset-login`, "POST");
  }
  reactivatePerson(id: string): Promise<InvitationResult> {
    return this.#request<InvitationResult>(`/management-api/staff/${id}/reactivate`, "POST");
  }
  // ── Shift planning (roster authoring) ──────────────────────────────────────────────────────────

  getRoster(period: string): Promise<RosterSnapshot> {
    return this.#request<RosterSnapshot>(`/management-api/roster?period=${period}`, "GET");
  }
  createRosterVersion(period: string): Promise<{ versionId: string }> {
    return this.#request<{ versionId: string }>("/management-api/roster", "POST", { period });
  }
  addShift(versionId: string, input: ShiftInput): Promise<{ shiftId: string }> {
    return this.#request<{ shiftId: string }>(
      `/management-api/roster/${versionId}/shifts`,
      "POST",
      input,
    );
  }
  updateShift(shiftId: string, patch: ShiftPatch): Promise<void> {
    return this.#request<void>(`/management-api/roster/shifts/${shiftId}`, "PATCH", patch);
  }
  removeShift(shiftId: string): Promise<void> {
    return this.#request<void>(`/management-api/roster/shifts/${shiftId}`, "DELETE");
  }
  publishRoster(versionId: string): Promise<{ breaches: RosterBreach[] }> {
    return this.#request<{ breaches: RosterBreach[] }>(
      `/management-api/roster/${versionId}/publish`,
      "POST",
    );
  }
  // ── Approvals (shift swaps + absences) ──────────────────────────────────────────────────────────

  listPendingSwaps(): Promise<PendingSwap[]> {
    return this.#request<PendingSwap[]>("/management-api/swaps", "GET");
  }
  decideSwap(swapId: string, decision: "approved" | "rejected"): Promise<void> {
    return this.#request<void>(`/management-api/swaps/${swapId}/decide`, "POST", { decision });
  }
  listPendingAbsences(): Promise<PendingAbsence[]> {
    return this.#request<PendingAbsence[]>("/management-api/absences", "GET");
  }
  decideAbsence(absenceId: string, decision: "approved" | "rejected"): Promise<void> {
    return this.#request<void>(`/management-api/absences/${absenceId}/decide`, "POST", {
      decision,
    });
  }
  // ── Planned vs actual (worked-time comparison) ───────────────────────────────────────────────────

  getPlannedVsActual(from: string, to: string): Promise<PlannedVsActualRow[]> {
    return this.#request<PlannedVsActualRow[]>(
      `/management-api/planned-vs-actual?from=${from}&to=${to}`,
      "GET",
    );
  }
  listMyShifts(from: string, to: string): Promise<MyShift[]> {
    return this.#request<MyShift[]>(
      `/management-api/me/schedule/shifts?from=${from}&to=${to}`,
      "GET",
    );
  }
  listMySwaps(): Promise<MySwap[]> {
    return this.#request<MySwap[]>("/management-api/me/schedule/swaps", "GET");
  }
  requestSwap(req: {
    fromShiftId: string;
    toPersonId: string;
    toShiftId: string | null;
  }): Promise<{ swapId: string }> {
    return this.#request<{ swapId: string }>("/management-api/me/schedule/swaps", "POST", req);
  }
  acceptSwap(swapId: string): Promise<void> {
    return this.#request<void>(`/management-api/me/schedule/swaps/${swapId}/accept`, "POST");
  }
  listMyAbsences(): Promise<MyAbsence[]> {
    return this.#request<MyAbsence[]>("/management-api/me/schedule/absences", "GET");
  }
  requestAbsence(req: {
    kind: AbsenceKind;
    startsOn: string;
    endsOn: string;
    note: string | null;
  }): Promise<{ absenceId: string }> {
    return this.#request<{ absenceId: string }>(
      "/management-api/me/schedule/absences",
      "POST",
      req,
    );
  }
}
