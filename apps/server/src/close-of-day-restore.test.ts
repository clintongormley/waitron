import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { deployment, readVenueClock, taxpayer } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { TrustedClock } from "@waitron/fiscal";
import * as fiscal from "@waitron/fiscal-verifactu";
import {
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { businessDayAt, businessDayBounds } from "@waitron/shared";
import { mintMasterKey } from "./testing/master-key.js";
import { closeOfDayJob } from "./close-of-day.js";
import { withRecoveryModuleOperation } from "./recovery-module-operation.js";
import { runRestoreHooks } from "./restore.js";
import { gateSeatOnStartClock } from "./start-clock-gate.js";
import { systemClock } from "./till-backend.js";
import {
  fiscalRecordCount,
  inTx,
  provisionBillVenue,
  seatedWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import "./errors.js";

let venue: BillVenue;
let seatHolds = false;
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A table bill with a dish sent, stored as opened at `openedAt`: its trusted opening time too,
 * unless it was seated while the time was unconfirmed. */
async function billOpenedAt(openedAt: number) {
  const seating = venue.appWith({ clockUnconfirmed: () => seatHolds });
  const party = await seatedWith({ ...venue, app: seating }, "Red wine bottle");
  const stored = new Date(openedAt).toISOString();
  venue.db.run(sql`
    update working_orders
    set opened_at = ${stored},
      trusted_opened_at = iif(trusted_opened_at is null, null, ${stored})
    where id = ${party.tabId}
  `);
  return party.tabId;
}

/** The fiscal module's real restore hook, given a signed paper allocation for this venue's node. */
async function restoreThroughFiscalHook() {
  const nodeId = venue.cfg.nodeId;
  const binding = {
    module: "fiscal-verifactu",
    action: "restore",
    eventId: "close-of-day-restore",
    sourceId: "selected-backup",
    targetNodeId: nodeId,
  };
  const operatorId = { kind: "recovery-key" as const, nodeId, eventId: binding.eventId };
  const { bases, nif } = await inTx(venue, async (tx) => {
    await tx
      .insert(deployment)
      .values({ id: 1, environment: "preproduction" })
      .onConflictDoNothing({ target: deployment.id });
    const [payer] = await tx.select({ taxId: taxpayer.taxId }).from(taxpayer);
    return { bases: await fiscal.liveSeriesBases(tx, { nodeId }), nif: payer!.taxId };
  });
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const fingerprint = paperCustodianFingerprint(publicKey)!;
  const candidate = {
    version: 1 as const,
    allocationId: "close-of-day-paper-42",
    taxpayerNif: nif,
    // The software id `provisionBillVenue`'s fixture registers; a different one refuses the restore.
    softwareId: "W1",
    environment: "preproduction" as const,
    installationIdentity: "P000042",
    series: bases.map((base) => ({ code: `${base.code}-P000042`, purpose: base.purpose })),
    source: "paper" as const,
    issuedAt: "2026-10-13T10:00:00.000Z",
  };
  const block = signPaperBlock(
    {
      version: 1,
      custodianId: "external-custodian",
      generationId: "current-generation",
      blockId: "current-block",
      packVersion: 1,
      recipientVenueId: "source-venue",
      allocations: [candidate],
    },
    privateKey,
  );
  const approval = {
    version: 1 as const,
    eventId: binding.eventId,
    operatorId,
    sourceId: binding.sourceId,
    targetNodeId: nodeId,
    oldMachineOffline: true,
    oldMachineAbsent: false,
    noParallelRecovery: true,
    confirmedAt: "2026-10-13T11:00:00.000Z",
    incidentEvidence: "outside/source-42",
  };
  const consumption = signPaperConsumptionForBlock(
    block,
    candidate.allocationId,
    {
      eventId: binding.eventId,
      operatorId,
      sourceId: binding.sourceId,
      targetNodeId: nodeId,
      incidentEvidence: approval.incidentEvidence,
      consumedAt: approval.confirmedAt,
    },
    privateKey,
  );
  const confirmation = {
    version: 1,
    allocationId: candidate.allocationId,
    binding,
    operatorId,
    priorActivation: "none",
    incidentEvidence: approval.incidentEvidence,
    requiredBases: bases,
    recipientVenueId: "source-venue",
    generationId: "current-generation",
    blockId: "current-block",
    currentRegisterConfirmed: true,
    consumptionConfirmed: true,
    currentEntryState: "consumed-for-event",
  };
  const dir = await mkdtemp(join(tmpdir(), "close-of-day-restore-"));
  try {
    const custodianPath = join(dir, "public.json");
    const confirmationPath = join(dir, "current.json");
    await writeFile(
      custodianPath,
      JSON.stringify({ custodianId: "external-custodian", publicKey, fingerprint }),
    );
    await writeFile(confirmationPath, JSON.stringify(confirmation));
    const secret = (await mintMasterKey(suite.db)).secret;
    const module = {
      ...fakeModule(binding.module, {
        operations: fiscal.createPaperAllocationPreparation({
          custodianPath,
          confirmationPath,
          confirmedFingerprint: fingerprint,
        }),
      }),
      backup: { restore: fiscal.ALLOCATED_FISCAL_RESTORE },
    };
    return await runRestoreHooks({
      db: suite.db,
      nodeDb: suite.node,
      node: { nodeId },
      modules: [module],
      log: () => {},
      withModuleOperations: (context, run) =>
        withRecoveryModuleOperation(
          { ...context, modules: [module] },
          {
            binding,
            input: {
              allocation: { ...candidate, reservationEvidence: { block, consumption } },
              approval,
            },
            secret,
          },
          run,
        ),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const HOUR = 60 * MINUTE;

// Backward: the clock read later before the restore than at it, and earlier again after it.
it.each([
  {
    order: "forward",
    before: () => Date.now() - DAY,
    after: (restoredAt: number) => restoredAt + 30_000,
  },
  { order: "backward", before: () => Date.now() + HOUR, after: () => Date.now() - DAY },
])(
  "leaves bills from before a Veri*Factu restore for staff, whether or not their time was confirmed, and issues one opened after it, with the clock moving $order",
  async ({ before, after: afterAt }) => {
    venue = await provisionBillVenue(suite.db);
    const clock = await inTx(venue, (tx) => readVenueClock(tx));
    const openedBefore = before();
    seatHolds = true;
    const unconfirmed = await billOpenedAt(openedBefore);
    seatHolds = false;
    const confirmed = await billOpenedAt(openedBefore);

    const restored = await restoreThroughFiscalHook();
    expect(restored.reports).toEqual([expect.stringMatching(/^fiscal-verifactu: SIF /)]);
    const restoredAt = Date.now();
    const after = await billOpenedAt(afterAt(restoredAt));

    let at = restoredAt + MINUTE;
    const base = systemClock();
    const trusted: TrustedClock = {
      ...base,
      now: () => ({ ...base.now(), instant: new Date(at), offsetMinutes: 60 }),
    };
    const definition = closeOfDayJob({
      admission: testTradingAdmission(),
      db: venue.db,
      backend: gateSeatOnStartClock(venue.backend, () => false),
      clock: trusted,
      cfg: venue.cfg,
      log: () => {},
      selling: { mode: () => "primary", role: () => "primary", fenced: () => false },
      clockUnconfirmed: () => false,
      clockHoldsBegun: () => 1,
      clockReleasedAt: () => null,
    });
    const look = () => definition.pass({ now: new Date(at), signal: new AbortController().signal });
    await look();
    const latest = new Date(Math.max(openedBefore, restoredAt + 30_000));
    at = Date.parse(businessDayBounds(clock, businessDayAt(clock, latest)).endAt) + MINUTE;
    await look();

    expect([unconfirmed, confirmed, after].map((bill) => fiscalRecordCount(venue, bill))).toEqual([
      0, 0, 1,
    ]);
  },
);

it("leaves a bill from before a restore that replaced no series for staff", async () => {
  venue = await provisionBillVenue(suite.db);
  const clock = await inTx(venue, (tx) => readVenueClock(tx));
  const before = await billOpenedAt(Date.now() - DAY);
  const unchanged = {
    ...fakeModule("test-regime"),
    backup: { restore: async () => ({ report: "unchanged" }) },
  };
  await runRestoreHooks({
    db: suite.db,
    nodeDb: suite.node,
    node: { nodeId: venue.cfg.nodeId },
    modules: [unchanged],
    log: () => {},
  });
  const at = Date.parse(businessDayBounds(clock, businessDayAt(clock, new Date())).endAt) + MINUTE;
  const base = systemClock();
  const definition = closeOfDayJob({
    admission: testTradingAdmission(),
    db: venue.db,
    backend: gateSeatOnStartClock(venue.backend, () => false),
    clock: { ...base, now: () => ({ ...base.now(), instant: new Date(at), offsetMinutes: 60 }) },
    cfg: venue.cfg,
    log: () => {},
    selling: { mode: () => "primary", role: () => "primary", fenced: () => false },
    clockUnconfirmed: () => false,
    clockHoldsBegun: () => 1,
    clockReleasedAt: () => null,
  });
  await definition.pass({ now: new Date(at), signal: new AbortController().signal });

  expect(fiscalRecordCount(venue, before)).toBe(0);
});
