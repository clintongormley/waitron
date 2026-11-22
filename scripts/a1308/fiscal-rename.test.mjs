import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyListMap, main, renameDocument, renameSource } from "./fiscal-rename.mjs";

describe("VeriFactu name map", () => {
  it("renames exact SQL names in comments, strings and interpolated templates", () => {
    const before = [
      "// One envios row per registros_facturacion row.",
      'const table = "registros_facturacion";',
      "const query = sql`select * from envios where id = ${id} and registros_facturacion.id = ${id}`;",
      'const check = "registros_facturacion_source_ck registros_identidad_uq registros_identidad_uq_extra";',
    ].join("\n");
    const after = [
      "// One verifactu_submissions row per verifactu_records row.",
      'const table = "verifactu_records";',
      "const query = sql`select * from verifactu_submissions where id = ${id} and verifactu_records.id = ${id}`;",
      'const check = "verifactu_records_source_ck verifactu_records_identidad_uq registros_identidad_uq_extra";',
    ].join("\n");
    expect(renameSource("packages/fiscal-verifactu/src/query.ts", before)).toBe(after);
    expect(renameSource("packages/fiscal-verifactu/src/query.ts", after)).toBe(after);
  });

  it("renames a constraint in a regex and a fixture name in test prose", () => {
    const before = [
      "// This test calls seedTenants.",
      'const label = "seedTenants";',
      'const check = /"envios_estado_ck" CHECK/;',
    ].join("\n");
    const after = [
      "// This test calls seedTaxpayers.",
      'const label = "seedTaxpayers";',
      'const check = /"verifactu_submissions_estado_ck" CHECK/;',
    ].join("\n");
    expect(renameSource("packages/fiscal-verifactu/src/query.test.ts", before)).toBe(after);
  });

  it("renames the imported binding while preserving unrelated properties", () => {
    const before = [
      'import { envios } from "./schema/envios.js";',
      'db.select().from(envios).where(eq(envios.estado, "x"));',
      "const { envios: count } = summary;",
      "const row = { envios: summary.envios.aceptado };",
      "type Summary = { envios: number };",
    ].join("\n");
    const after = [
      'import { verifactuSubmissions } from "./schema/verifactu-submissions.js";',
      'db.select().from(verifactuSubmissions).where(eq(verifactuSubmissions.estado, "x"));',
      "const { envios: count } = summary;",
      "const row = { envios: summary.envios.aceptado };",
      "type Summary = { envios: number };",
    ].join("\n");
    expect(renameSource("packages/fiscal-verifactu/src/query.ts", before)).toBe(after);
  });

  it("keeps an envios variable that belongs to a summary", () => {
    const source = "const envios = countByState(rows); return { envios };";
    expect(renameSource("packages/fiscal-verifactu/src/query.ts", source)).toBe(source);
  });

  it.each([
    [
      "packages/fiscal-verifactu/src/schema/index.ts",
      'export { envios } from "./envios.js";',
      'export { verifactuSubmissions } from "./verifactu-submissions.js";',
    ],
    [
      "packages/fiscal-verifactu/src/schema/envios.ts",
      'export const envios = table("envios", fields);',
      'export const verifactuSubmissions = table("verifactu_submissions", fields);',
    ],
    [
      "apps/server/src/test.ts",
      'import { registroSif } from "@waitron/fiscal-verifactu/src/schema/sif.js";',
      'import { verifactuIdentities } from "@waitron/fiscal-verifactu/src/schema/verifactu-identities.js";',
    ],
    [
      "packages/fiscal-verifactu/src/schema/index.ts",
      'export { registroSif } from "./sif";',
      'export { verifactuIdentities } from "./verifactu-identities";',
    ],
    [
      "packages/fiscal-verifactu/src/query.ts",
      'import { envios as submissions } from "./schema/envios.js"; select(submissions);',
      'import { verifactuSubmissions as submissions } from "./schema/verifactu-submissions.js"; select(submissions);',
    ],
    [
      "packages/fiscal-verifactu/src/query.ts",
      'import { lookup as envios } from "./other.js"; select(envios);',
      'import { lookup as envios } from "./other.js"; select(envios);',
    ],
  ])("rewrites table exports and paths in %s", (path, before, after) => {
    expect(renameSource(path, before)).toBe(after);
  });

  it("recognizes the table name in a document", () => {
    expect(renameDocument('{"envios": [], "waitron_change_envios_insert": []}')).toBe(
      '{"verifactu_submissions": [], "waitron_change_envios_insert": []}',
    );
  });

  it("keeps the documented use of envios as a local variable", () => {
    const path = "docs/backlog/architecture.md";
    expect(renameDocument("including `registros` and `envios`, not the envios table", path)).toBe(
      "including `registros` and `envios`, not the verifactu_submissions table",
    );
    expect(() => renameDocument("the envios table", path)).toThrow(/keep text.*architecture/);
  });

  it("renames protection names and SQL but keeps the referenced columns and checks", () => {
    const before = {
      owningSet: { "table envios": "fiscal-verifactu" },
      schema: {
        tables: [{ name: "envios", columns: [{ name: "registro_id" }] }],
        triggers: [
          {
            name: "registros_facturacion_append_only_update",
            sql: "before update on registros_facturacion when new.id is null",
          },
        ],
      },
    };
    const after = {
      owningSet: { "table verifactu_submissions": "fiscal-verifactu" },
      schema: {
        tables: [{ name: "verifactu_submissions", columns: [{ name: "registro_id" }] }],
        triggers: [
          {
            name: "verifactu_records_append_only_update",
            sql: "before update on verifactu_records when new.id is null",
          },
        ],
      },
    };
    expect(applyListMap(before)).toEqual(after);
    expect(applyListMap(after)).toEqual(after);
  });
});

describe("fiscal rename command", () => {
  it("checks and moves tracked files, then leaves its own output alone", () => {
    const scratch = mkdtempSync(join(tmpdir(), "fiscal-rename-"));
    try {
      const baseline = "packages/fiscal-verifactu/drizzle/0000_baseline.sql";
      const source = "packages/fiscal-verifactu/src/schema/envios.ts";
      const target = "packages/fiscal-verifactu/src/schema/verifactu-submissions.ts";
      const backlog = "docs/backlog/architecture.md";
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
      );
      const git = (...args) => execFileSync("git", args, { cwd: scratch, env });
      git("init", "-q");
      for (const path of [baseline, source, backlog]) {
        mkdirSync(join(scratch, dirname(path)), { recursive: true });
      }
      copyFileSync(new URL("../../" + baseline, import.meta.url), join(scratch, baseline));
      const old = 'export const envios = table("envios", fields);';
      writeFileSync(join(scratch, source), old);
      writeFileSync(join(scratch, backlog), "including `registros` and `envios`");
      git("add", ".");
      const output = [];
      const log = (line) => output.push(line);
      expect(main(["--check"], scratch, log)).toBe(1);
      expect(readFileSync(join(scratch, source), "utf8")).toBe(old);
      expect(main([], scratch, log)).toBe(0);
      expect(readFileSync(join(scratch, target), "utf8")).toBe(
        'export const verifactuSubmissions = table("verifactu_submissions", fields);',
      );
      output.length = 0;
      expect(main(["--check"], scratch, log)).toBe(0);
      expect(output).toEqual(["nothing to change"]);
      writeFileSync(join(scratch, baseline), "");
      expect(() => main(["--check"], scratch, log)).toThrow(/baseline.*registros_facturacion/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("writes a mapped protection-list in a separate directory", () => {
    const scratch = mkdtempSync(join(tmpdir(), "fiscal-list-"));
    try {
      const input = join(scratch, "protection-list.json");
      const output = join(scratch, "mapped");
      writeFileSync(input, '{"name":"envios"}');
      expect(main(["--protection-list", scratch, output], scratch)).toBe(0);
      expect(JSON.parse(readFileSync(join(output, "protection-list.json"), "utf8"))).toEqual({
        name: "verifactu_submissions",
      });
      expect(readFileSync(input, "utf8")).toBe('{"name":"envios"}');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
