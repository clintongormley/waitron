import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./join-with-dialog.js";
import type { TillJoinWithDialog } from "./join-with-dialog.js";
import type { TableState } from "../api/client.js";

afterEach(cleanupWidgets);
afterEach(() => setLocale("en"));

function table(id: string, over: Partial<TableState> = {}): TableState {
  return {
    id,
    label: id.slice(1),
    zoneId: "z1",
    capacity: 4,
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    status: null,
    nextReservation: null,
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
    today: null,
    signals: [],
    party: null,
    ...over,
  };
}

describe.each(["light", "dark"] as const)("till-join-with-dialog a11y (%s theme)", (theme) => {
  it("has no violations listing free, clearing and seated tables", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillJoinWithDialog>(
      "till-join-with-dialog",
      {
        table: table("t1"),
        heading: "Unir 1 con",
        targets: [
          table("t2"),
          table("t3", { condition: "needs_clearing" }),
          table("t4", {
            state: "open-tab",
            condition: "held",
            party: {
              id: "P",
              revision: 1,
              guestCount: 2,
              state: "open",
              name: "Ana",
              displayName: "Ana",
              mainBillId: null,
              outstanding: "0.00",
              billCount: 1,
              tableIds: ["t4"],
              unsentDrafts: [],
              reminder: null,
            },
          }),
        ],
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with no other table", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillJoinWithDialog>(
      "till-join-with-dialog",
      { table: table("t1"), heading: "Unir 1 con", targets: [] },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
