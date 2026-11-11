import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { persons, registerModulePermissions, startManagementSession } from "@waitron/identity";
import { FISCAL_PERMISSIONS } from "@waitron/fiscal-verifactu/src/permissions.js";
import { listFilingCases } from "@waitron/fiscal-verifactu/src/filing-cases.js";
import { mountRecordRemedies } from "@waitron/fiscal-verifactu/src/record-remedy-routes.js";
import { steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import {
  type Database,
  tenders,
  tenderRefunds,
  sales,
  saleSettlements,
  invoiceSeries,
  stampDeployment,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode as bareNode, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { payments, recordRefund } from "@waitron/payments";
import { getHeldOrder, listHeldOrders } from "./working-order.js";
import { ALL_MODULES } from "@waitron/composition";
import { loadKeyRing, nodeSigningPublicKey } from "@waitron/credentials";
import { endorseKey, signDocumentBody } from "@waitron/membership";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import {
  altaFor,
  seedNode,
  seedSale,
  type SeededNode,
} from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { appendToChain } from "@waitron/fiscal-verifactu/src/chain.js";
import { drain, DEFAULT_SKIP_RETRY_MS } from "@waitron/fiscal-verifactu/src/drain.js";
import {
  readReturnedOriginals,
  makeReturnedBatches,
  receiveReturnedOriginals,
  type ReturnRow,
} from "@waitron/fiscal-verifactu/src/handover-return.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { computeDailyClose, computeVatReturn, mapModelo303 } from "@waitron/reporting";
import { decimal, saleId as brandSaleId, type SaleId } from "@waitron/shared";
import { readRefundableTenders } from "./tender-refund-balance.js";
import {
  formerMainForReturn,
  runReturnRecordsPass,
  startReturnRecordsDuty,
} from "./return-records.js";
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
  await copyBase();
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
  await old.db.insert(tenders).values({
    id: "late-payment",
    saleId,
    method: "cash",
    amount: 200,
    tipAmount: 0,
    settledAt: now.toISOString(),
  });
  await current.db.insert(tenders).values({
    id: "late-payment",
    saleId,
    method: "cash",
    amount: 300,
    tipAmount: 0,
    settledAt: now.toISOString(),
  });
  expect(await send()).toBe("clash");
  expect(await withTransaction(current.db, listFilingCases)).toEqual([]);
  registerModulePermissions(FISCAL_PERMISSIONS);
  const token = await withTransaction(current.db, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Administrator", role: "admin" })
      .returning();
    const session = await startManagementSession(tx, { personId: person!.id });
    await setFreshManagementSignIn(tx, session.token);
    return session.token;
  });
  const listed = await app.request("/management-api/return-clashes", {
    headers: { cookie: `${MANAGEMENT_COOKIE}=${token}` },
  });
  expect(listed.status).toBe(200);
  const listing = (await listed.json()) as { clashes: { clashId: string; eligible: boolean }[] };
  expect(listing.clashes).toHaveLength(1);
  expect(listing.clashes[0]!.eligible).toBe(true);
  const accept = (clashId: string, actionKey: string) =>
    app.request(`/management-api/return-clashes/${clashId}/accept`, {
      method: "POST",
      headers: { cookie: `${MANAGEMENT_COOKIE}=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ actionKey, reason: "Keep the main's payment facts" }),
    });
  const acceptedClash = await accept(listing.clashes[0]!.clashId, "payment-clash");
  expect(acceptedClash.status, await acceptedClash.clone().text()).toBe(200);
  const restarted = startReturnRecordsDuty({
    db: old.db,
    node: old.node,
    ring,
    nodeId: source.nodeId,
    modules,
    log: () => {},
    fetch: async (url, init) => app.request(String(url), init),
  });
  try {
    await vi.waitFor(() => expect(restarted.state()).toBe("confirmed"));
  } finally {
    await restarted.stop();
  }
  expect(await send()).toBe("confirmed");
  expect(await withTransaction(current.db, listFilingCases)).toEqual([]);
  expect(
    current.db.all<{ amount: number }>(sql`select amount from tenders where id = 'late-payment'`),
  ).toEqual([{ amount: 300 }]);
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
  await current.db.insert(tenders).values({
    id: "later-main-tip",
    saleId,
    method: "cash",
    amount: 1,
    tipAmount: 1,
    settledAt: now.toISOString(),
  });
  expect(await send()).toBe("clash");
  const currentListing = (await (
    await app.request("/management-api/return-clashes", {
      headers: { cookie: `${MANAGEMENT_COOKIE}=${token}` },
    })
  ).json()) as { clashes: { clashId: string; eligible: boolean; accepted: boolean }[] };
  const changedClash = currentListing.clashes.find((clash) => clash.eligible && !clash.accepted)!;
  expect(changedClash).toBeDefined();
  expect(changedClash.clashId).not.toBe(listing.clashes[0]!.clashId);
  expect((await accept(changedClash.clashId, "payment-after-rejection")).status).toBe(200);
  expect(await send()).toBe("confirmed");
  expect(await withTransaction(current.db, listFilingCases)).toEqual([filingCase]);
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
  expect(correction.status, await correction.clone().text()).toBe(200);
  const corrected = (await correction.json()) as { registroId: string };
  const settled = await withTransaction(current.db, listFilingCases);
  expect(settled).toEqual([
    expect.objectContaining({
      id: filingCase!.id,
      cause: "fiscal.registro_rechazado",
      status: "resolved",
    }),
  ]);
  expect(await send()).toBe("confirmed");
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

async function copyBase() {
  await withTransaction(current.db, async (tx) => {
    for (const table of [
      "tenants",
      "locations",
      "settings",
      "day_cutover_changes",
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
}

it("counts returned VAT and settled payments without changing the new main's own day-close", async () => {
  const source = await seedNode(old.db, "Source");
  const receiver = await seedNode(old.db, "Receiver");
  const receiverId = receiver.nodeId;
  await copyBase();
  const clock = {
    businessDay: "2026-07-20",
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
    cutoverChanges: [],
  };
  const [sale] = await old.db
    .insert(sales)
    .values({
      source: "device",
      deviceId: source.deviceId,
      nodeId: source.nodeId,
      seriesId: source.seriesId,
      invoiceNumber: 1,
      issuedAt: "2026-07-20T17:20:30.000Z",
      issuedOffsetMinutes: 120,
      total: 12345,
      vatBreakdown: [{ rate: "21.00", base: "102.02", tax: "21.43" }],
      locale: "es",
      invoiceLocales: ["es"],
      fiscalBackend: "verifactu",
      fiscalState: "recorded",
    })
    .returning();
  const [ownSale] = await current.db
    .insert(sales)
    .values({
      ...sale!,
      id: "10000000-0000-4000-8000-000000000003",
      nodeId: receiverId,
      seriesId: receiver.seriesId,
      deviceId: receiver.deviceId,
    })
    .returning();
  const [ownIdentity] = current.db.all<{ nif: string; numero_instalacion: string }>(
    sql`select nif,numero_instalacion from registro_sif where id=${receiver.sifId}`,
  );
  const ownPending = altaFor(receiver, brandSaleId(ownSale!.id), 1, 1);
  ownPending.input.IDEmisorFactura = ownIdentity!.nif;
  ownPending.input.SistemaInformatico.NumeroInstalacion = ownIdentity!.numero_instalacion;
  await withTransaction(current.db, (tx) => appendToChain(tx, receiverId, ownPending));
  const ownBefore = await withTransaction(current.db, (tx) =>
    computeDailyClose(tx, { ...clock, nodeIds: [receiverId] }),
  );
  expect(ownBefore).toMatchObject({
    counts: { sales: 1, corrections: 0, voids: 0 },
    vat: { grossTotal: "123.45" },
  });
  const pending = await originalFor(old.db, source, brandSaleId(sale!.id));
  await withTransaction(old.db, async (tx) => {
    await appendToChain(tx, source.nodeId, pending);
    await tx.insert(tenders).values({
      id: "returned-tender",
      saleId: sale!.id,
      method: "cash",
      amount: 12345,
      tipAmount: 0,
      settledAt: "2026-07-20T17:21:00.000Z",
    });
    await tx.insert(saleSettlements).values({
      id: "returned-settlement",
      saleId: sale!.id,
      settledAt: "2026-07-20T17:21:00.000Z",
    });
  });
  const snapshot = await withTransaction(old.db, (tx) => readReturnedOriginals(tx, source.nodeId));
  for (const batch of makeReturnedBatches(snapshot))
    expect(
      await withTransaction(current.db, (tx) =>
        receiveReturnedOriginals(tx, source.nodeId, batch, now),
      ),
    ).toEqual({ complete: true });
  const vat = await withTransaction(current.db, (tx) =>
    computeVatReturn(tx, { year: 2026, period: { kind: "month", month: 7 } }),
  );
  expect(vat.byRate).toEqual([{ rate: "21.00", base: "204.04", tax: "42.86" }]);
  expect(mapModelo303(vat).boxes).toMatchObject({
    "07": "204.04",
    "09": "42.86",
    "27": "42.86",
    "46": "42.86",
  });
  expect(
    await withTransaction(current.db, (tx) =>
      computeDailyClose(tx, { ...clock, nodeIds: [receiverId] }),
    ),
  ).toEqual(ownBefore);
  expect(
    await withTransaction(current.db, (tx) =>
      computeDailyClose(tx, { ...clock, nodeIds: [source.nodeId] }),
    ),
  ).toMatchObject({
    counts: { sales: 1, corrections: 0, voids: 0 },
    cash: { tenderTotal: "123.45", tipTotal: "0.00" },
  });
  expect(await withTransaction(current.db, (tx) => readRefundableTenders(tx, sale!.id))).toEqual([
    {
      tenderId: "returned-tender",
      method: "cash",
      last4: null,
      appliedRemaining: "123.45",
      tipRemaining: "0.00",
      pendingRefundId: null,
      manual: false,
    },
  ]);
  const [location] = old.db.all<{ location_id: string }>(
    sql`select location_id from nodes where id = ${source.nodeId}`,
  );
  await old.db.insert(tenderRefunds).values({
    id: "returned-refund",
    saleId: sale!.id,
    tenderId: "returned-tender",
    submissionId: "returned-refund-submission",
    fingerprint: "returned-refund-fingerprint",
    appliedAmount: 12345,
    reason: "Service returned",
    authorizedBy: "manager",
    requestedBy: "operator",
    source: "device",
    deviceId: source.deviceId,
    nodeId: source.nodeId,
    method: "cash",
    state: "completed",
    createdAt: "2026-07-20T17:21:01.000Z",
    completedAt: "2026-07-20T17:21:02.000Z",
  });
  expect(await withTransaction(old.db, (tx) => readRefundableTenders(tx, sale!.id))).toEqual([]);
  const refunded = await withTransaction(old.db, (tx) => readReturnedOriginals(tx, source.nodeId));
  for (const batch of makeReturnedBatches(refunded)) {
    expect(
      await withTransaction(current.db, (tx) =>
        receiveReturnedOriginals(tx, source.nodeId, batch, now),
      ),
    ).toEqual({ complete: true });
  }
  expect(await withTransaction(current.db, (tx) => readRefundableTenders(tx, sale!.id))).toEqual(
    [],
  );
  expect(current.db.all<ReturnRow>(sql`select * from tender_refunds`)).toEqual(
    old.db.all<ReturnRow>(sql`select * from tender_refunds`),
  );
});

async function originalFor(db: Database, source: SeededNode, saleId: SaleId) {
  const [identity] = db.all<{ nif: string; numero_instalacion: string }>(
    sql`select nif, numero_instalacion from registro_sif where id = ${source.sifId}`,
  );
  const pending = altaFor(source, saleId, 1, 1);
  pending.input.IDEmisorFactura = identity!.nif;
  pending.input.SistemaInformatico.NumeroInstalacion = identity!.numero_instalacion;
  return pending;
}

async function pendingCardOriginal() {
  const source = await seedNode(old.db, "Source");
  const receiver = await seedNode(old.db, "Receiver");
  await copyBase();
  const order = await seedWorkingOrder(old.db, {
    nodeId: source.nodeId,
    status: "settled",
    settledAt: "2026-07-20T17:21:00.000Z",
  });
  const saleId = await seedSale(old.db, source, 1);
  const pending = await originalFor(old.db, source, saleId);
  await withTransaction(old.db, (tx) => appendToChain(tx, source.nodeId, pending));
  await old.db.insert(tenders).values({
    id: "pending-card-tender",
    saleId,
    method: "card",
    amount: 100,
    tipAmount: 100,
    settledAt: "2026-07-20T17:21:00.000Z",
  });
  await old.db.insert(saleSettlements).values({ saleId, settledAt: "2026-07-20T17:21:00.000Z" });
  await old.db.insert(payments).values({
    id: "original-capture",
    workingOrderId: order.id,
    source: "device",
    deviceId: source.deviceId,
    nodeId: source.nodeId,
    saleId,
    provider: "fake",
    paymentRef: "original-charge",
    externalRef: "processor-charge",
    amount: 100,
    state: "captured",
    settledAt: "2026-07-20T17:21:00.000Z",
  });
  await old.db.insert(tenderRefunds).values({
    id: "pending-card-refund",
    saleId,
    tenderId: "pending-card-tender",
    submissionId: "pending-card-submission",
    fingerprint: "pending-card-fingerprint",
    appliedAmount: 0,
    tipAmount: 100,
    reason: "Goodwill",
    authorizedBy: "manager",
    requestedBy: "operator",
    source: "device",
    deviceId: source.deviceId,
    nodeId: source.nodeId,
    method: "card",
    provider: "fake",
    providerPaymentRef: "original-charge",
    state: "pending",
    sentAt: "2026-07-20T17:21:01.000Z",
    sendCount: 1,
    createdAt: "2026-07-20T17:21:01.000Z",
  });
  const snapshot = await withTransaction(old.db, (tx) => readReturnedOriginals(tx, source.nodeId));
  for (const batch of makeReturnedBatches(snapshot))
    expect(
      await withTransaction(current.db, (tx) =>
        receiveReturnedOriginals(tx, source.nodeId, batch, now),
      ),
    ).toEqual({ complete: true });
  return { source, receiver, order };
}

it("returns a pending card refund with a settled order that cannot be reopened as a held order", async () => {
  const { order } = await pendingCardOriginal();
  expect(current.db.all<ReturnRow>(sql`select * from working_orders`)).toEqual(
    old.db.all<ReturnRow>(sql`select * from working_orders`),
  );
  expect(await listHeldOrders({ db: current.db })).toEqual([]);
  await expect(getHeldOrder({ db: current.db }, order.id)).rejects.toMatchObject({
    code: "working_order.not_found",
  });
  expect(current.db.all(sql`select * from working_order_lines`)).toEqual([]);
  for (const table of ["payments", "tender_refunds"])
    expect(current.db.all(sql`select * from ${sql.identifier(table)}`)).toEqual(
      old.db.all(sql`select * from ${sql.identifier(table)}`),
    );
  await current.db.execute(sql`update tender_refunds set state = 'completed',
    completed_at = '2026-07-20T17:22:00.000Z', last_lookup_at = '2026-07-20T17:22:00.000Z',
    provider_refund_ref = 'matched-refund', provider_status = 'completed' where id = 'pending-card-refund'`);
  await withTransaction(current.db, (tx) =>
    recordRefund(tx, {
      provider: "fake",
      paymentRef: "original-charge",
      amount: decimal("1.00"),
      providerRefundRef: "matched-refund",
    }),
  );
  const snapshot = await withTransaction(old.db, (tx) =>
    readReturnedOriginals(tx, String(order.nodeId)),
  );
  for (const batch of makeReturnedBatches(snapshot))
    expect(
      await withTransaction(current.db, (tx) =>
        receiveReturnedOriginals(tx, String(order.nodeId), batch, now),
      ),
    ).toEqual({ complete: true });
  expect(current.db.all(sql`select state, provider_refund_ref from tender_refunds`)).toEqual([
    { state: "completed", provider_refund_ref: "matched-refund" },
  ]);
});

it("adds no receiving-node sale, takings or tender totals for the returned settled-order anchor", async () => {
  const { source, receiver } = await pendingCardOriginal();
  const clock = {
    businessDay: "2026-07-20",
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
    cutoverChanges: [],
  };
  const own = await withTransaction(current.db, (tx) =>
    computeDailyClose(tx, { ...clock, nodeIds: [receiver.nodeId] }),
  );
  expect(own).toMatchObject({
    counts: { sales: 0, corrections: 0, voids: 0 },
    vat: { grossTotal: "0.00" },
    cash: { tenderTotal: "0.00", tipTotal: "0.00" },
  });
  const returned = await withTransaction(current.db, (tx) =>
    computeDailyClose(tx, { ...clock, nodeIds: [source.nodeId] }),
  );
  expect(returned).toMatchObject({
    counts: { sales: 1, corrections: 0, voids: 0 },
    cash: { tenderTotal: "1.00", tipTotal: "1.00" },
  });
});
