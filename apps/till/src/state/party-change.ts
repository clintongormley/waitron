import { formatMoney } from "@waitron/shared";
import type { TableParty, TableState } from "../api/floor-api.js";
import { currentLocale, t } from "../i18n/t.js";
import { shownTableNames } from "../widgets/table-targets.js";
import { billRequestOf } from "./table-signals.js";

/** The tables' shown names, and whether those differ from their saved names. */
export interface TableNames {
  names: string;
  named: boolean;
}

/** What another device changed about a party, worked out by comparing the floor before and after.
 * `tables` names the party's tables as they were. */
export type PartyChange = { tables: TableNames } & (
  | { kind: "gone" }
  | { kind: "tables"; now: TableNames }
  | { kind: "bills"; outstanding: string }
  | { kind: "bill_request"; requested: boolean }
  | { kind: "other" }
);

export function tableLabels(tables: TableState[], ids: readonly string[]): TableNames {
  const names = shownTableNames(ids, tables).join(", ");
  const saved = ids.flatMap((id) => tables.find((table) => table.id === id)?.label ?? []);
  return { names, named: names !== saved.join(", ") };
}

export function partyOf(tables: TableState[], partyId: string): TableParty | undefined {
  return tables.find((table) => table.party?.id === partyId)?.party ?? undefined;
}

export function describePartyChange(
  was: TableParty,
  before: TableState[],
  after: TableState[],
): PartyChange {
  const is = partyOf(after, was.id);
  const tables = tableLabels(before, was.tableIds);
  if (is === undefined || is.state !== "open") return { tables, kind: "gone" };
  if (was.tableIds.join() !== is.tableIds.join()) {
    return { tables, kind: "tables", now: tableLabels(after, is.tableIds) };
  }
  if (was.billCount !== is.billCount || was.outstanding !== is.outstanding) {
    return { tables, kind: "bills", outstanding: is.outstanding };
  }
  const requested = billRequestOf(after, was.id) !== undefined;
  if (requested !== (billRequestOf(before, was.id) !== undefined)) {
    return { tables, kind: "bill_request", requested };
  }
  return { tables, kind: "other" };
}

function partyChangeDetail(change: PartyChange): string {
  switch (change.kind) {
    case "gone":
      return t("party.changed_gone");
    case "tables":
      return t(change.now.named ? "party.changed_tables_named" : "party.changed_tables").replace(
        "{tables}",
        () => change.now.names,
      );
    case "bills":
      return t("party.changed_bills").replace("{amount}", () =>
        formatMoney(change.outstanding, currentLocale()),
      );
    case "bill_request":
      return t(
        change.requested ? "party.changed_bill_requested" : "party.changed_bill_request_cancelled",
      );
    case "other":
      return t("party.changed_other");
  }
}

export function partyChangeMessage(change: PartyChange): string {
  const detail = partyChangeDetail(change);
  return [
    t(change.tables.named ? "party.changed_named" : "party.changed").replace(
      "{table}",
      () => change.tables.names,
    ),
    detail,
    t("party.try_again"),
  ].join(" ");
}
