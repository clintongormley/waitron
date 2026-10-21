import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { newId, nowIso, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { recordSale, recordVoid } from "@waitron/core";
import { hashPin, loginWithPin } from "@waitron/identity";
import { computeHuella, createClient } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { saleInput, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { drain, DEFAULT_SKIP_RETRY_MS } from "./drain.js";
import { decodeRegistroRow, fromRegistroRow, type RegistroRow } from "./registro-row.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const flag = "<sf:Incidencia>S</sf:Incidencia>";

it("keeps actual sale/void hashes, predecessor bytes and invoice numbers intact across outage retries", async () => {
  const { locationId, nodeId, seriesId } = await seedTenantWithSif(suite.db);
  const personId = newId();
  await suite.db.execute(sql`insert into persons (id, created_at, display_name, pin_hash, role)
    values (${personId}, ${nowIso()}, 'Manager', ${hashPin("1234")}, 'manager')`);
  const { deviceId } = await seedDevice(suite.db, { locationId });
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { deviceId, personId, pin: "1234" }),
  );
  let resolvedOnSale = 0;
  const backend = new VerifactuBackend({
    db: suite.db,
    clock: steadyClock,
    deploymentEnvironment: "production",
    resolveClient: async () => {
      resolvedOnSale++;
      throw new Error("sale contacted AEAT");
    },
  });
  const sell = () =>
    withTransaction(suite.db, (tx) => recordSale(tx, backend, saleInput({ nodeId, seriesId })));
  const sale = await sell();
  await withTransaction(suite.db, (tx) =>
    recordVoid(tx, backend, sale.saleId, "staff error", { sessionId: session.id }),
  );
  const snapshot = async () => ({
    records: (
      await suite.db.execute<Record<string, unknown>>(
        sql`select * from registros_facturacion order by secuencia`,
      )
    ).rows,
    series: (await suite.db.execute(sql`select * from invoice_series order by id`)).rows,
    chains: (await suite.db.execute(sql`select * from cadenas order by node_id`)).rows,
  });
  const original = await snapshot();
  expect(original.records.map((r) => r.tipo_registro)).toEqual(["alta", "anulacion"]);
  for (const raw of original.records) {
    const row = decodeRegistroRow<RegistroRow>(raw);
    expect(computeHuella(fromRegistroRow(row))).toBe(row.huella);
  }
  const authority = createFakeAeat({ serverNow: new Date() });
  const xml: string[] = [];
  let failed = true;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let hold = true;
  const client = createClient({
    endpoint: "https://example.test/soap",
    fetch: async (input, init) => {
      xml.push(String(init?.body));
      if (hold) {
        hold = false;
        entered();
        await gate;
      }
      if (failed) throw new Error("network down");
      return authority.fetch(input, init);
    },
  });
  const deps = {
    db: suite.db,
    resolveClient: async () => client,
    environment: "production" as const,
    skipRetryMs: DEFAULT_SKIP_RETRY_MS,
  };
  const now = new Date(Date.now() + 60_000);
  const pending = drain(deps, now);
  let afterSale: Awaited<ReturnType<typeof snapshot>>;
  try {
    await waiting;
    const another = await sell();
    expect(
      (await suite.db.execute(sql`select invoice_number from sales where id = ${another.saleId}`))
        .rows,
    ).toEqual([{ invoice_number: 2 }]);
    afterSale = await snapshot();
    expect(afterSale.records.slice(0, 2)).toEqual(original.records);
    expect(resolvedOnSale).toBe(0);
  } finally {
    release();
    await pending;
  }
  expect(await snapshot()).toEqual(afterSale!);
  failed = false;
  const recovery = await drain(deps, new Date(now.getTime() + 120_000));
  expect(recovery.recordsAccepted).toBe(1);
  expect(xml[0]).not.toContain(flag);
  expect(xml[1]).toContain(flag);
  const fragment = (body: string) => {
    const records = body.match(/<sfLR:RegistroFactura>.*?<\/sfLR:RegistroFactura>/g);
    expect(records).not.toBeNull();
    return records!;
  };
  expect(fragment(xml[1]!)).toEqual(fragment(xml[0]!));
  expect(await snapshot()).toEqual(afterSale!);
  failed = true;
  const voidFailure = await drain(deps, new Date(now.getTime() + 240_000));
  expect(voidFailure.recordsAccepted).toBe(0);
  expect(xml.at(-1)).toContain("<sf:RegistroAnulacion>");
  const voidRequest = xml.at(-1)!;
  expect(await snapshot()).toEqual(afterSale!);
  failed = false;
  const rest = await drain(deps, new Date(now.getTime() + 420_000));
  expect(rest.recordsAccepted).toBe(2);
  expect(fragment(xml.at(-1)!)).toEqual(fragment(voidRequest));
  expect(xml.at(-1)).toContain(flag);
  expect(await snapshot()).toEqual(afterSale!);
  for (const raw of afterSale!.records) {
    const row = decodeRegistroRow<RegistroRow>(raw);
    expect(computeHuella(fromRegistroRow(row))).toBe(row.huella);
  }
  expect(afterSale!.records[1]!.anterior_huella).toBe(afterSale!.records[0]!.huella);
  expect(afterSale!.records[2]!.anterior_huella).toBe(afterSale!.records[1]!.huella);
});
