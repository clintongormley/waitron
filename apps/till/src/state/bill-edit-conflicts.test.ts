import { expect, it } from "vitest";
import type { BillEditState } from "../api/client.js";
import { billEditConflictRows } from "./bill-edit-conflicts.js";

const source: BillEditState = {
  billId: "bill-z",
  editorId: "ana",
  editorName: "Ana",
  editorVersion: 3,
  draftId: "draft-z",
  draftRevision: 2,
};
const target: BillEditState = {
  billId: "bill-a",
  editorId: "luis",
  editorName: "Luis",
  editorVersion: 5,
  draftId: "draft-a",
  draftRevision: 4,
};
const parties = [
  { partyId: "table-4", edits: [source], label: () => "4 · Bill 2" },
  { partyId: "table-7", edits: [target], label: () => "7 · Bill 2" },
];

it("keeps each row with the party that supplied its bill and the refusal's revision", () => {
  const refusal = {
    code: "draft.taken_over",
    conflicts: [{ ...target, draftRevision: 5 }, source],
  };
  expect(billEditConflictRows(refusal, parties)).toEqual([
    {
      partyId: "table-7",
      label: "7 · Bill 2",
      ownerName: "Luis",
      edit: { billId: "bill-a", editorVersion: 5, draftId: "draft-a", draftRevision: 5 },
    },
    {
      partyId: "table-4",
      label: "4 · Bill 2",
      ownerName: "Ana",
      edit: { billId: "bill-z", editorVersion: 3, draftId: "draft-z", draftRevision: 2 },
    },
  ]);
});

it("does not guess a party for a bill outside the action's reads", () => {
  const refusal = { code: "draft.taken_over", conflicts: [{ ...target, billId: "another" }] };
  expect(billEditConflictRows(refusal, parties)).toEqual([]);
});

it("ignores a refusal without the list and skips incomplete entries", () => {
  expect(billEditConflictRows({ code: "draft.taken_over", edit: source }, parties)).toEqual([]);
  const refusal = { code: "draft.taken_over", conflicts: [null, { billId: "bill-a" }, target] };
  expect(billEditConflictRows(refusal, parties)).toHaveLength(1);
  expect(billEditConflictRows({ ...refusal, code: "draft.out_of_date" }, parties)).toEqual([]);
});
