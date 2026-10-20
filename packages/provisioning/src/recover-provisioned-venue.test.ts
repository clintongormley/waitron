import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ALL_MODULES } from "@waitron/composition";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { enabledModules } from "@waitron/module";
import { request } from "../test/first-setup-request.js";
import { applyVenue } from "./venue-apply.js";
import { planVenue } from "./venue-plan.js";
import { recoverProvisionedVenue } from "./recover-provisioned-venue.js";
import { venueFiscalSelection } from "./venue-fiscal.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const venue = {
  ...request,
  country: "GB",
  taxId: "123456789",
  location: { ...request.location, fiscalTerritory: "GB-vat", timeZone: "Europe/London" },
  admin: {
    displayName: "Target owner",
    email: "target@example.test",
    pinHash: "synthetic-target-pin",
    passwordHash: "synthetic-target-password",
  },
};
const modules = enabledModules(ALL_MODULES, venueFiscalSelection(ALL_MODULES, "GB-vat").config);
const refusal = { code: "setup.already_provisioned", params: {} };
async function fixture() {
  const target = await applyVenue(planVenue(venue, modules), { db: suite.db, modules });
  const admin = (
    await suite.db.execute<{ id: string }>(sql`select id from persons where role = 'admin'`)
  ).rows[0]!;
  return {
    target,
    initialOperations: {
      nodeId: target.nodeId,
      administratorId: admin.id,
      inputs: [
        {
          module: "fiscal-none",
          eventId: "synthetic-event",
          sourceId: "synthetic-source",
          input: {},
        },
      ],
    },
  };
}

it("recovers the existing location, node and all three series without allocating replacements", async () => {
  const f = await fixture();
  await withTransaction(suite.db, (tx) =>
    tx.execute(sql`update invoice_series set next_number = 47`),
  );
  const before = (await suite.db.execute(sql`select * from invoice_series order by purpose`)).rows;
  expect(
    await recoverProvisionedVenue(
      suite.db,
      { venue, initialOperations: f.initialOperations },
      ALL_MODULES,
    ),
  ).toEqual({
    locationId: f.target.locationId,
    nodeId: f.target.nodeId,
    seriesIds: f.target.seriesIds,
    seeded: [],
  });
  expect((await suite.db.execute(sql`select * from invoice_series order by purpose`)).rows).toEqual(
    before,
  );
  const defaulted = { ...venue, fullSeriesCode: undefined };
  expect(await recoverProvisionedVenue(suite.db, { venue: defaulted }, ALL_MODULES)).toEqual({
    locationId: f.target.locationId,
    nodeId: f.target.nodeId,
    seriesIds: f.target.seriesIds,
    seeded: [],
  });
});

it("refuses recovery when no matching node was committed", async () => {
  await expect(recoverProvisionedVenue(suite.db, { venue }, ALL_MODULES)).rejects.toMatchObject(
    refusal,
  );
  expect((await suite.db.execute(sql`select * from locations`)).rows).toEqual([]);
});

it.each(["malformed", "wrong-node", "missing-administrator"])(
  "refuses %s operation identity without changing the committed venue",
  async (change) => {
    const f = await fixture();
    const initialOperations =
      change === "malformed"
        ? { ...f.initialOperations, inputs: null }
        : {
            ...f.initialOperations,
            ...(change === "wrong-node"
              ? { nodeId: "00000000-0000-4000-8000-000000000000" }
              : { administratorId: "00000000-0000-4000-8000-000000000000" }),
          };
    const before = (await suite.db.execute(sql`select * from invoice_series order by purpose`))
      .rows;
    await expect(
      recoverProvisionedVenue(
        suite.db,
        { venue, initialOperations: initialOperations as never },
        ALL_MODULES,
      ),
    ).rejects.toMatchObject(refusal);
    expect(
      (await suite.db.execute(sql`select * from invoice_series order by purpose`)).rows,
    ).toEqual(before);
  },
);

it.each(["suspended", "staff"])(
  "refuses a retained administrator who is now %s",
  async (change) => {
    const f = await fixture();
    await withTransaction(suite.db, (tx) =>
      tx.execute(
        change === "staff"
          ? sql`update persons set role = 'staff' where id = ${f.initialOperations.administratorId}`
          : sql`update persons set status = 'suspended' where id = ${f.initialOperations.administratorId}`,
      ),
    );
    await expect(
      recoverProvisionedVenue(
        suite.db,
        { venue, initialOperations: f.initialOperations },
        ALL_MODULES,
      ),
    ).rejects.toMatchObject(refusal);
  },
);

it.each(["missing", "changed"])(
  "refuses %s series rather than reconstructing a partial result",
  async (change) => {
    await fixture();
    await withTransaction(suite.db, (tx) =>
      tx.execute(
        change === "missing"
          ? sql`delete from invoice_series where purpose = 'full'`
          : sql`update invoice_series set code = 'DIFFERENT' where purpose = 'full'`,
      ),
    );
    const before = (await suite.db.execute(sql`select * from invoice_series order by purpose`))
      .rows;
    await expect(recoverProvisionedVenue(suite.db, { venue }, ALL_MODULES)).rejects.toMatchObject(
      refusal,
    );
    expect(
      (await suite.db.execute(sql`select * from invoice_series order by purpose`)).rows,
    ).toEqual(before);
  },
);
