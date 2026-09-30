import type {
  AdjustmentEntry,
  AdjustmentReport,
  AdjustmentTally,
  AdjustmentTotals,
} from "./client.js";

// The service plan's fixture day (Task 12), as the report routes answer it: Alex comps a €12.00
// Burger (approved by Mia), cancels that comped Burger, and cancels a fired €25.00 Steak; Sam takes
// €3.00 off a whole bill. Alex is credited €800.00 of sales and Sam €200.00.

export const ALEX = "0f2d3c4b-5a69-4788-9a0b-1c2d3e4f5a6b";
export const MIA = "1a2b3c4d-5e6f-4a0b-8c1d-2e3f4a5b6c7d";
export const SAM = "2b3c4d5e-6f7a-4b1c-9d2e-3f4a5b6c7d8e";

export function tally(
  count: number,
  reduction: string,
  cancelledNominalValue: string,
): AdjustmentTally {
  return { count, reduction, cancelledNominalValue };
}

const none = tally(0, "0.00", "0.00");

export function emptyTotals(): AdjustmentTotals {
  return {
    ...none,
    byAction: { cancel: none, comp: none, discount_percent: none, discount_amount: none },
    byStage: { beforeFiring: none, afterFiring: none, afterServing: none, billDiscount: none },
    byReason: [],
  };
}

const alexTotals: AdjustmentTotals = {
  ...tally(3, "37.00", "37.00"),
  byAction: {
    cancel: tally(2, "25.00", "37.00"),
    comp: tally(1, "12.00", "0.00"),
    discount_percent: none,
    discount_amount: none,
  },
  byStage: {
    beforeFiring: none,
    afterFiring: tally(1, "25.00", "25.00"),
    afterServing: tally(2, "12.00", "12.00"),
    billDiscount: none,
  },
  byReason: [
    { reasonId: "r-mistake", reasonName: "Entry error", ...tally(2, "25.00", "37.00") },
    { reasonId: "r-cold", reasonName: "Cold food", ...tally(1, "12.00", "0.00") },
  ],
};

const samTotals: AdjustmentTotals = {
  ...tally(1, "3.00", "0.00"),
  byAction: {
    cancel: none,
    comp: none,
    discount_percent: none,
    discount_amount: tally(1, "3.00", "0.00"),
  },
  byStage: {
    beforeFiring: none,
    afterFiring: none,
    afterServing: none,
    billDiscount: tally(1, "3.00", "0.00"),
  },
  byReason: [{ reasonId: "r-staff", reasonName: "Staff meal", ...tally(1, "3.00", "0.00") }],
};

export function fixtureReport(from = "2026-09-29", to = from): AdjustmentReport {
  return {
    fromBusinessDay: from,
    toBusinessDay: to,
    overall: {
      ...tally(4, "40.00", "37.00"),
      byAction: {
        cancel: tally(2, "25.00", "37.00"),
        comp: tally(1, "12.00", "0.00"),
        discount_percent: none,
        discount_amount: tally(1, "3.00", "0.00"),
      },
      byStage: {
        beforeFiring: none,
        afterFiring: tally(1, "25.00", "25.00"),
        afterServing: tally(2, "12.00", "12.00"),
        billDiscount: tally(1, "3.00", "0.00"),
      },
      byReason: [...alexTotals.byReason, ...samTotals.byReason],
      sales: "1000.00",
      ratePercent: "4.0",
    },
    people: [
      {
        personId: ALEX,
        name: "Alex",
        ...alexTotals,
        sales: "800.00",
        ratePercent: "4.6",
        approvers: [{ personId: MIA, name: "Mia", count: 1 }],
        approvalsGiven: 0,
      },
      {
        personId: MIA,
        name: "Mia",
        ...emptyTotals(),
        sales: "0.00",
        ratePercent: null,
        approvers: [],
        approvalsGiven: 1,
      },
      {
        personId: SAM,
        name: "Sam",
        ...samTotals,
        sales: "200.00",
        ratePercent: "1.5",
        approvers: [],
        approvalsGiven: 0,
      },
    ],
    guests: emptyTotals(),
  };
}

export function emptyReport(from = "2026-09-29", to = from): AdjustmentReport {
  return {
    fromBusinessDay: from,
    toBusinessDay: to,
    overall: { ...emptyTotals(), sales: "0.00", ratePercent: null },
    people: [],
    guests: emptyTotals(),
  };
}

const alex = { personId: ALEX, name: "Alex" };

/** Alex's three rows, newest first. The comp's reason was named "Cold food" when it was recorded. */
export function alexEntries(): AdjustmentEntry[] {
  const row = {
    reasonId: "r-mistake",
    reasonName: "Entry error",
    percentBp: null,
    requestedBy: alex,
    approvedBy: null,
    creditedTo: alex,
    byGuest: false,
    quantity: "1.000",
  };
  return [
    {
      ...row,
      id: "e3",
      createdAt: "2026-09-29T19:40:00.000Z",
      action: "cancel",
      stage: "fired",
      note: "Keyed on the wrong table",
      lineName: "Steak",
      beforeAmount: "25.00",
      afterAmount: "0.00",
      reduction: "25.00",
      nominalValue: "25.00",
      workingOrderId: "w2",
      orderNumber: 41,
    },
    {
      ...row,
      id: "e2",
      createdAt: "2026-09-29T19:30:00.000Z",
      action: "cancel",
      stage: "served",
      note: null,
      lineName: "Burger",
      beforeAmount: "0.00",
      afterAmount: "0.00",
      reduction: "0.00",
      nominalValue: "12.00",
      workingOrderId: "w1",
      orderNumber: 40,
    },
    {
      ...row,
      id: "e1",
      createdAt: "2026-09-29T19:20:00.000Z",
      action: "comp",
      stage: "served",
      reasonId: "r-cold",
      reasonName: "Cold food",
      note: "Came out cold",
      lineName: "Burger",
      beforeAmount: "12.00",
      afterAmount: "0.00",
      reduction: "12.00",
      nominalValue: "12.00",
      approvedBy: { personId: MIA, name: "Mia" },
      workingOrderId: "w1",
      orderNumber: 40,
    },
  ];
}

/** Sam's discount on a whole bill: no item, no quantity, no stage. */
export function samEntry(): AdjustmentEntry {
  return {
    id: "e4",
    createdAt: "2026-09-29T21:05:00.000Z",
    action: "discount_percent",
    stage: null,
    reasonId: "r-staff",
    reasonName: "Staff meal",
    note: null,
    lineName: null,
    quantity: null,
    percentBp: 1250,
    beforeAmount: "24.00",
    afterAmount: "21.00",
    reduction: "3.00",
    nominalValue: "24.00",
    requestedBy: { personId: SAM, name: "Sam" },
    approvedBy: null,
    creditedTo: null,
    byGuest: false,
    workingOrderId: "w3",
    orderNumber: 43,
  };
}
