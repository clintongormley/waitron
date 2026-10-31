import { describe, expect, it } from "vitest";
import { partyScope } from "./table-targets.js";
import type { TableParty, TableState } from "../api/client.js";

const tableRow = (id: string, label: string, over: Partial<TableState> = {}): TableState => ({
  id,
  label,
  zoneId: "z1",
  state: "free",
  condition: "free",
  hasOpenTab: false,
  pendingDeliveries: 0,
  pendingToServe: 0,
  readyToServe: 0,
  timingBand: "fresh",
  nextReservation: null,
  today: null,
  signals: [],
  party: null,
  shortName: over.label ?? label,
  ...over,
});

const luis: TableParty = {
  kitchenNote: { scope: { partyId: "v7" }, note: null, revision: 0, ownerRevision: 9 },
  id: "v7",
  revision: 9,
  guestCount: 2,
  state: "open",
  name: "Luis",
  displayName: "Luis",
  openingBillId: "wo-7",
  outstanding: "12.00",
  billCount: 1,
  tableIds: ["t7"],
  unsentDrafts: [],
  reminder: null,
};

const tables = [
  tableRow("t7", "Mesa 7", { state: "open-tab", condition: "held", party: luis }),
  tableRow("t6", "Mesa 6", { condition: "needs_clearing" }),
  tableRow("t9", "Mesa 9"),
];

describe("partyScope", () => {
  it("names a seated party with no name by the tables the floor lists for it", () => {
    const unnamed = { ...luis, name: null, displayName: "Mesa 7", tableIds: ["t7", "t-gone"] };

    expect(partyScope(unnamed, [{ ...tables[0]!, party: unnamed }, tables[2]!])).toBe("Mesa 7");
  });
});
