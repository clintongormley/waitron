import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ALL_MODULES } from "@waitron/composition";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor, appliedSchemaVersion } from "@waitron/migrations";
import { enabledModules } from "@waitron/module";
import { configurationBundle } from "../test/configuration-bundle.js";
import { request } from "../test/first-setup-request.js";
import { planVenue } from "./venue-plan.js";
import { applyVenue } from "./venue-apply.js";
import { venueFiscalSelection } from "./venue-fiscal.js";
import { exportConfigurationTables, importConfigurationTables } from "./configuration-transfer.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

it("keeps hardware readers and their slip settings outside configuration bundles while payment policy round-trips", async () => {
  const modules = enabledModules(ALL_MODULES, venueFiscalSelection(ALL_MODULES, "GB-vat").config);
  const target = await applyVenue(
    planVenue(
      {
        ...request,
        country: "GB",
        taxId: "123456789",
        location: { ...request.location, fiscalTerritory: "GB-vat", timeZone: "Europe/London" },
        admin: {
          displayName: "Owner",
          email: "owner@example.test",
          pinHash: "synthetic-pin",
          passwordHash: "synthetic-password",
        },
      },
      modules,
    ),
    { db: suite.db, modules },
  );
  const payments = modules.find((module) => module.name === "payments")!;
  const versions = {
    payments: await appliedSchemaVersion(
      { venue: suite.db, node: suite.node },
      payments.migrations,
    ),
  };
  await suite.db.execute(
    sql`insert into card_readers (id, provider, provider_ref, name, prints_own_slip_automatically, created_at) values ('00000000-0000-4000-8000-000000000123', 'sumup', 'hardware-source', 'Counter', 1, '2026-10-27T12:00:00Z')`,
  );
  await suite.db.execute(
    sql`insert into payment_policy (offline_mode, offline_amount_cap, created_at, updated_at) values ('accept_offline', 2500, '2026-10-27T12:00:00Z', '2026-10-27T12:00:00Z')`,
  );
  const readers = (await suite.db.execute(sql`select * from card_readers`)).rows;
  const exported = await exportConfigurationTables(suite.db, [payments]);
  expect(Object.keys(exported.tables)).toEqual(["payment_policy"]);
  expect(exported.tables.payment_policy).toHaveLength(1);
  const bundle = { ...configurationBundle(), modules: versions, tables: exported.tables };
  const policy = await suite.db.execute(sql`select * from payment_policy`);
  await suite.db.execute(
    sql`update payment_policy set offline_mode = 'cash_only', offline_amount_cap = 123`,
  );
  await withTransaction(suite.db, (tx) =>
    importConfigurationTables(tx, bundle, target, [payments], versions),
  );
  expect((await suite.db.execute(sql`select * from payment_policy`)).rows).toEqual(policy.rows);
  expect((await suite.db.execute(sql`select * from card_readers`)).rows).toEqual(readers);
  await suite.db.execute(sql`delete from card_readers`);
  await withTransaction(suite.db, (tx) =>
    importConfigurationTables(tx, bundle, target, [payments], versions),
  );
  expect((await suite.db.execute(sql`select * from card_readers`)).rows).toEqual([]);
});
