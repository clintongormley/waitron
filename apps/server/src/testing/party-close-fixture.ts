import type { Database, Transaction } from "@waitron/db";
import type { BillEditExpected } from "../order-drafts.js";
import { readBillEditState, readPartyBillIds } from "../bill-editing.js";
import { closeParty as close, finishTable as finish, partyFamily } from "../parties.js";
export * from "../parties.js";

export async function closingEditsForTest(tx: Transaction, partyId: string) {
  const edits: BillEditExpected[] = [];
  for (const id of await readPartyBillIds(tx, await partyFamily(tx, partyId)))
    edits.push(await readBillEditState(tx, id));
  return edits;
}

export async function finishTable(
  tx: Transaction,
  args: Omit<Parameters<typeof finish>[1], "expectedEdits"> & {
    expectedEdits?: BillEditExpected[];
  },
  attendance?: Parameters<typeof finish>[2],
) {
  return finish(
    tx,
    {
      ...args,
      expectedEdits: args.expectedEdits ?? (await closingEditsForTest(tx, args.partyId)),
    },
    attendance,
  );
}

export async function closeParty(
  tx: Transaction,
  partyId: string,
  empty: readonly string[],
  operatorId: string,
  attendance?: Parameters<typeof close>[4],
) {
  return close(tx, partyId, empty, operatorId, attendance, await closingEditsForTest(tx, partyId));
}

export async function observedClosingBody(db: Database, path: string, body: unknown) {
  const match = /^\/api\/parties\/([^/]+)\/(?:finish|unpaid-departure)$/.exec(path);
  if (
    match === null ||
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.hasOwn(body, "expectedEdits")
  )
    return body;
  return { ...body, expectedEdits: await closingEditsForTest(db, match[1]!) };
}
