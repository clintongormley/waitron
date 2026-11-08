import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  UNIQUE_VIOLATION,
  captureError,
  isRefusal,
  withTransaction,
} from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  insertHandoverActivationTx,
  readHandoverActivation,
  type HandoverActivationRow,
} from "./activations.js";
import type { SignedHandoverEnvelope } from "./envelope.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

const OP_X = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OP_Y = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVIDENCE: SignedHandoverEnvelope<unknown> = {
  purpose: "waitron.handover.relinquishment.v1",
  body: { operationId: OP_X },
  signerNodeId: "source-node",
  signature: "signature",
};

async function nodes(): Promise<{ a: string; b: string; c: string }> {
  await seedVenue(suite.db);
  return {
    a: await seedNode(suite.db),
    b: await seedNode(suite.db),
    c: await seedNode(suite.db),
  };
}

function activation(
  source: string,
  destination: string,
  overrides: Partial<HandoverActivationRow> = {},
): HandoverActivationRow {
  return {
    operationId: OP_X,
    scenario: "controlled",
    sourceNodeId: source,
    destinationNodeId: destination,
    evidence: EVIDENCE,
    personId: "person-1",
    activatedAt: "2026-11-04T10:00:00.000Z",
    ...overrides,
  };
}

function insert(row: HandoverActivationRow): Promise<void> {
  return withTransaction(suite.db, (tx) => insertHandoverActivationTx(tx, row));
}

describe("the record of activations", () => {
  it("reads back exactly what was written, evidence included", async () => {
    const { a, b } = await nodes();
    await insert(activation(a, b));
    expect(await readHandoverActivation(suite.db, OP_X)).toEqual(activation(a, b));
  });

  it("answers null for an operation that never activated", async () => {
    const { a, b } = await nodes();
    await insert(activation(a, b));
    expect(await readHandoverActivation(suite.db, OP_Y)).toBeNull();
  });

  it("refuses a second activation of one operation and keeps the first", async () => {
    const { a, b, c } = await nodes();
    await insert(activation(a, b));
    const error = await captureError(() => insert(activation(a, c)));
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    expect(await readHandoverActivation(suite.db, OP_X)).toEqual(activation(a, b));
  });

  it("the transaction that rolls back takes the row with it", async () => {
    const { a, b } = await nodes();
    await expect(
      withTransaction(suite.db, async (tx) => {
        await insertHandoverActivationTx(tx, activation(a, b));
        throw new Error("after the insert");
      }),
    ).rejects.toThrow("after the insert");
    expect(await readHandoverActivation(suite.db, OP_X)).toBeNull();
  });

  it("stores one spelling of the time, whatever spelling the caller gave", async () => {
    const { a, b } = await nodes();
    await insert(
      activation(a, b, { operationId: OP_X, activatedAt: "2026-11-04T12:00:00.000+02:00" }),
    );
    expect((await readHandoverActivation(suite.db, OP_X))?.activatedAt).toBe(
      "2026-11-04T10:00:00.000Z",
    );
  });

  it("reads inside a transaction", async () => {
    const { a, b } = await nodes();
    const seen = await withTransaction(suite.db, async (tx) => {
      await insertHandoverActivationTx(tx, activation(a, b));
      return readHandoverActivation(tx, OP_X);
    });
    expect(seen).toEqual(activation(a, b));
  });
});
