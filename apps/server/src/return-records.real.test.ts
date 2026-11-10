import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { persons, registerModulePermissions, startManagementSession } from "@waitron/identity";
import { FISCAL_PERMISSIONS } from "@waitron/fiscal-verifactu/src/permissions.js";
import { listFilingCases } from "@waitron/fiscal-verifactu/src/filing-cases.js";
import { mountRecordRemedies } from "@waitron/fiscal-verifactu/src/record-remedy-routes.js";
import { steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  tenders,
  invoiceSeries,
  stampDeployment,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode as bareNode } from "@waitron/db/testing/seed.js";
import { ALL_MODULES } from "@waitron/composition";
import { loadKeyRing, nodeSigningPublicKey } from "@waitron/credentials";
import { endorseKey, signDocumentBody } from "@waitron/membership";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { altaFor, seedNode, seedSale } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { appendToChain } from "@waitron/fiscal-verifactu/src/chain.js";
import { drain, DEFAULT_SKIP_RETRY_MS } from "@waitron/fiscal-verifactu/src/drain.js";
import {
  readReturnedOriginals,
  type ReturnRow,
} from "@waitron/fiscal-verifactu/src/handover-return.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { formerMainForReturn, runReturnRecordsPass } from "./return-records.js";
import { mountReturnRecordsApi } from "./return-records-api.js";

const old = useVenueDb({ migrations: TEST_MIGRATIONS });
const current = useVenueDb({ migrations: TEST_MIGRATIONS });
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 10).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const modules = ALL_MODULES.filter((module) => module.name === "fiscal-verifactu");
const now = new Date("2026-07-21T00:01:00.000Z");

it("returns a real fiscal tail between isolated boxes and files it through the receiver's normal outbox", async () => {
  const source = await seedNode(old.db, "Source");
  const receiverId = await bareNode(old.db);
  await old.db
    .insert(invoiceSeries)
    .values({ nodeId: receiverId, code: "Receiver", purpose: "standard" });
  const [identity] = old.db.all<{ nif: string; numero_instalacion: string }>(
    sql`select nif, numero_instalacion from registro_sif where id = ${source.sifId}`,
  );
  await withTransaction(old.db, (tx) =>
    seedFixtureSif(tx, {
      nodeId: receiverId,
      nif: identity!.nif,
      idSistemaInformatico: "WT",
      numeroInstalacion: "2",
    }),
  );
  await stampDeployment(old.db, "preproduction");
  await establishNodeIdentity({ ownerDb: old.db, node: old.node, ring }, source.nodeId);
  await withTransaction(current.db, async (tx) => {
    for (const table of [
      "tenants",
      "locations",
      "settings",
      "device_profiles",
      "nodes",
      "invoice_series",
      "registro_sif",
      "cadenas",
      "devices",
      "deployment",
    ]) {
      for (const row of old.db.all<ReturnRow>(sql`select * from ${sql.identifier(table)}`)) {
        const entries = Object.entries(row);
        await tx.execute(sql`insert into ${sql.identifier(table)}
          (${sql.join(
            entries.map(([key]) => sql.identifier(key)),
            sql`, `,
          )})
          values (${sql.join(
            entries.map(([, value]) => sql`${value}`),
            sql`, `,
          )})`);
      }
    }
  });
  await establishNodeIdentity({ ownerDb: current.db, node: current.node, ring }, receiverId);
  const sourceKey = await readNodeIdentityKey(old.node, ring, source.nodeId);
  const receiverKey = await readNodeIdentityKey(current.node, ring, receiverId);
  await pinMainBoxKey(current.node, receiverId, {
    nodeId: source.nodeId,
    publicKey: nodeSigningPublicKey(sourceKey),
  });
  const body = {
    term: 2,
    nodes: [
      {
        nodeId: receiverId,
        contactUrl: "https://receiver.test",
        standing: "serving-primary" as const,
      },
      { nodeId: source.nodeId, contactUrl: "https://source.test", standing: "sell-only" as const },
    ],
  };
  const chart = {
    body,
    signerNodeId: receiverId,
    signature: signDocumentBody(body, receiverKey),
    endorsements: [
      endorseKey(receiverId, nodeSigningPublicKey(receiverKey), source.nodeId, sourceKey),
    ],
  };
  await writeNodeMembership(current.db, chart);
  const saleId = await seedSale(old.db, source, 1);
  const pending = altaFor(source, saleId, 1, 1, "preproduction");
  pending.input.IDEmisorFactura = identity!.nif;
  pending.input.SistemaInformatico.NumeroInstalacion = identity!.numero_instalacion;
  pending.input.NumSerieFactura = "Source/1";
  await withTransaction(old.db, (tx) => appendToChain(tx, source.nodeId, pending));
  await writeNodeMembership(old.db, chart);
  const originals = await withTransaction(old.db, (tx) => readReturnedOriginals(tx, source.nodeId));
  const app = new Hono();
  let wakes = 0;
  mountReturnRecordsApi(
    app,
    {
      db: current.db,
      node: current.node,
      ring,
      nodeId: receiverId,
      modules,
      requireWritable: () => {},
      wake: () => {
        wakes++;
      },
      now: () => now,
    },
    () => {},
  );

  const send = () =>
    runReturnRecordsPass({
      db: old.db,
      node: old.node,
      ring,
      nodeId: source.nodeId,
      modules,
      stopped: () => false,
      fetch: async (url, init) => app.request(String(url), init),
    });
  expect(await send()).toBe("confirmed");
  expect(current.db.all<ReturnRow>(sql`select * from registros_facturacion`)).toEqual(
    originals.records,
  );
  expect(wakes).toBe(1);
  await old.db
    .insert(tenders)
    .values({
      id: "late-payment",
      saleId,
      method: "cash",
      amount: 200,
      tipAmount: 0,
      settledAt: now.toISOString(),
    });
  await current.db
    .insert(tenders)
    .values({
      id: "late-payment",
      saleId,
      method: "cash",
      amount: 300,
      tipAmount: 0,
      settledAt: now.toISOString(),
    });
  expect(await send()).toBe("clash");
  expect(await withTransaction(current.db, listFilingCases)).toEqual([]);
  const aeat = createFakeAeat({ serverNow: now, tiempoEsperaInicial: 60 });
  aeat.reject(`${identity!.nif}|Source/1|20-07-2026`, 1161, "Wrong detail");
  const filed = await drain(
    {
      db: current.db,
      resolveClient: async () => aeat.client(),
      environment: "preproduction",
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    },
    now,
  );
  expect(filed.recordsSubmitted).toBe(1);
  expect(filed.recordsAccepted).toBe(0);
  expect(filed.recordsHalted).toBe(1);

  const [filingCase] = await withTransaction(current.db, listFilingCases);
  expect(filingCase).toMatchObject({ cause: "fiscal.registro_rechazado", status: "open" });
  expect(await send()).toBe("clash");
  expect(await withTransaction(current.db, listFilingCases)).toEqual([filingCase]);
  registerModulePermissions(FISCAL_PERMISSIONS);
  const token = await withTransaction(current.db, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Administrator", role: "admin" })
      .returning();
    return (await startManagementSession(tx, { personId: person!.id })).token;
  });
  const remedies = new Hono();
  mountRecordRemedies(
    remedies,
    {
      db: current.db,
      recordGeneration: {
        nodeId: receiverId,
        environment: "preproduction",
        clock: { ...steadyClock, now: () => ({ ...steadyClock.now(), instant: now }) },
        requireWritable: () => {},
        returnSource: (tx) =>
          formerMainForReturn({ db: current.db, node: current.node, ring, nodeId: receiverId }, tx),
      },
    },
    () => {},
  );
  const correction = await remedies.request("/management-api/fiscal-records/remedy", {
    method: "POST",
    headers: { cookie: `${MANAGEMENT_COOKIE}=${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      kind: "record-correction",
      caseId: filingCase!.id,
      registroId: originals.records[0]!.id,
      actionKey: "return-correction",
      reason: "Correct the description",
      facts: { description: "Corrected restaurant service" },
    }),
  });
  expect(correction.status).toBe(200);
  const corrected = (await correction.json()) as { registroId: string };
  const settled = await withTransaction(current.db, listFilingCases);
  expect(settled).toEqual([
    expect.objectContaining({
      id: filingCase!.id,
      cause: "fiscal.registro_rechazado",
      status: "resolved",
    }),
  ]);
  expect(await send()).toBe("clash");
  expect(await withTransaction(current.db, listFilingCases)).toEqual(settled);
  expect(
    current.db.all<ReturnRow>(
      sql`select * from registros_facturacion where id = ${originals.records[0]!.id}`,
    ),
  ).toEqual(originals.records);
  expect(
    current.db.all<{
      node_id: string;
      corrects_registro_id: string;
    }>(sql`select node_id, corrects_registro_id
    from registros_facturacion where id = ${corrected.registroId}`),
  ).toEqual([{ node_id: receiverId, corrects_registro_id: originals.records[0]!.id }]);
  const nextSend = new Date(now.getTime() + 60_000);
  const accepted = createFakeAeat({ serverNow: nextSend, tiempoEsperaInicial: 60 });
  const correctionFiling = await drain(
    {
      db: current.db,
      resolveClient: async () => accepted.client(),
      environment: "preproduction",
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    },
    nextSend,
  );
  expect(correctionFiling.recordsAccepted).toBe(1);
  expect(
    current.db.all<{ estado: string; csv: string | null }>(
      sql`select estado, csv from envios where registro_id = ${corrected.registroId}`,
    ),
  ).toEqual([{ estado: "aceptado", csv: expect.any(String) }]);
});
