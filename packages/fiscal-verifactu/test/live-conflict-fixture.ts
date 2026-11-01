import { eq } from "drizzle-orm";
import { invoiceSeries, stampDeployment, withTransaction, type Database } from "@waitron/db";
import { recordSale } from "@waitron/core";
import { withOperationAuthority } from "@waitron/module";
import { locationId, seriesId } from "@waitron/shared";
import { seedTenants, TENANT_A } from "./fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "./write-path-fixtures.js";
import { createHourPreparation } from "../src/hour-preparation.js";
import { activatePreparedModuleAllocation } from "../src/allocation-preparation.js";
import { compareHourClocks } from "../src/hour-clock.js";
import { VerifactuBackend } from "../src/backend.js";
import { openFilingCase } from "../src/filing-cases.js";
import { envios } from "../src/schema/envios.js";
import { fiscalAllocations } from "../src/schema/allocations.js";

export const liveConflictNode = {
  nodeId: TENANT_A.nodeId,
  locationId: locationId(TENANT_A.locationId),
};
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
export async function seedLiveConflict(
  db: Database,
  clock: { wall(): number; monotonic(): number; advance(ms: number): void },
) {
  const node = liveConflictNode;
  await seedTenants(db);
  await stampDeployment(db, "preproduction");
  let state: unknown = null;
  const setup = createHourPreparation({
    withState: async (_binding, run) =>
      run({
        get value() {
          return state;
        },
        history: [],
        async replace(next) {
          state = structuredClone(next);
        },
      }),
    monotonicNow: clock.monotonic,
    read: async () => ({
      scope: { taxpayerNif: "89890001K", environment: "preproduction" },
      bases,
      contextKey: "setup",
      history: [{ reference: "empty", complete: true, records: [] }],
      clock: compareHourClocks(
        ["box", "browser"].map((source) => ({
          source: source as "box" | "browser",
          result: "usable",
          instantMs: clock.wall(),
          uncertaintyMs: 0,
          wallStartedMs: clock.wall(),
          wallFinishedMs: clock.wall(),
          monotonicStartedMs: clock.monotonic(),
          monotonicFinishedMs: clock.monotonic(),
        })),
        Date.parse("2026-10-15T00:00:00Z"),
      ),
    }),
  });
  const binding = {
    module: "fiscal-verifactu",
    action: "setup",
    eventId: "first",
    sourceId: "first",
    targetNodeId: node.nodeId,
  };
  await withOperationAuthority(binding, "administrator", async (authority) => {
    const waiting = await setup.select({ binding, authority, comparisonId: "clock" });
    if (waiting.status !== "waiting") throw new Error("setup did not wait");
    clock.advance(waiting.remainingMs);
    const selected = await setup.select({ binding, authority, comparisonId: "clock" });
    if (selected.status !== "selected") throw new Error("setup did not select");
    await setup.prepare({ binding, authority, input: selected.input }, (prepared) =>
      withTransaction(db, (tx) => activatePreparedModuleAllocation(tx, node, prepared)),
    );
  });
  const [series] = await db
    .select()
    .from(invoiceSeries)
    .where(eq(invoiceSeries.purpose, "standard"));
  const backend = new VerifactuBackend({
    db,
    clock: steadyClock,
    deploymentEnvironment: "preproduction",
    resolveClient: staticResolver(fakeClient),
  });
  const original = await withTransaction(db, (tx) =>
    recordSale(tx, backend, saleInput({ nodeId: node.nodeId, seriesId: seriesId(series!.id) })),
  );
  const incident = await withTransaction(db, async (tx) => {
    await tx
      .update(envios)
      .set({ estado: "rechazado" })
      .where(eq(envios.registroId, original.fiscal.recordId));
    return openFilingCase(tx, {
      registroId: original.fiscal.recordId,
      cause: "fiscal.huella_divergente",
      evidence: { codigo: 3000, mensaje: "Conflict", csv: null },
      now: new Date(clock.wall()),
    });
  });
  const [allocation] = await db.select().from(fiscalAllocations);
  return { registroId: original.fiscal.recordId, caseId: incident.id, sifId: allocation!.sifId };
}
