import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ALL_MODULES } from "@waitron/composition";
import { CORE_CONFIGURATION_TRANSFER, withTransaction } from "@waitron/db";
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

it("keeps hardware readers, slip settings and profile assignments outside configuration bundles", async () => {
  const modules = enabledModules(ALL_MODULES, venueFiscalSelection(ALL_MODULES, "GB-vat").config);
  await applyVenue(
    planVenue(
      {
        ...request,
        country: "GB",
        taxId: "123456789",

        fiscalTerritory: "GB-vat",
        timeZone: "Europe/London",
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
      payments.migrations!,
    ),
  };
  await suite.db.execute(
    sql`insert into card_readers (id, provider, provider_ref, name, prints_own_slip_automatically, created_at) values ('00000000-0000-4000-8000-000000000123', 'sumup', 'hardware-source', 'Counter', 1, '2026-10-27T12:00:00Z')`,
  );
  const readers = (await suite.db.execute(sql`select * from card_readers`)).rows;
  const exported = await exportConfigurationTables(suite.db, [payments]);
  expect(Object.keys(exported.tables)).toEqual([]);
  const bundle = { ...configurationBundle(), modules: versions, tables: exported.tables };
  await withTransaction(suite.db, (tx) =>
    importConfigurationTables(tx, bundle, [payments], versions),
  );
  expect((await suite.db.execute(sql`select * from card_readers`)).rows).toEqual(readers);
  await suite.db.execute(sql`delete from card_readers`);
  await withTransaction(suite.db, (tx) =>
    importConfigurationTables(tx, bundle, [payments], versions),
  );
  expect((await suite.db.execute(sql`select * from card_readers`)).rows).toEqual([]);

  await suite.db.run(
    sql`insert into device_profiles (id,name,form_factor,created_at,updated_at,card_readers) values ('profile','Counter','till','2026-11-01','2026-11-01','{"ids":["local-reader"],"defaultId":"local-reader"}')`,
  );
  const core = {
    ...modules.find((module) => module.name === "core")!,
    configurationTransfer: {
      kind: "tables" as const,
      tables: CORE_CONFIGURATION_TRANSFER.tables.filter((t) => t.name === "device_profiles"),
    },
  };
  const profileExport = await exportConfigurationTables(suite.db, [core]);
  const profile = profileExport.tables.device_profiles!.find((row) => row.id === "profile")!;
  expect(profile).toBeDefined();
  expect(profile).not.toHaveProperty("card_readers");
  const profileBundle = {
    ...configurationBundle(),
    modules: { core: 1 },
    tables: { device_profiles: [{ ...profile, card_readers: "{}" }] },
  };
  await expect(
    withTransaction(suite.db, (tx) =>
      importConfigurationTables(tx, profileBundle, [core], { core: 1 }),
    ),
  ).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "device_profiles.card_readers" },
  });
  await withTransaction(suite.db, (tx) =>
    importConfigurationTables(tx, { ...profileBundle, tables: profileExport.tables }, [core], {
      core: 1,
    }),
  );
  expect(
    (await suite.db.execute(sql`select card_readers from device_profiles where name='Counter'`))
      .rows,
  ).toEqual([{ card_readers: "{}" }]);
});
