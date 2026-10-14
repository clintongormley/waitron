import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { invoiceSeries, nodes, tenants, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import type { NodeSeed, ProvisionedNode } from "@waitron/module";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu";
import { applyVenue } from "./venue-apply.js";
import { planVenue, type VenueRequest } from "./venue-plan.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const request: VenueRequest = {
  country: "ES",
  taxId: "B12345678",
  legalName: "Restaurant SL",
  location: {
    name: "Restaurant",
    fiscalTerritory: "ES-common",
    invoiceLocales: ["es-ES"],
    operationDescription: "Venta",
    addressLine1: "Calle Mayor 1",
    addressLine2: null,
    postalCode: "28013",
    city: "Madrid",
    province: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "06:00:00",
  },
  seriesCode: "A",
  fullSeriesCode: "FF",
  rectificativeSeriesCode: "R",
  admin: {
    displayName: "Owner",
    pinHash: "hash",
    passwordHash: "hash",
    email: "owner@example.test",
  },
};
const allocated = [
  { id: "c0000000-0000-4000-8000-000000000001", code: "A-S000042", purpose: "standard" },
  { id: "c0000000-0000-4000-8000-000000000002", code: "FF-S000042", purpose: "full" },
  { id: "c0000000-0000-4000-8000-000000000003", code: "R-S000042", purpose: "rectificative" },
];
type Reference = (typeof allocated)[number];
type Resolve = (
  tx: Transaction,
  node: ProvisionedNode,
  bases: readonly { code: string; purpose: string }[],
) => Promise<readonly Reference[]>;
let seeded = false;
const read: Resolve = async (tx, node, bases) => {
  if (
    JSON.stringify(bases) !==
    JSON.stringify([
      { code: "A", purpose: "standard" },
      { code: "FF", purpose: "full" },
      { code: "R", purpose: "rectificative" },
    ])
  )
    throw new Error("requested bases differ from this allocation");
  return tx
    .select({ id: invoiceSeries.id, code: invoiceSeries.code, purpose: invoiceSeries.purpose })
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.nodeId, node.nodeId), isNull(invoiceSeries.retiredAt)))
    .orderBy(invoiceSeries.code);
};
function owner(resolve: Resolve = read, name = "fiscal-verifactu") {
  const seed = {
    summary: "activate the supplied series",
    series: { resolve },
    async run(tx: Transaction, node: ProvisionedNode) {
      if (seeded) throw new Error("a setup retry must not activate again");
      seeded = true;
      await tx
        .insert(invoiceSeries)
        .values(allocated.map((row) => ({ ...row, nodeId: node.nodeId })));
      return "allocation activated";
    },
  } as NodeSeed;
  return fakeModule(name, {
    provisioning: { seed },
    fiscal: name === "fiscal-verifactu" ? FISCAL_SLOT : undefined,
  });
}
async function setup(
  resolve: Resolve = read,
  name = "fiscal-verifactu",
  beforeCommit?: Parameters<typeof applyVenue>[1]["beforeCommit"],
) {
  const module = owner(resolve, name);
  return applyVenue(planVenue(request, [module]), {
    db: suite.db,
    modules: [module],
    beforeCommit,
  });
}
async function rows() {
  return suite.db.select().from(invoiceSeries).orderBy(invoiceSeries.code);
}
beforeEach(() => {
  seeded = false;
});

describe("the filing module owns initial invoice series", () => {
  it("returns the allocated references in purpose order and creates no scaffold rows", async () => {
    const result = await setup();
    expect(result.seriesIds).toEqual(allocated.map((row) => row.id));
    expect(
      (await rows()).map(({ id, code, purpose, retiredAt, nextNumber, nodeId }) => ({
        id,
        code,
        purpose,
        retiredAt,
        nextNumber,
        nodeId,
      })),
    ).toEqual(
      allocated.map((row) => ({ ...row, retiredAt: null, nextNumber: 1, nodeId: result.nodeId })),
    );
  });

  it("resolves a retry without rerunning activation or resetting the counter", async () => {
    const first = await setup();
    await suite.db
      .update(invoiceSeries)
      .set({ nextNumber: 9 })
      .where(eq(invoiceSeries.id, allocated[0]!.id));
    const before = await rows();
    const retry = await setup();
    expect(retry.seriesIds).toEqual(first.seriesIds);
    expect(retry.nodeId).toBe(first.nodeId);
    expect(retry.seeded).toEqual([]);
    expect(await rows()).toEqual(before);
  });

  it("orders returned references by requested purpose rather than module result order", async () => {
    expect(
      (await setup(async (tx, node, bases) => [...(await read(tx, node, bases))].reverse()))
        .seriesIds,
    ).toEqual(allocated.map((row) => row.id));
  });

  it.each([
    ["missing purpose", (refs: Reference[]) => refs.slice(0, 2)],
    ["duplicate id", (refs: Reference[]) => [refs[0]!, { ...refs[1]!, id: refs[0]!.id }, refs[2]!]],
    [
      "duplicate purpose",
      (refs: Reference[]) => [refs[0]!, { ...refs[1]!, purpose: "standard" }, refs[2]!],
    ],
    [
      "unknown id",
      (refs: Reference[]) => [
        { ...refs[0]!, id: "c0000000-0000-4000-8000-000000000099" },
        ...refs.slice(1),
      ],
    ],
    ["wrong code", (refs: Reference[]) => [{ ...refs[0]!, code: "other" }, ...refs.slice(1)]],
    [
      "extra purpose",
      (refs: Reference[]) => [
        ...refs,
        { ...refs[0]!, id: "c0000000-0000-4000-8000-000000000099", purpose: "extra" },
      ],
    ],
  ] as const)("refuses %s and rolls back the whole setup", async (_label, alter) => {
    await expect(
      setup(async (tx, node, bases) => alter([...(await read(tx, node, bases))])),
    ).rejects.toMatchObject({ code: "provisioning.second_venue" });
    expect(await rows()).toEqual([]);
    expect(await suite.db.select().from(nodes)).toEqual([]);
    expect(await suite.db.select().from(tenants)).toEqual([]);
  });

  it("refuses a returned retired reference and leaves the setup empty", async () => {
    await expect(
      setup(async (tx, node, bases) => {
        const refs = await read(tx, node, bases);
        await tx
          .update(invoiceSeries)
          .set({ retiredAt: new Date() })
          .where(eq(invoiceSeries.id, allocated[0]!.id));
        return refs;
      }),
    ).rejects.toMatchObject({ code: "provisioning.second_venue" });
    expect(await rows()).toEqual([]);
  });

  it("refuses an extra active series the owner did not return", async () => {
    await expect(
      setup(async (tx, node, bases) => {
        const refs = await read(tx, node, bases);
        await tx
          .insert(invoiceSeries)
          .values({ nodeId: node.nodeId, code: "unreported", purpose: "standard" });
        return refs;
      }),
    ).rejects.toMatchObject({ code: "provisioning.second_venue" });
    expect(await rows()).toEqual([]);
  });

  it("refuses a series claim by a module other than the node's filing module before writing", async () => {
    await expect(setup(read, "unrelated-module")).rejects.toThrow(
      "only the filing module may own initial series",
    );
    expect(await rows()).toEqual([]);
    expect(await suite.db.select().from(nodes)).toEqual([]);
  });

  it("exposes committed candidates to beforeCommit and rolls back on its refusal", async () => {
    await expect(
      setup(read, "fiscal-verifactu", async (tx, result) => {
        expect(result.seriesIds).toEqual(allocated.map((row) => row.id));
        expect((await tx.select().from(invoiceSeries)).map((row) => row.id).sort()).toEqual(
          [...result.seriesIds].sort(),
        );
        throw new Error("settings refused");
      }),
    ).rejects.toThrow("settings refused");
    expect(await rows()).toEqual([]);
    expect(await suite.db.select().from(nodes)).toEqual([]);
  });

  it("rejects changed bases on retry without altering the allocated rows", async () => {
    await setup();
    const before = await rows();
    const module = owner();
    await expect(
      applyVenue(planVenue({ ...request, fullSeriesCode: "B" }, [module]), {
        db: suite.db,
        modules: [module],
      }),
    ).rejects.toThrow("requested bases differ from this allocation");
    expect(await rows()).toEqual(before);
  });
});

it("refuses a series owner whose activation action is missing before writing", async () => {
  const module = owner();
  const plan = planVenue(request, [module]).filter((action) => action.kind !== "seed-module");
  await expect(applyVenue(plan, { db: suite.db, modules: [module] })).rejects.toThrow(
    "series owner is missing its seed action",
  );
  expect(await suite.db.select().from(tenants)).toEqual([]);
});

it("refuses two series owners even when they have the same fiscal slot id", async () => {
  const first = owner();
  const second = { ...owner(), name: "second-fiscal-owner" };
  await expect(
    applyVenue(planVenue(request, [first, second]), { db: suite.db, modules: [first, second] }),
  ).rejects.toThrow("only the filing module may own initial series");
  expect(await suite.db.select().from(tenants)).toEqual([]);
});

it("refuses a returned reference moved to a different node", async () => {
  await expect(
    setup(async (tx, node, bases) => {
      const refs = await read(tx, node, bases);
      const [other] = await tx
        .insert(nodes)
        .values({ locationId: node.locationId, name: "Other" })
        .returning({ id: nodes.id });
      await tx
        .update(invoiceSeries)
        .set({ nodeId: other!.id })
        .where(eq(invoiceSeries.id, refs[0]!.id));
      return refs;
    }),
  ).rejects.toMatchObject({ code: "provisioning.second_venue" });
  expect(await rows()).toEqual([]);
  expect(await suite.db.select().from(nodes)).toEqual([]);
});

it("refuses duplicated requested purposes even if a module returns a different complete set", async () => {
  const module = owner(async (tx, node) =>
    tx
      .select({ id: invoiceSeries.id, code: invoiceSeries.code, purpose: invoiceSeries.purpose })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.nodeId, node.nodeId)),
  );
  const plan = planVenue(request, [module]).map((action) =>
    action.kind === "create-series" && action.purpose === "rectificative"
      ? { ...action, purpose: "standard" as const }
      : action,
  );
  await expect(applyVenue(plan, { db: suite.db, modules: [module] })).rejects.toMatchObject({
    code: "provisioning.second_venue",
  });
  expect(await rows()).toEqual([]);
  expect(await suite.db.select().from(nodes)).toEqual([]);
});
