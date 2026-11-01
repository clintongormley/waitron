import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  canonicalMadridSemantics,
  readMadridSemantics,
  type CanonicalMadridSemantics,
} from "./testing/madrid-semantics.js";
import { readFile } from "node:fs/promises";
import { migrationOptionsFor, manifestSets } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { DEMO_BASELINE_FIXTURE_ROOTS } from "@waitron/country-packs/demo/testing";
import { getCountryPack } from "@waitron/country-packs";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";
import { seedDemoRestaurant } from "./seed.js";
import { CASA_DELGADO_ES } from "./testing/data.js";
import { madridWithNameChanges, type MadridNameChange } from "./testing/madrid-name-changes.js";
import {
  madridWithRenamedColumns,
  type MadridColumnRenames,
} from "./testing/madrid-renamed-columns.js";

const RENAMED_COLUMNS: MadridColumnRenames = { sale_receipt_guests: { guests: "guest_count" } };
/** Tables added after the capture; the seed writes no row to them. */
const ADDED_TABLES = [
  "adjustment_lines",
  "bill_identities",
  "bill_number_allocations",
  "fiscal_conflict_evidence",
  "order_portion_events",
  "order_portions",
  "recovery_packs",
  "sale_line_portions",
  "working_line_portions",
];
/** Tables dropped after the capture; the seed wrote no row to them. */
const REMOVED_TABLES = ["mirror_config", "node_roles"];
const byName = <T>(tables: Record<string, T>) =>
  Object.fromEntries(Object.entries(tables).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
afterEach(() => vi.useRealTimers());
for (const locale of ["en", "es"] as const) {
  it(`preserves every Madrid seed row (${locale})`, async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-08T10:00:00.000Z") });
    const before = await readMadridSemantics(suite.db);
    const venue = await createDemoVenueProvisioner(() => suite.db, {
      nifBase: 95_000_000,
      invoiceLocale: "es-ES",
      nifFormat: "calculated",
      adminPin: "5555",
    })();
    const provisioned = await readMadridSemantics(suite.db);
    await seedDemoRestaurant(suite.db, {
      venue,
      locale,
      salesDays: 0,
      departmentTradingNames: getCountryPack("ES")!.demo!.departmentTradingNames,
      dataSet: CASA_DELGADO_ES,
    });
    const seeded = await readMadridSemantics(suite.db);
    expect(seeded.tables.management_sessions!.rows).toEqual(
      provisioned.tables.management_sessions!.rows,
    );
    expect(seeded.tables.products!.rows.length).toBeGreaterThan(45);
    const canonical = {
      before: await canonicalMadridSemantics(before),
      provisioned: await canonicalMadridSemantics(provisioned),
      seeded: await canonicalMadridSemantics(seeded),
    };
    const root = DEMO_BASELINE_FIXTURE_ROOTS[CASA_DELGADO_ES.id];
    expect(root).toBeInstanceOf(URL);
    const fixtureName = `madrid-before-move.${locale}.json`;
    const text = await readFile(new URL(fixtureName, root), "utf8");
    const expected = JSON.parse(text) as Record<
      "before" | "provisioned" | "seeded",
      CanonicalMadridSemantics
    >;
    const manifest = JSON.parse(
      await readFile(new URL("madrid-before-move.manifest.json", root), "utf8"),
    ) as {
      originalMain: string;
      fixtures: Record<string, string>;
      phases: Record<string, Record<string, Record<string, number>>>;
      seedChanges: Record<
        string,
        Record<string, { added: string[]; changed: string[]; deleted: string[] }>
      >;
    };
    expect(manifest.originalMain).toBe("d5c7ccb1a7ad8c0a936f6bc7a10b98c56b463360");
    expect(createHash("sha256").update(text).digest("hex")).toBe(manifest.fixtures[fixtureName]);
    const originalChanges: Record<
      string,
      { added: string[]; changed: string[]; deleted: string[] }
    > = {};
    for (const [name, table] of Object.entries(expected.seeded.tables)) {
      const before = expected.provisioned.tables[name]!.rows;
      const after = table.rows;
      const delta = {
        added: Object.keys(after).filter((key) => !Object.hasOwn(before, key)),
        changed: Object.keys(after).filter(
          (key) =>
            Object.hasOwn(before, key) &&
            JSON.stringify(after[key]) !== JSON.stringify(before[key]),
        ),
        deleted: Object.keys(before).filter((key) => !Object.hasOwn(after, key)),
      };
      if (Object.values(delta).some((keys) => keys.length > 0)) originalChanges[name] = delta;
    }
    expect(originalChanges).toEqual(manifest.seedChanges[locale]);
    const nameChanges = JSON.parse(
      await readFile(new URL(`plain-name-changes.${locale}.json`, root), "utf8"),
    ) as MadridNameChange[];
    expected.seeded = madridWithNameChanges(expected.seeded, nameChanges);
    expected.before = madridWithRenamedColumns(expected.before, RENAMED_COLUMNS);
    expected.provisioned = madridWithRenamedColumns(expected.provisioned, RENAMED_COLUMNS);
    expected.seeded = madridWithRenamedColumns(expected.seeded, RENAMED_COLUMNS);
    const phases = structuredClone(manifest.phases[locale]!);
    for (const phase of ["before", "provisioned", "seeded"] as const) {
      for (const name of ADDED_TABLES) {
        const added = canonical[phase].tables[name];
        expect(added, `${phase}/${name}`).toBeDefined();
        expect(Object.keys(added!.rows), `${phase}/${name} rows`).toEqual([]);
        expect(expected[phase].tables[name], `${phase}/${name} in the capture`).toBeUndefined();
        expected[phase].tables[name] = structuredClone(added!);
        phases[phase]![name] = 0;
      }
      for (const name of REMOVED_TABLES) {
        const removed = expected[phase].tables[name];
        expect(removed, `${phase}/${name} in the capture`).toBeDefined();
        expect(Object.keys(removed!.rows), `${phase}/${name} captured rows`).toEqual([]);
        expect(phases[phase]![name], `${phase}/${name} captured count`).toBe(0);
        delete expected[phase].tables[name];
        delete phases[phase]![name];
      }
      expected[phase].tables = byName(expected[phase].tables);
      phases[phase] = byName(phases[phase]!);
      for (const [name, columns] of [
        ["sales", ["counterparty_identifier_type", "counterparty_identifier_country_code"]],
        ["working_orders", ["recipient_identifier_type", "recipient_identifier_country_code"]],
      ] as const) {
        expected[phase].tables[name]!.columns.push(
          ...columns.map((name) => ({ name, type: "TEXT", notnull: 0, dflt_value: null, pk: 0 })),
        );
      }
      const parties = expected[phase].tables.parties!;
      parties.columns = parties.columns.filter((column) => column.name !== "main_bill_id");
      parties.foreignKeys = parties.foreignKeys.filter((key) => key.from !== "main_bill_id");
      const chains = expected[phase].tables.workforce_chains!;
      chains.columns = chains.columns.filter((column) => column.name !== "location_id");
      chains.foreignKeys = chains.foreignKeys
        .filter((key) => key.from !== "location_id")
        .map((key, id) => ({ ...key, id }));
      expected[phase].tables.webauthn_challenges!.columns.push({
        name: "purpose",
        type: "TEXT",
        notnull: 1,
        dflt_value: null,
        pk: 0,
      });
      for (const [name, column, value] of [
        [
          "kitchen_stations",
          { name: "waits_for_pass", type: "INTEGER", notnull: 1, dflt_value: "false", pk: 0 },
          0,
        ],
        [
          "ticket_items",
          { name: "requested_at", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
          null,
        ],
        [
          "ticket_items",
          { name: "pass_controlled", type: "INTEGER", notnull: 1, dflt_value: "false", pk: 0 },
          0,
        ],
        [
          "order_groups",
          { name: "request_kind", type: "TEXT", notnull: 1, dflt_value: "'new_order'", pk: 0 },
          "new_order",
        ],
      ] as const) {
        const table = expected[phase].tables[name]!;
        table.columns.push(column);
        for (const row of Object.values(table.rows)) row[column.name] = value;
      }
      expect(Object.keys(canonical[phase].tables)).toEqual(Object.keys(expected[phase].tables));
      expect(Object.keys(canonical[phase].tables)).toEqual(Object.keys(phases[phase]!));
      for (const [name, actual] of Object.entries(canonical[phase].tables)) {
        expect(Object.keys(actual.rows).length, `${phase}/${name} row count`).toBe(
          phases[phase]![name],
        );
        expect(actual, `${phase}/${name}`).toEqual(expected[phase].tables[name]);
      }
    }
    const changes: Record<string, { added: string[]; changed: string[]; deleted: string[] }> = {};
    for (const [name, table] of Object.entries(canonical.seeded.tables)) {
      const before = canonical.provisioned.tables[name]!.rows;
      const after = table.rows;
      const delta = {
        added: Object.keys(after).filter((key) => !Object.hasOwn(before, key)),
        changed: Object.keys(after).filter(
          (key) =>
            Object.hasOwn(before, key) &&
            JSON.stringify(after[key]) !== JSON.stringify(before[key]),
        ),
        deleted: Object.keys(before).filter((key) => !Object.hasOwn(after, key)),
      };
      if (Object.values(delta).some((keys) => keys.length > 0)) changes[name] = delta;
    }
    const expectedChanges: typeof changes = {};
    for (const [name, table] of Object.entries(expected.seeded.tables)) {
      const before = expected.provisioned.tables[name]!.rows;
      const after = table.rows;
      const delta = {
        added: Object.keys(after).filter((key) => !Object.hasOwn(before, key)),
        changed: Object.keys(after).filter(
          (key) =>
            Object.hasOwn(before, key) &&
            JSON.stringify(after[key]) !== JSON.stringify(before[key]),
        ),
        deleted: Object.keys(before).filter((key) => !Object.hasOwn(after, key)),
      };
      if (Object.values(delta).some((keys) => keys.length > 0)) expectedChanges[name] = delta;
    }
    expect(changes).toEqual(expectedChanges);
  });
}
