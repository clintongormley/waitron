import { seedFixtureSif as registerSif } from "../test/sif-fixture.js";
import { generateKeyPairSync } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { deployment, invoiceSeries, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type ModuleOperationInput } from "@waitron/module";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTaxpayers, TAXPAYER_A } from "../test/fixtures.js";
import * as fiscal from "./index.js";

import { verifactuIdentities } from "./schema/verifactu-identities.js";
import { fiscalReservations } from "./schema/reservations.js";
import { fiscalAllocations } from "./schema/allocations.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperReservationForBlock,
} from "./paper-evidence.js";
import { SERIES_BASES } from "@waitron/db/testing/series-bases.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const primary = { nodeId: TAXPAYER_A.nodeId };
const standby = { nodeId: TAXPAYER_A.nodeId2 };
const bases = SERIES_BASES;
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const trust = enrolPaperCustodian(
  "standby-custodian",
  publicKey,
  paperCustodianFingerprint(publicKey),
)!;
const allocation = {
  version: 1 as const,
  allocationId: "spare-allocation-42",
  taxpayerNif: "89890001K",
  softwareId: "W1",
  environment: "preproduction" as const,
  installationIdentity: "P000042",
  series: [
    { code: "A-P000042", purpose: "standard" },
    { code: "FF-P000042", purpose: "full" },
    { code: "R-P000042", purpose: "corrective" },
    { code: "RF-P000042", purpose: "full_corrective" },
  ],
  source: "paper" as const,
  issuedAt: "2026-10-13T10:00:00.000Z",
};
function request(action = "reserve", target = standby) {
  const binding = {
    module: "fiscal-verifactu",
    action,
    eventId: "join-spare-42",
    sourceId: primary.nodeId,
    targetNodeId: target.nodeId,
  };
  const operatorId = "administrator";
  const incidentEvidence = "current-master/join-spare-42";
  const block = signPaperBlock(
    {
      version: 1,
      custodianId: "standby-custodian",
      generationId: "generation-1",
      blockId: "spare-block",
      packVersion: 1,
      recipientVenueId: "spare-venue",
      allocations: [allocation],
    },
    privateKey,
  );
  const evidence = {
    block,
    reservation: signPaperReservationForBlock(
      block,
      allocation.allocationId,
      {
        eventId: binding.eventId,
        operatorId,
        sourceId: binding.sourceId,
        targetNodeId: binding.targetNodeId,
        incidentEvidence,
        reservedAt: "2026-10-13T11:00:00.000Z",
      },
      privateKey,
    ),
  };
  const current = {
    trust,
    allocationId: allocation.allocationId,
    recipientVenueId: "spare-venue",
    generationId: "generation-1",
    blockId: "spare-block",
    incidentEvidence,
    currentRegisterConfirmed: true,
    reservationConfirmed: true,
    currentEntryState: "reserved" as const,
  };
  return { binding, operatorId, evidence, current };
}
type Request = ReturnType<typeof request>;
async function attempt<T>(
  action: string,
  run: (tx: Transaction, operation: ModuleOperationInput, held: Request) => Promise<T>,
  change: (held: Request) => void = () => {},
  target = standby,
) {
  const held = request(action, target);
  change(held);
  const preparation = fiscal.createStandbyAllocationPreparation(async (scope) => ({
    ...scope,
    evidence: held.current,
  }));
  return withOperationAuthority(held.binding, held.operatorId, (authority) =>
    preparation.prepare({ binding: held.binding, authority, input: held.evidence }, (operation) =>
      withTransaction(suite.db, (tx) => run(tx, operation, held)),
    ),
  );
}
const lifecycle = () => fiscal.ALLOCATED_FISCAL_STANDBY;
async function rows() {
  return {
    sif: await suite.db.select().from(verifactuIdentities),
    series: await suite.db.select().from(invoiceSeries),
    chains: (
      await suite.db.execute(sql`select * from verifactu_records order by node_id, secuencia`)
    ).rows,
    counters: (
      await suite.db.execute(
        sql`select name from sqlite_master where name = 'contadores_instalacion'`,
      )
    ).rows,
    allocations: await suite.db.select().from(fiscalAllocations),
    reservations: await suite.db.select().from(fiscalReservations),
  };
}
function refusal(reason: string) {
  return { code: "sif.allocation_invalid", params: { reason } };
}

beforeEach(async () => {
  await seedTaxpayers(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await withTransaction(suite.db, (tx) =>
    registerSif(tx, {
      nodeId: primary.nodeId,
      nif: allocation.taxpayerNif,
      idSistemaInformatico: allocation.softwareId,
    }),
  );
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: primary.nodeId })));
});

it("refuses a paper standby input without writing fiscal rows", async () => {
  const before = await rows();
  await expect(
    attempt("reserve", (tx, operation) => lifecycle().reserve(tx, primary, standby, operation)),
  ).rejects.toMatchObject(refusal("outside_confirmation_missing"));
  expect(await rows()).toEqual(before);
});

it.each(["reserve", "establish"])("refuses %s without a fresh scoped authority", async (action) => {
  const held = request(action);
  await expect(
    withTransaction(suite.db, async (tx) => {
      if (action === "reserve") await lifecycle().reserve(tx, primary, standby);
      else await lifecycle().establish(tx, standby, { version: 1, evidence: held.evidence });
    }),
  ).rejects.toMatchObject(refusal("reauthentication_required"));
  expect((await rows()).reservations).toEqual([]);
});

it.each(["reserve", "establish"])("refuses %s after its scoped authority ends", async (action) => {
  let captured: ModuleOperationInput;
  await attempt(action, async (_tx, operation) => {
    captured = operation;
  });
  await expect(
    withTransaction(suite.db, async (tx) => {
      if (action === "reserve") await lifecycle().reserve(tx, primary, standby, captured);
      else
        await lifecycle().establish(
          tx,
          standby,
          { version: 1, evidence: request(action).evidence },
          captured,
        );
    }),
  ).rejects.toMatchObject(refusal("reauthentication_required"));
});

it("rejects reservation without a named target node", async () => {
  await expect(
    attempt("reserve", (tx, operation) => lifecycle().reserve(tx, primary, undefined, operation)),
  ).rejects.toMatchObject(refusal("node_mismatch"));
});
