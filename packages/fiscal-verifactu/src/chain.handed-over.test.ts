import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { captureError, withTransaction, writeNodeMembership } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError } from "@waitron/shared";
import { registrosFacturacion } from "./schema/registros.js";
import { appendToChain } from "./chain.js";
import { altaFor, seedNode, seedSale, type SeededNode } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

type Chart = Parameters<typeof writeNodeMembership>[1];

let m1: SeededNode;
let m2: SeededNode;

beforeEach(async () => {
  m1 = await seedNode(suite.db, "A");
  m2 = await seedNode(suite.db, "B");
});

function chart(term: number, primary: string, other: string): Chart {
  return {
    body: {
      term,
      nodes: [
        { nodeId: primary, contactUrl: "https://primary", standing: "serving-primary" },
        { nodeId: other, contactUrl: "https://other", standing: "sell-only" },
      ],
    },
    signerNodeId: primary,
    signature: `sig-${term}`,
    endorsements: [],
  };
}

async function recordsOf(node: SeededNode): Promise<number> {
  const rows = await suite.db
    .select({ id: registrosFacturacion.id })
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.nodeId, node.nodeId));
  return rows.length;
}

async function append(node: SeededNode, n: number) {
  const saleId = await seedSale(suite.db, node, n);
  return withTransaction(suite.db, (tx) =>
    appendToChain(tx, node.nodeId, altaFor(node, saleId, n, n)),
  );
}

describe("appendToChain after a handover", () => {
  it("a box the chart does not name primary appends nothing", async () => {
    await writeNodeMembership(suite.db, chart(2, m2.nodeId, m1.nodeId));

    const error = await captureError(() => append(m1, 1));

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("fiscal.chain_handed_over");
    expect((error as AppError).params).toEqual({ nodeId: m1.nodeId });
    expect(await recordsOf(m1)).toBe(0);
  });

  it("the box the chart names primary appends", async () => {
    await writeNodeMembership(suite.db, chart(2, m2.nodeId, m1.nodeId));

    const result = await append(m2, 1);

    expect(result.secuencia).toBe(1);
    expect(await recordsOf(m2)).toBe(1);
  });

  it("a box that took back appends again", async () => {
    await writeNodeMembership(suite.db, chart(2, m2.nodeId, m1.nodeId));
    expect((await captureError(() => append(m1, 1))) as AppError).toMatchObject({
      code: "fiscal.chain_handed_over",
    });

    await writeNodeMembership(suite.db, chart(3, m1.nodeId, m2.nodeId));
    const result = await append(m1, 2);

    expect(result.secuencia).toBe(1);
    expect(await recordsOf(m1)).toBe(1);
  });

  it("with no chart held, a box appends", async () => {
    const result = await append(m1, 1);

    expect(result.secuencia).toBe(1);
    expect(await recordsOf(m1)).toBe(1);
  });
});
