import { expect, it } from "vitest";
import type { BillEditState } from "../api/order-types.js";
import { counterBillEdit, expectedEditOf, foundBillEdit } from "./bill-edit.js";

const edit: BillEditState = {
  billId: "wo-1",
  editorId: "ana",
  editorName: "Ana",
  editorVersion: 3,
  draftId: "draft-1",
  draftRevision: 2,
};
const expected = { billId: "wo-1", editorVersion: 3, draftId: "draft-1", draftRevision: 2 };

it("keeps only the fields a write expects", () => {
  expect(expectedEditOf(edit)).toEqual(expected);
});

it("gives a Counter order's own edit state", () => {
  expect(counterBillEdit({ workingOrderId: "wo-1", partyId: null, edit }, "wo-1")).toEqual(
    expected,
  );
});

it.each([
  ["another order's read", { workingOrderId: "wo-2", partyId: null, edit }],
  ["a read naming a party", { workingOrderId: "wo-1", partyId: "v1", edit }],
  ["a read with no edit state", { workingOrderId: "wo-1", partyId: null, edit: null }],
  ["a read with its edit state missing", { workingOrderId: "wo-1", partyId: null }],
  [
    "an edit state of another bill",
    { workingOrderId: "wo-1", partyId: null, edit: { ...edit, billId: "wo-2" } },
  ],
])("refuses %s as out of date", (_name, bill) => {
  expect(() => counterBillEdit(bill, "wo-1")).toThrow(
    expect.objectContaining({ code: "draft.out_of_date" }),
  );
});

it("gives a Find bill row's edit state, null at no table and undefined when the row has none", () => {
  expect(foundBillEdit({ partyId: "v1", edit })).toEqual(expected);
  expect(foundBillEdit({ partyId: null, edit })).toBeNull();
  expect(foundBillEdit({ partyId: "v1", edit: null })).toBeUndefined();
  expect(foundBillEdit({ partyId: "v1" })).toBeUndefined();
});
