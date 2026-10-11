import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { printJobs } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { venueFiscalSelection } from "@waitron/provisioning";
import { fromRegistroRow } from "@waitron/fiscal-verifactu";
import { decodeRegistroRow, type RegistroRow } from "@waitron/fiscal-verifactu/src/registro-row.js";
import { checkChain, computeHuella, type RegistroAlta } from "@waitron/verifactu";
import { mountLocationSettingsApi } from "./location-settings-api.js";
import { ALL_MODULES } from "./modules.js";
import { inTx, send } from "./testing/bill-venue.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import {
  collect,
  placedIssuedBill,
  provisionOrderVenue,
  type OrderVenue,
} from "./testing/order-venue.js";

const OLD_NAME = "Tarjetas SL";
const NEW_NAME = "Cobros del Puerto SL";

let venue: OrderVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
  },
});

function venueDetailsApp(): Hono {
  const app = new Hono();
  mountLocationSettingsApi(
    app,
    {
      db: venue.db,
      cfg: venue.cfg,
      fiscal: venueFiscalSelection(ALL_MODULES, "ES-common").contribution!,
    },
    () => {},
  );
  return app;
}

async function paidBill(): Promise<string> {
  const billId = await placedIssuedBill(venue, "Caña");
  expect((await collect(venue, billId, "3.00")).status).toBe(200);
  return billId;
}

async function storedRows(): Promise<RegistroRow[]> {
  const { rows } = await venue.db.execute<Record<string, unknown>>(sql`
    select * from registros_facturacion where node_id = ${venue.cfg.nodeId} order by secuencia`);
  return rows.map((row) => decodeRegistroRow<RegistroRow>(row));
}

async function reprintText(billId: string): Promise<string> {
  const answer = await send(
    venue.orders,
    venue.adminDashboard,
    "POST",
    `/management-api/orders/${billId}/reprint`,
    { printerId: venue.printerId },
  );
  expect(answer.status).toBe(202);
  const jobId = (answer.json as { jobId: string }).jobId;
  const [job] = await inTx(venue, (tx) =>
    tx.select().from(printJobs).where(eq(printJobs.id, jobId)),
  );
  return decodeTicket(job!.payload);
}

describe("renaming the taxpayer between two sales", () => {
  it("keeps each record's own name, a whole chain that verifies, and each receipt's filed name", async () => {
    const first = await paidBill();
    const renamed = await send(
      venueDetailsApp(),
      venue.adminDashboard,
      "PUT",
      "/management-api/venue-details/legal-name",
      { legalName: NEW_NAME, expected: OLD_NAME },
    );
    expect(renamed.status).toBe(200);
    const second = await paidBill();

    const rows = await storedRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.nombre_razon_emisor)).toEqual([OLD_NAME, NEW_NAME]);
    // The backend fills SistemaInformatico.NombreRazon with the taxpayer's name at record time too.
    expect(rows.map((row) => row.sistema_informatico.NombreRazon)).toEqual([OLD_NAME, NEW_NAME]);

    const records = rows.map((row) => fromRegistroRow(row));
    expect(checkChain(records)).toEqual({ scope: "complete", issues: [] });

    // checkChain recomputes each record from its own fields, so it passes whether or not the name
    // is hashed; the name's absence from the hash is shown by putting the old one back.
    const second_record = records[1] as RegistroAlta;
    expect(second_record.NombreRazonEmisor).toBe(NEW_NAME);
    expect(computeHuella({ ...second_record, NombreRazonEmisor: OLD_NAME })).toBe(rows[1]!.huella);

    // Control: the same check does fail on a hashed field.
    const tampered = [records[0]!, { ...second_record, ImporteTotal: "999.99" }];
    expect(checkChain(tampered).issues).toContainEqual(
      expect.objectContaining({ recordIndex: 1, code: "HUELLA_MISMATCH" }),
    );

    const firstReceipt = await reprintText(first);
    const secondReceipt = await reprintText(second);
    expect(firstReceipt).toContain(OLD_NAME);
    expect(firstReceipt).not.toContain(NEW_NAME);
    expect(secondReceipt).toContain(NEW_NAME);
    expect(secondReceipt).not.toContain(OLD_NAME);
  });
});
