import { vi } from "vitest";
import { createLabelComparator, searchBy } from "@waitron/shared";
import type { DashboardApi, PersonPageQuery, PersonSummary } from "../api/client.js";
import { accessRoleName, statusName } from "../i18n/domain.js";
import { accessRoleChoices } from "./access-role-fixture.js";

/** Existing roster fixtures remain the data source; the screen consumes a page response. */
export function withStaffPages(api: DashboardApi): DashboardApi {
  for (const client of [api, api.background] as (Partial<DashboardApi> | undefined)[]) {
    if (!client || client.listStaffPage) continue;
    client.listStaffPage = vi.fn(async (query: PersonPageQuery) => {
      const all = await client.listStaff!();
      const roleNames = new Map(
        accessRoleChoices.map((role) => [role.id, accessRoleName(role, query.locale)]),
      );
      const key = (person: PersonSummary): string => {
        switch (query.sortKey) {
          case "legalName":
            return `${person.lastNames ?? ""}, ${person.firstNames ?? ""}`;
          case "email":
            return person.email ?? "";
          case "telephone":
            return person.telephone ?? "";
          case "status":
            return statusName(person.status, query.locale);
          case "role":
            return person.roleIds.map((id) => roleNames.get(id) ?? id).join(", ");
          default:
            return person.displayName;
        }
      };
      const compare = createLabelComparator(query.locale);
      const rows = all
        .filter(
          (person) =>
            (query.status === "all" ||
              (query.status === "current"
                ? person.status !== "suspended"
                : person.status === query.status)) &&
            (query.roleIds.length === 0 || person.roleIds.some((id) => query.roleIds.includes(id))),
        )
        .sort((a, b) => compare(key(a), key(b)) * (query.sortDirection === "descending" ? -1 : 1));
      const matches = searchBy(query.search, rows, (person) => [
        [person.displayName, person.firstNames, person.lastNames].filter(Boolean).join(" "),
        person.email ?? "",
        person.telephone ?? "",
      ]);
      const page = Math.min(query.page, Math.max(0, Math.ceil(matches.length / 50) - 1));
      return {
        rows: matches.slice(page * 50, (page + 1) * 50),
        page,
        pageSize: 50 as const,
        total: matches.length,
        anyPeople: all.length > 0,
      };
    });
  }
  return api;
}
