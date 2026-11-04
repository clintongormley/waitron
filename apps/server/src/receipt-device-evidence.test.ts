import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { provisionBillVenue } from "./testing/bill-venue.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
it("returns stored invoice evidence on a cash sale and on its replay and receipt read", async () => {
  const v = await provisionBillVenue(suite.db);
  const workingOrderId = randomUUID();
  const request = {
    workingOrderId,
    zoneId: v.zoneId,
    lines: [{ menuItemId: v.offerFor("Paella"), quantity: "1" }],
    tender: { method: "cash", amount: "35.00" },
  };
  const pay = () =>
    v.app.request("/api/sales", {
      method: "POST",
      headers: { cookie: v.cookie, "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  const first = await pay();
  expect(first.status).toBe(200);
  const original = await first.json();
  expect(original.invoiceEvidence).toEqual({
    taxpayerId: "61000002T",
    environment: "preproduction",
    series: original.invoiceNumber.slice(0, original.invoiceNumber.lastIndexOf("/")),
    invoiceNumber: original.invoiceNumber,
    issuedDate: new URL(original.qr).searchParams.get("fecha")!.split("-").reverse().join("-"),
    fingerprint: expect.stringMatching(/^[0-9A-F]{64}$/),
  });
  const replay = await pay();
  expect(replay.status).toBe(200);
  expect((await replay.json()).invoiceEvidence).toEqual(original.invoiceEvidence);
  const read = await v.app.request(`/api/sales/${workingOrderId}`, {
    headers: { cookie: v.cookie },
  });
  expect(read.status).toBe(200);
  expect((await read.json()).invoiceEvidence).toEqual(original.invoiceEvidence);
});
