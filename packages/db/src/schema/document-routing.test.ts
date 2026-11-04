import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { CHECK_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedDevice, seedNode, seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { venueLocationId } from "../venue.js";
import { invoiceSeries } from "./series.js";
import { sales } from "./sales.js";
import { pagePrinters } from "./page-printers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const now = "2026-11-04T12:00:00.000Z";

async function protocolRow(
  table: "document_delivery_requests" | "device_invoice_save_operations",
  node: string,
  epoch: string,
  key: string,
  status = "prepared",
) {
  const keyColumn = table === "document_delivery_requests" ? "request_key" : "save_id";
  const subjectColumn = table === "document_delivery_requests" ? "sale_id" : "device_id";
  const extras =
    table === "document_delivery_requests" ? sql`document` : sql`expected_revision, selection`;
  const extraValues = table === "document_delivery_requests" ? sql`'receipt'` : sql`0, '"default"'`;
  await suite.db.execute(sql`insert into ${sql.identifier(table)}
    (node_id, recovery_epoch, ${sql.identifier(keyColumn)}, ${sql.identifier(subjectColumn)}, person_id, session_id, context, canonical_intent, fingerprint, status, created_at, updated_at, ${extras})
    values (${node}, ${epoch}, ${key}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()}, '{"surface":"dashboard","deviceId":null,"profileId":null}', '{}', 'fingerprint', ${status}, ${now}, ${now}, ${extraValues})`);
}

describe("document routing schema", () => {
  it.each(["document_delivery_requests", "device_invoice_save_operations"] as const)(
    "document routing schema keeps node keys independent: %s",
    async (table) => {
      const first = randomUUID();
      const second = randomUUID();
      const epoch = randomUUID();
      const later = randomUUID();
      const key = randomUUID();
      await protocolRow(table, first, epoch, key);
      await protocolRow(table, second, epoch, key);
      await protocolRow(table, first, later, key);
      const duplicate = await captureError(() => protocolRow(table, first, epoch, key));
      expect(UNIQUE_VIOLATION).toContain((duplicate as { errcode: number }).errcode);
      const invalid = await captureError(() =>
        protocolRow(table, first, epoch, randomUUID(), "invented"),
      );
      expect(CHECK_VIOLATION).toContain((invalid as { errcode: number }).errcode);
      expect(
        suite.db.all(
          sql`select node_id, recovery_epoch from ${sql.identifier(table)} order by rowid`,
        ),
      ).toEqual([
        { node_id: first, recovery_epoch: epoch },
        { node_id: second, recovery_epoch: epoch },
        { node_id: first, recovery_epoch: later },
      ]);
      expect(suite.db.all(sql`pragma foreign_key_list(${sql.identifier(table)})`)).toEqual([]);
    },
  );

  it("bounds acceptance sequences and keeps each origin independent", async () => {
    const first = randomUUID();
    const second = randomUUID();
    const epoch = randomUUID();
    const later = randomUUID();
    for (const [node, generation] of [
      [first, epoch],
      [second, epoch],
      [first, later],
    ]) {
      await suite.db.execute(
        sql`insert into document_delivery_sequences (node_id, recovery_epoch, next_acceptance_order) values (${node}, ${generation}, 1)`,
      );
    }
    for (const bad of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const error = await captureError(() =>
        suite.db.execute(
          sql`update document_delivery_sequences set next_acceptance_order = ${bad} where node_id = ${first} and recovery_epoch = ${epoch}`,
        ),
      );
      expect(CHECK_VIOLATION).toContain((error as { errcode: number }).errcode);
    }
    await suite.db.execute(
      sql`update document_delivery_sequences set next_acceptance_order = ${Number.MAX_SAFE_INTEGER} where node_id = ${first} and recovery_epoch = ${epoch}`,
    );
    expect(
      suite.db.all(
        sql`select next_acceptance_order from document_delivery_sequences order by rowid`,
      ),
    ).toEqual([
      { next_acceptance_order: Number.MAX_SAFE_INTEGER },
      { next_acceptance_order: 1 },
      { next_acceptance_order: 1 },
    ]);
  });

  it("refuses negative fractional and unsafe device revisions", async () => {
    await seedVenue(suite.db, {
      name: "Oak Room",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
    });
    const { deviceId } = await seedDevice(suite.db);
    for (const bad of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      const error = await captureError(() =>
        suite.db.execute(
          sql`insert into device_invoice_revisions (device_id, revision) values (${deviceId}, ${bad})`,
        ),
      );
      expect(CHECK_VIOLATION).toContain((error as { errcode: number }).errcode);
    }
    await suite.db.execute(
      sql`insert into device_invoice_revisions (device_id, revision) values (${deviceId}, 0)`,
    );
    expect(suite.db.all(sql`select revision from device_invoice_revisions`)).toEqual([
      { revision: 0 },
    ]);
  });

  it("page copy audit refuses changes and preserves the referenced work", async () => {
    await seedVenue(suite.db, {
      name: "Oak Room",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
    });
    const nodeId = await seedNode(suite.db);
    const { deviceId } = await seedDevice(suite.db);
    const [series] = await suite.db.insert(invoiceSeries).values({ nodeId, code: "A" }).returning();
    const [sale] = await suite.db
      .insert(sales)
      .values({
        source: "device",
        deviceId,
        nodeId,
        seriesId: series!.id,
        invoiceNumber: 1,
        issuedAt: now,
        issuedOffsetMinutes: 0,
        total: 1450,
        vatBreakdown: [],
        locale: "es",
        invoiceLocales: ["es"],
        fiscalBackend: "none",
        fiscalState: "recorded",
      })
      .returning();
    const [printer] = await suite.db
      .insert(pagePrinters)
      .values({
        locationId: await venueLocationId(suite.db),
        name: "Office",
        host: "10.0.0.9",
        port: 631,
        resourcePath: "/print",
        documentFormat: "application/pdf",
        supportedFormats: ["application/pdf"],
        media: "iso_a4_210x297mm",
        resolutionDpi: 300,
      })
      .returning();
    const job = randomUUID();
    const audit = randomUUID();
    const person = randomUUID();
    await suite.db.execute(
      sql`insert into document_page_jobs (id, sale_id, page_printer_id, language, designation, person_id, created_at) values (${job}, ${sale!.id}, ${printer!.id}, 'es', 'duplicate', ${person}, ${now})`,
    );
    await suite.db.execute(
      sql`insert into document_page_reprints (id, sale_id, page_job_id, person_id, requested_at) values (${audit}, ${sale!.id}, ${job}, ${person}, ${now})`,
    );
    for (const statement of [
      sql`update document_page_reprints set person_id = ${randomUUID()} where id = ${audit}`,
      sql`delete from document_page_reprints where id = ${audit}`,
    ]) {
      const error = await captureError(() =>
        withTransaction(suite.db, (tx) => tx.execute(statement)),
      );
      expect(engineErrorMessage(error)).toMatch(/append.only/i);
    }
    const duplicate = await captureError(() =>
      suite.db.execute(
        sql`insert into document_page_reprints (id, sale_id, page_job_id, person_id, requested_at) values (${randomUUID()}, ${sale!.id}, ${job}, ${person}, ${now})`,
      ),
    );
    expect(UNIQUE_VIOLATION).toContain((duplicate as { errcode: number }).errcode);
    const deletion = await captureError(() =>
      suite.db.execute(sql`delete from document_page_jobs where id = ${job}`),
    );
    expect(engineErrorMessage(deletion)).toContain("FOREIGN KEY constraint failed");
    expect(
      suite.db.all(sql`select id, sale_id, page_job_id, person_id from document_page_reprints`),
    ).toEqual([{ id: audit, sale_id: sale!.id, page_job_id: job, person_id: person }]);
  });
});

it("review L6: accepted requests require a result and acceptance order together", async () => {
  const error = await captureError(() =>
    protocolRow("document_delivery_requests", randomUUID(), randomUUID(), randomUUID(), "accepted"),
  );
  expect(CHECK_VIOLATION).toContain((error as { errcode: number }).errcode);
});
it("review L6: prepared requests cannot carry accepted result or order", async () => {
  const key = randomUUID();
  await protocolRow("document_delivery_requests", randomUUID(), randomUUID(), key);
  const error = await captureError(() =>
    suite.db.execute(
      sql`update document_delivery_requests set accepted_result = '{}', acceptance_order = 1 where request_key = ${key}`,
    ),
  );
  expect(CHECK_VIOLATION).toContain((error as { errcode: number }).errcode);
});
it("review L6: an origin cannot allocate one acceptance order to two requests", async () => {
  const node = randomUUID();
  const epoch = randomUUID();
  const first = randomUUID();
  const second = randomUUID();
  await protocolRow("document_delivery_requests", node, epoch, first);
  await protocolRow("document_delivery_requests", node, epoch, second);
  await suite.db.execute(
    sql`update document_delivery_requests set status = 'accepted', accepted_result = '{}', acceptance_order = 1 where request_key = ${first}`,
  );
  const error = await captureError(() =>
    suite.db.execute(
      sql`update document_delivery_requests set status = 'accepted', accepted_result = '{}', acceptance_order = 1 where request_key = ${second}`,
    ),
  );
  expect(UNIQUE_VIOLATION).toContain((error as { errcode: number }).errcode);
  await suite.db.execute(
    sql`update document_delivery_requests set status = 'accepted', accepted_result = '{}', acceptance_order = 2 where request_key = ${second}`,
  );
  expect(
    suite.db.all(
      sql`select acceptance_order from document_delivery_requests order by acceptance_order`,
    ),
  ).toEqual([{ acceptance_order: 1 }, { acceptance_order: 2 }]);
});

it.each([
  { status: "accepted", result: null, order: 1 },
  { status: "accepted", result: "{}", order: null },
  { status: "prepared", result: "{}", order: null },
  { status: "prepared", result: null, order: 1 },
])(
  "review L6: refuses inconsistent $status result=$result order=$order",
  async ({ status, result, order }) => {
    const key = randomUUID();
    await protocolRow("document_delivery_requests", randomUUID(), randomUUID(), key);
    const error = await captureError(() =>
      suite.db.execute(
        sql`update document_delivery_requests set status = ${status}, accepted_result = ${result}, acceptance_order = ${order} where request_key = ${key}`,
      ),
    );
    expect(CHECK_VIOLATION).toContain((error as { errcode: number }).errcode);
  },
);
it("review L6: distinct origins may independently accept order one", async () => {
  const epoch = randomUUID();
  for (const node of [randomUUID(), randomUUID()]) {
    const key = randomUUID();
    await protocolRow("document_delivery_requests", node, epoch, key);
    await suite.db.execute(
      sql`update document_delivery_requests set status = 'accepted', accepted_result = '{}', acceptance_order = 1 where request_key = ${key}`,
    );
  }
  expect(suite.db.all(sql`select acceptance_order from document_delivery_requests`)).toEqual([
    { acceptance_order: 1 },
    { acceptance_order: 1 },
  ]);
});
