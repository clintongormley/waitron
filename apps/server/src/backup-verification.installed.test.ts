import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { openBackupQuery, type BackupQuery } from "@waitron/store";
import { verifyBackupArtifact } from "./backup-verification-entry.js";
import { buildBackupVerificationTarget } from "./backup-verification-target.js";
import * as placement from "./backup-data-placement.js";
import {
  logicalDatabase,
  querySnapshot,
  useBackupVerificationFixture,
  type BackupVerificationFixture,
} from "./testing/backup-verification-fixture.js";

async function consume(query: BackupQuery, statement: string) {
  const rows = [];
  for await (const row of query.rows(statement)) rows.push(row);
  return rows;
}
const suite = useBackupVerificationFixture();
afterEach(() => vi.restoreAllMocks());
async function verify(f: BackupVerificationFixture) {
  const original = await readFile(f.deps.artifactPath);
  const answer = await verifyBackupArtifact(f.request, f.deps);
  expect(logicalDatabase(f.databasePath)).toEqual(f.logical);
  expect(await readFile(f.deps.artifactPath)).toEqual(original);
  expect(await readdir(f.deps.scratchRoot)).toEqual([]);
  expect(answer.activation).toBe("not_attempted");
  return answer;
}

it("accepting control preserves every captured row through every real owner", async () => {
  const f = await suite.create();
  let comparisons = 0;
  f.deps.modules = ALL_MODULES.map((m) => {
    const owner = m.backup!.verification!;
    return {
      ...m,
      backup: {
        ...m.backup,
        verification: {
          ...owner,
          async verifyRestoredData(context) {
            expect(await querySnapshot(context.before)).toEqual(f.logical);
            expect(await querySnapshot(context.after)).toEqual(f.logical);
            comparisons++;
            return owner.verifyRestoredData(context);
          },
        },
      },
    };
  });
  const result = await verify(f);
  expect(result.status).toBe("passed");
  expect(comparisons).toBe(
    f.request.target.modules.filter((m) => f.request.archive.modules[m.name]! > 0).length,
  );
  expect(f.logical.registros_facturacion).toHaveLength(4);
  expect(f.logical.registro_sif).toHaveLength(3);
  expect(f.logical.fiscal_allocations).toHaveLength(3);
  expect(f.logical.fiscal_certificate_installs).toHaveLength(1);
  expect(f.logical.sale_lines).toHaveLength(4);
  expect(f.entries.find((e) => e.name.endsWith("hour-history.json"))).toBeDefined();
});

it("complete coverage refuses a shipped owner without semantics", async () => {
  const f = await suite.create();
  f.deps.modules = ALL_MODULES.map((m) =>
    m.name === "staffing" ? { ...m, backup: { ...m.backup, verification: undefined } } : m,
  );
  expect(await verify(f)).toMatchObject({
    status: "unsupported",
    reason: "semantics_missing",
    modules: [],
  });
});
it("strict compatibility refuses an unclaimed captured table", async () => {
  const f = await suite.create();
  await f.corrupt((db) => db.exec("create table unclaimed_verification_state (value text)"));
  expect(await verify(f)).toMatchObject({
    status: "unsupported",
    reason: "target_incompatible",
    modules: [],
  });
});
it.each(["traversal", "duplicate", "unclaimed"])("archive ownership refuses %s", async (kind) => {
  const f = await suite.create();
  const entry = f.entries.find((e) => e.name === "secrets/secrets.env")!;
  await f.seal([
    ...f.entries,
    {
      ...entry,
      name:
        kind === "traversal"
          ? "secrets/../../escape"
          : kind === "duplicate"
            ? entry.name
            : "secrets/unclaimed-value",
    },
  ]);
  const answer = await verify(f);
  expect(answer.status).toBe(kind === "unclaimed" ? "unsupported" : "invalid");
  expect(answer.modules).toEqual([]);
});
it.each([
  "secrets.env",
  "trading.env",
  "tls/ca.crt",
  "tls/ca.key",
  "tls/server.crt",
  "tls/server.key",
])("required secret check refuses damaged %s", async (name) => {
  const f = await suite.create();
  await f.seal(
    f.entries.map((e) =>
      e.name === `secrets/${name}` ? { ...e, bytes: Buffer.from("damaged-secret-material") } : e,
    ),
  );
  const answer = await verify(f);
  expect(answer.status).not.toBe("passed");
  expect(answer.modules).toEqual([]);
});
it("full fiscal walk refuses an old damaged record beside an empty current registration", async () => {
  const f = await suite.create();
  await f.corrupt((db) =>
    db.prepare("update registros_facturacion set huella=? where secuencia=1").run("0".repeat(64)),
  );
  const answer = await verify(f);
  expect(answer.status).toBe("invalid");
  expect(answer.modules.find((m) => m.name === "fiscal-verifactu")?.checks).toContainEqual({
    code: "chain",
    status: "invalid",
  });
});
it("captured head comparison refuses a sequence beyond retained records", async () => {
  const f = await suite.create();
  await f.corrupt((db) => db.prepare("update cadenas set secuencia=secuencia+1").run());
  const answer = await verify(f);
  expect(answer.status).toBe("invalid");
  expect(answer.modules.find((m) => m.name === "fiscal-verifactu")?.checks).toContainEqual({
    code: "chain",
    status: "invalid",
  });
});
it("immutable equality refuses a changed migrated invoice line", async () => {
  const f = await suite.create();
  const place = placement.placeBackupData;
  vi.spyOn(placement, "placeBackupData").mockImplementation(async (...args) => {
    await place(...args);
    const db = new DatabaseSync(join(args[1].venueDir, "venue.db"));
    try {
      const triggers = db
        .prepare(
          "select name,sql from sqlite_schema where type='trigger' and tbl_name='sale_lines'",
        )
        .all() as { name: string; sql: string }[];
      for (const t of triggers) db.exec(`drop trigger "${t.name.replaceAll('"', '""')}"`);
      db.exec("update sale_lines set name='Changed migrated meal'");
      for (const t of triggers) db.exec(t.sql);
    } finally {
      db.close();
    }
  });
  const answer = await verify(f);
  expect(answer.status).toBe("invalid");
  expect(answer.modules.find((m) => m.name === "core")?.status).toBe("invalid");
});
it("fiscal secret usability refuses a missing encrypted certificate", async () => {
  const f = await suite.create();
  await f.corrupt((db) => db.exec("delete from tenant_credentials where purpose='fiscal.aeat'"));
  expect(await verify(f)).toMatchObject({
    status: "unavailable",
    reason: "secret_unavailable",
    modules: [],
  });
});
it.each(["attach", "pragma"])(
  "read-only authorizer refuses %s with all rows preserved",
  async (kind) => {
    const f = await suite.create();
    const handle = await openBackupQuery(f.databasePath);
    try {
      const statement =
        kind === "attach" ? "attach database ':memory:' as private_copy" : "pragma query_only";
      await expect(consume(handle.query, statement)).rejects.toThrow(/not authorized/i);
    } finally {
      await handle.close();
    }
    expect(logicalDatabase(f.databasePath)).toEqual(f.logical);
  },
);
it("complete read-only barrier refuses UPDATE inside a genuine owner callback", async () => {
  const f = await suite.create();
  let denied = false;
  f.deps.modules = ALL_MODULES.map((m) => {
    if (m.name !== "core") return m;
    const owner = m.backup!.verification!;
    return {
      ...m,
      backup: {
        ...m.backup,
        verification: {
          ...owner,
          async verifyRestoredData(context) {
            const expected = await querySnapshot(context.after);
            try {
              await consume(context.after, "update invoice_series set next_number=next_number+1");
            } catch {
              denied = true;
            }
            expect(denied).toBe(true);
            expect(await querySnapshot(context.before)).toEqual(expected);
            return owner.verifyRestoredData(context);
          },
        },
      },
    };
  });
  f.request.target = buildBackupVerificationTarget(f.deps);
  const answer = await verify(f);
  expect(denied).toBe(true);
  expect(answer.status).toBe("unavailable");
});
