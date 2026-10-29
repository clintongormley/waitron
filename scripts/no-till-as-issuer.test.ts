import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { useVenueDb } from "../packages/db/src/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "../packages/migrations/src/index.js";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { inspectSource, inspectTables, scanTree, sourceFilesIn } from "./no-till-as-issuer.mjs";

const { sql } = createRequire(new URL("../packages/db/package.json", import.meta.url))(
  "drizzle-orm",
);

const root = join(import.meta.dirname, "..");
const command = ["register", "till"].join("-");
const action = ["re", "register"].join("-");
const retiredNames = [
  command,
  ["register", "Till"].join(""),
  ["provision", "till"].join("-"),
  ["provision", "Till"].join(""),
];
const oldSettings = [
  ...["SERIES", "TILL", "NODE", "LOCATION"].map((part) => `WAITRON_TILL_${part}_ID`),
  ["WAITRON", "LOCATION", "ID"].join("_"),
];

it("retired operation entry points stay absent", () => {
  expect(scanTree(root)).toEqual([]);
});

it.each([...retiredNames, action, ...oldSettings])("rejects the retired spelling %s", (value) => {
  expect(inspectSource("apps/server/src/example.ts", `const value = "${value}";`)).toEqual([
    `apps/server/src/example.ts: retired ${value}`,
  ]);
});

it("accepts cash-register devices, current identity settings, comments and strings in fiscal code", () => {
  for (const [file, source] of [
    ["apps/till/src/device.ts", 'const till = { formFactor: "till" };'],
    ["apps/server/src/config.ts", "const value = process.env.WAITRON_NODE_ID;"],
    ["packages/fiscal/src/receipt.ts", '// a till device\nconst node = "till";'],
  ])
    expect(inspectSource(file!, source!)).toEqual([]);
});

it.each(["fiscal", "fiscal-none", "fiscal-verifactu", "fiscal-future"])(
  "rejects fiscal identifiers in %s source and tests",
  (pkg) => {
    for (const name of ["record.ts", "record.test.ts"])
      expect(inspectSource(`packages/${pkg}/src/${name}`, "const oldTill = 1;")).toEqual([
        `packages/${pkg}/src/${name}: fiscal identifier oldTill`,
      ]);
  },
);

it("does not hide executable identifiers in the scanner itself", () => {
  for (const file of ["scripts/no-till-as-issuer.mjs", "scripts/no-till-as-issuer.test.ts"])
    expect(inspectSource(file, `function ${retiredNames[1]}() {}`)).toEqual([
      `${file}: retired ${retiredNames[1]}`,
    ]);
});

const historical = [
  "docs/superpowers/plans/example.md",
  "docs/superpowers/specs/example.md",
  "docs/operations/a679-changed-checks.md",
  "docs/developers/paper-custodian.md",
  "docs/compliance/verifactu-findings.md",
  "docs/compliance/asesor-questions.md",
  "docs/research/2026-07-20-pglite-throughput.md",
  "packages/fiscal-verifactu/drizzle/0002_registro_lose_till.sql",
];
it.each(historical)("accepts the historical record %s", (file) => {
  expect(inspectSource(file, command)).toEqual([]);
});
it("checks new live documentation and narrows old-setting exceptions to their specific settings", () => {
  expect(inspectSource("docs/operations/new.md", command)).toEqual([
    `docs/operations/new.md: retired ${command}`,
  ]);
  expect(
    inspectSource(
      "apps/server/src/till-config.test.ts",
      `expect(value).not.toHaveProperty("${oldSettings[0]}");`,
    ),
  ).toEqual([]);
  expect(inspectSource("apps/server/src/till-config.test.ts", command)).toEqual([
    `apps/server/src/till-config.test.ts: retired ${command}`,
  ]);
  expect(inspectSource("apps/server/src/new.test.ts", oldSettings[0]!)).toEqual([
    `apps/server/src/new.test.ts: retired ${oldSettings[0]}`,
  ]);
});

it("discovers new files and ignores a screenshot directory named like a test file", () => {
  const dir = mkdtempSync(join(tmpdir(), "node-issuer-scan-"));
  try {
    mkdirSync(join(dir, "packages/fiscal-new/src/failure.test.ts"), { recursive: true });
    writeFileSync(join(dir, "packages/fiscal-new/src/failure.test.ts/image.png"), "picture");
    writeFileSync(join(dir, "packages/fiscal-new/src/new.test.ts"), "const oldTill = 1;");
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules/ignored.ts"), "const oldTill = 1;");
    expect(sourceFilesIn(dir)).toEqual(["packages/fiscal-new/src/new.test.ts"]);
    expect(scanTree(dir)).toEqual([
      "packages/fiscal-new/src/new.test.ts: fiscal identifier oldTill",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const owned = ["invoice_series", "registro_sif", "cadenas"];
function tables() {
  return [
    ...owned.map((name) => ({ name, columns: ["id", "node_id"], keys: [["node_id"]] })),
    {
      name: "registros_facturacion",
      columns: ["node_id", "device_id"],
      keys: [["node_id", "secuencia"]],
    },
  ];
}
it("accepts node ownership and distinct recorded device origins", () => {
  expect(inspectTables(tables())).toEqual([]);
});
it("rejects a fiscal column named for a cash register", () => {
  const rows = tables();
  rows[3]!.columns.push("till_id");
  expect(inspectTables(rows)).toEqual(["registros_facturacion: fiscal till column till_id"]);
});
it.each(owned)("requires the node column and a node ownership key on %s", (name) => {
  const rows = tables();
  const table = rows.find((t) => t.name === name)!;
  table.columns = ["id"];
  expect(inspectTables(rows)).toEqual([`${name}: missing node_id`]);
  table.columns = ["id", "renamed_node"];
  expect(inspectTables(rows)).toEqual([`${name}: missing node_id`]);
  table.columns = ["id", "node_id"];
  table.keys = [["id"]];
  expect(inspectTables(rows)).toEqual([`${name}: missing node ownership key`]);
});
it.each(owned)("rejects a device ownership key on %s", (name) => {
  const rows = tables();
  const table = rows.find((t) => t.name === name)!;
  table.columns.push("device_id");
  table.keys.push(["device_id"]);
  expect(inspectTables(rows)).toEqual([`${name}: device ownership key`]);
});

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
it("checks the real migrated fiscal tables and node owners", () => {
  const names = new Set([
    ...ALL_MODULES.filter((module) => module.name.startsWith("fiscal")).flatMap((module) =>
      (module.classification ?? []).map((table) => table.table),
    ),
    "invoice_series",
    "sales",
    "nodes",
  ]);
  const actual = [...names].map((name) => {
    const info = suite.db.all<{ name: string; pk: number }>(
      sql`select name, pk from pragma_table_info(${name})`,
    );
    expect(info.length, name).toBeGreaterThan(0);
    const indexes = suite.db.all<{ name: string }>(
      sql`select name from pragma_index_list(${name}) where "unique" = 1`,
    );
    return {
      name,
      columns: info.map((col) => col.name),
      keys: [
        info.filter((col) => col.pk > 0).map((col) => col.name),
        ...indexes.map((index) =>
          suite.db
            .all<{ name: string }>(sql`select name from pragma_index_info(${index.name})`)
            .map((col) => col.name),
        ),
      ],
    };
  });
  expect(inspectTables(actual)).toEqual([]);
});

it("refuses an empty retired command file by its path", () => {
  const file = `apps/server/scripts/${command}.ts`;
  expect(inspectSource(file, "")).toEqual([`${file}: retired ${command}`]);
});

it("rejects private fiscal identifiers", () => {
  expect(inspectSource("packages/fiscal/src/private.ts", "class Fiscal { #till = 1; }")).toEqual([
    "packages/fiscal/src/private.ts: fiscal identifier #till",
  ]);
});

it.each(["NODE", "LOCATION"])(
  "rejects the retired %s identity setting even in legacy negative-test files",
  (part) => {
    const value = `WAITRON_TILL_${part}_ID`;
    for (const path of ["apps/server/src/config.ts", "apps/server/src/till-config.test.ts"])
      expect(inspectSource(path, `const value = "${value}";`)).toEqual([
        `${path}: retired ${value}`,
      ]);
  },
);
