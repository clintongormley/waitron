import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { deployment, locations, nodes, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type ThrowawayAllocation } from "@waitron/module";
import { locationId, nodeId as brandNodeId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { FISCAL_PROVISIONING } from "./provisioning.js";
import { createThrowawayAllocation } from "./throwaway-allocation.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const TAXPAYER = "B12345674";
const node = {
  nodeId: brandNodeId("c0000000-0000-4000-8000-000000000008"),
  locationId: locationId("c0000000-0000-4000-8000-000000000002"),
};
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];

function seat(): ThrowawayAllocation {
  return FISCAL_PROVISIONING.throwawayAllocation!;
}

async function seedVenue(stamp: "preproduction" | "production") {
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: TAXPAYER, legalName: "Real Restaurant S.L." });
  await suite.db.insert(locations).values({
    id: node.locationId,
    name: "Casa Real",
    invoiceLocales: ["es"],
    operationDescription: "Venta en establecimiento",
  });
  await suite.db
    .insert(nodes)
    .values({ id: node.nodeId, locationId: node.locationId, name: "Node 1" });
  await suite.db.insert(deployment).values({ id: 1, environment: stamp });
}

function prepareFor(environments: readonly ("production" | "preproduction")[]) {
  return seat().prepare({
    environments,
    taxpayerNif: TAXPAYER,
    bases,
    nodeId: node.nodeId,
    administratorId: randomUUID(),
  });
}

/** Runs the seat's evidence source around the real seed, the way `applyVenue` does. */
async function activate(prepared: ReturnType<ThrowawayAllocation["prepare"]>, operator: string) {
  const binding = {
    module: "fiscal-verifactu",
    action: "setup",
    eventId: prepared.eventId,
    sourceId: prepared.sourceId,
    targetNodeId: node.nodeId,
  };
  return withOperationAuthority(binding, operator, (authority) =>
    prepared.operations.prepare({ binding, authority, input: prepared.input }, (operation) =>
      withTransaction(suite.db, async (tx) => {
        await FISCAL_PROVISIONING.seed!.run(tx, node, operation);
        return FISCAL_PROVISIONING.seed!.series!.resolve(tx, node, bases);
      }),
    ),
  );
}

function signFor(administratorId: string) {
  return seat().prepare({
    environments: ["preproduction"],
    taxpayerNif: TAXPAYER,
    bases,
    nodeId: node.nodeId,
    administratorId,
  });
}

describe("the throwaway allocation seat", () => {
  describe("on a preproduction-stamped venue", () => {
    beforeEach(() => seedVenue("preproduction"));

    it("signs a preproduction allocation any taxpayer can activate", async () => {
      const administratorId = randomUUID();
      const series = await activate(signFor(administratorId), administratorId);
      expect(suite.db.all(sql`select numero_instalacion, node_id from registro_sif`)).toEqual([
        { numero_instalacion: "S000001", node_id: node.nodeId },
      ]);
      expect(suite.db.all(sql`select taxpayer_nif, environment from fiscal_allocations`)).toEqual([
        { taxpayer_nif: TAXPAYER, environment: "preproduction" },
      ]);
      expect(series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
        { code: "A-S000001", purpose: "standard" },
        { code: "FF-S000001", purpose: "full" },
        { code: "R-S000001", purpose: "rectificative" },
      ]);
    });

    it("marks every identifier it chooses as throwaway, and nothing in the SIF row", async () => {
      const administratorId = randomUUID();
      const prepared = signFor(administratorId);
      await activate(prepared, administratorId);
      const [row] = suite.db.all<{ allocation_key: string; allocation: string; approval: string }>(
        sql`select allocation_key, allocation, approval from fiscal_allocations`,
      );
      const allocation = JSON.parse(row!.allocation) as {
        allocationId: string;
        source: string;
        environment: string;
        installationIdentity: string;
        reservationEvidence: {
          block: {
            payload: {
              custodianId: string;
              recipientVenueId: string;
              generationId: string;
              blockId: string;
            };
          };
          consumption: { payload: { sourceId: string; incidentEvidence: string } };
        };
      };
      const approval = JSON.parse(row!.approval) as Record<string, unknown>;
      const throwawayId =
        /^throwaway-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

      expect(row!.allocation_key).toMatch(throwawayId);
      expect(allocation.allocationId).toBe(row!.allocation_key);
      const block = allocation.reservationEvidence.block.payload;
      expect(block.custodianId).toBe("waitron-throwaway-preproduction");
      expect(block.recipientVenueId).toBe("throwaway-preproduction");
      expect(block.generationId).toMatch(throwawayId);
      expect(block.blockId).toMatch(throwawayId);
      expect(new Set([row!.allocation_key, block.generationId, block.blockId]).size).toBe(3);
      expect(allocation.reservationEvidence.consumption.payload).toMatchObject({
        sourceId: "throwaway-preproduction",
        incidentEvidence: "throwaway-preproduction-allocation",
      });
      expect(prepared.sourceId).toBe("throwaway-preproduction");
      expect(approval).toMatchObject({
        sourceId: "throwaway-preproduction",
        incidentEvidence: "throwaway-preproduction-allocation",
      });
      // Unchanged on purpose: these reach AEAT or the unchanged validation.
      expect(allocation).toMatchObject({
        source: "initial-paper",
        environment: "preproduction",
        installationIdentity: "S000001",
      });
      const sif = suite.db.all(sql`select * from registro_sif`);
      expect(sif).toHaveLength(1);
      expect(JSON.stringify(sif)).not.toMatch(/throwaway/i);
    });

    it("makes a new key and new ids on every call", () => {
      const made: KeyObject[] = [];
      const counted = createThrowawayAllocation({
        generateKey: () => {
          const pair = generateKeyPairSync("ed25519");
          made.push(pair.publicKey);
          return pair;
        },
      });
      const sign = () =>
        counted.prepare({
          environments: ["preproduction"],
          taxpayerNif: TAXPAYER,
          bases,
          nodeId: node.nodeId,
          administratorId: randomUUID(),
        });
      const ids = (prepared: ReturnType<typeof sign>) => {
        const { allocation } = prepared.input as {
          allocation: {
            allocationId: string;
            reservationEvidence: { block: { payload: { generationId: string; blockId: string } } };
          };
        };
        const { generationId, blockId } = allocation.reservationEvidence.block.payload;
        return [prepared.eventId, allocation.allocationId, generationId, blockId];
      };
      const first = ids(sign());
      const second = ids(sign());
      expect(made).toHaveLength(2);
      expect(made[0]!.equals(made[1]!)).toBe(false);
      expect(new Set([...first, ...second]).size).toBe(8);
    });

    it.each([[["preproduction"]], [["preproduction", "preproduction"]]] as const)(
      "accepts %j",
      (environments) => {
        const prepared = prepareFor(environments);
        expect(
          (prepared.input as { allocation: { environment: string } }).allocation.environment,
        ).toBe("preproduction");
      },
    );
  });

  describe("refusals", () => {
    it.each([
      [["production"], "production"],
      [["preproduction", "production"], "production"],
      [["production", "preproduction"], "production"],
      [[], "none"],
    ] as const)("refuses %j before making a key", (environments, reported) => {
      let keys = 0;
      const counted = createThrowawayAllocation({
        generateKey: () => {
          keys += 1;
          return generateKeyPairSync("ed25519");
        },
      });
      expect(() =>
        counted.prepare({
          environments,
          taxpayerNif: TAXPAYER,
          bases,
          nodeId: node.nodeId,
          administratorId: randomUUID(),
        }),
      ).toThrow(
        expect.objectContaining({
          code: "sif.throwaway_allocation_refused",
          params: { environment: reported },
        }),
      );
      expect(keys).toBe(0);
    });

    it("the seat refuses production too", () => {
      expect(() => prepareFor(["production"])).toThrow(
        expect.objectContaining({ code: "sif.throwaway_allocation_refused" }),
      );
    });

    it("makes exactly one key for an accepted request", () => {
      let keys = 0;
      const counted = createThrowawayAllocation({
        generateKey: () => {
          keys += 1;
          return generateKeyPairSync("ed25519");
        },
      });
      counted.prepare({
        environments: ["preproduction"],
        taxpayerNif: TAXPAYER,
        bases,
        nodeId: node.nodeId,
        administratorId: randomUUID(),
      });
      expect(keys).toBe(1);
    });

    it("a production-stamped database refuses what it signs", async () => {
      await seedVenue("production");
      const administratorId = randomUUID();
      await expect(activate(signFor(administratorId), administratorId)).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "environment_mismatch" },
      });
      expect(suite.db.all(sql`select * from registro_sif`)).toEqual([]);
    });
  });
});
