import { createCipheriv, generateKeyPairSync } from "node:crypto";
import { sql } from "drizzle-orm";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import { BackupCheckUnavailable } from "@waitron/module";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { BackupVerificationContext } from "@waitron/module";
import { validateBackupModuleResult } from "@waitron/module";
import { CORE_BACKUP_VERIFICATION } from "./core-backup-verification.js";
import { ALL_MODULES } from "./modules.js";

describe("core backup contribution", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS] });
  const withoutVault = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  const vaultKey = Buffer.alloc(32, 2).toString("base64");
  const keyEnv = `WAITRON_CREDENTIALS_KEY=${vaultKey}\nWAITRON_CREDENTIALS_KEY_VERSION=1\n`;
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const privateKey = pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");

  async function verify(
    entries: Record<string, string> = { "secrets/secrets.env": keyEnv, "secrets/trading.env": "" },
    database = suite.db,
  ) {
    const path = database
      .all<{ file: string }>(`pragma database_list`)
      .find((row) => row.file.endsWith("venue.db"))!.file;
    const db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
    const query: BackupVerificationContext["before"] = {
      async *rows(statement, values = []) {
        const prepared = db.prepare(statement);
        prepared.setReadBigInts(true);
        yield* prepared.iterate(...values);
      },
    };
    try {
      return await CORE_BACKUP_VERIFICATION.verifyRestoredData({
        before: query,
        after: query,
        entries: {
          read: async (name) => (entries[name] === undefined ? null : Buffer.from(entries[name])),
        },
        source: {
          nodeId: "source",
          locationId: "venue",
          environment: "preproduction",
          createdAt: "2026-10-20T00:00:00.000Z",
        },
        sourceSchema: 1,
        targetSchema: 1,
        signal: new AbortController().signal,
      });
    } finally {
      db.close();
    }
  }

  it("refuses absent source identity through the real registered owner", async () => {
    expect(ALL_MODULES.find((module) => module.name === "core")?.backup?.verification).toBe(
      CORE_BACKUP_VERIFICATION,
    );
    const result = await verify();
    expect(result).toEqual({
      status: "invalid",
      checks: [
        { code: "data", status: "invalid" },
        { code: "secret", status: "invalid" },
      ],
    });
    expect(validateBackupModuleResult(result, CORE_BACKUP_VERIFICATION, false)).toEqual(result);
  });

  it("returns only fixed checks for preserved bound data, leaving activation unattempted", async () => {
    suite.db.run(
      `insert into tenants (id, country, tax_id, legal_name, created_at) values (1, 'GB', 'fixture-id', 'Fixture company', '2026-10-20T00:00:00Z')`,
    );
    suite.db.run(
      `insert into locations (id, name, invoice_locales, operation_description) values ('venue', 'Fixture venue', '["en"]', 'Restaurant')`,
    );
    suite.db.run(
      `insert into nodes (id, location_id, name, created_at) values ('source', 'venue', 'Source node', '2026-10-20T00:00:00Z')`,
    );
    suite.db.run(
      `insert into deployment (id, environment, stamped_at) values (1, 'preproduction', '2026-10-20T00:00:00Z')`,
    );
    const result = await verify();
    expect(result).toEqual({
      status: "passed",
      checks: [
        { code: "data", status: "passed" },
        { code: "secret", status: "passed" },
      ],
    });
    expect(validateBackupModuleResult(result, CORE_BACKUP_VERIFICATION, false)).toEqual(result);
    expect(CORE_BACKUP_VERIFICATION.effects).toEqual([
      { id: "host_series_replacement", kind: "activation", check: null },
      { id: "host_first_start", kind: "activation", check: null },
    ]);
    expect(suite.db.all(`select * from invoice_series`)).toEqual([]);
    expect(suite.db.all(`select * from daily_close_chain`)).toEqual([]);
  });
  it("refuses preserved but broken close history through the registered core owner", async () => {
    suite.db.run(
      `insert into tenants (id, country, tax_id, legal_name, created_at) values (1, 'GB', 'fixture-id', 'Fixture company', '2026-10-20T00:00:00Z')`,
    );
    suite.db.run(
      `insert into locations (id, name, invoice_locales, operation_description) values ('venue', 'Fixture venue', '["en"]', 'Restaurant')`,
    );
    suite.db.run(
      `insert into nodes (id, location_id, name, created_at) values ('source', 'venue', 'Source node', '2026-10-20T00:00:00Z')`,
    );
    suite.db.run(
      `insert into deployment (id, environment, stamped_at) values (1, 'preproduction', '2026-10-20T00:00:00Z')`,
    );
    expect(await verify()).toEqual({
      status: "passed",
      checks: [
        { code: "data", status: "passed" },
        { code: "secret", status: "passed" },
      ],
    });
    suite.db.run(`insert into daily_closes
      (id, node_id, business_day, sequence_no, prev_entry_hash, entry_hash, closed_at, closed_by, snapshot)
      values ('close', 'source', '2026-10-19', 1, '', 'invalid', '2026-10-20T00:00:00Z', 'actor',
        '{"close":{},"cashReconciliation":{"byDevice":[],"nodeVariance":"0.00"}}')`);
    suite.db.run(`insert into daily_close_chain values ('source', 1, 'invalid')`);
    expect(await verify()).toEqual({
      status: "invalid",
      checks: [
        { code: "data", status: "invalid" },
        { code: "secret", status: "passed" },
      ],
    });
  });
  function seedIdentity(key: string | null = publicKey, database = suite.db) {
    database.run(
      `insert into tenants (id,country,tax_id,legal_name,created_at) values (1,'GB','fixture-id','Fixture company','2026-10-20T00:00:00Z')`,
    );
    database.run(
      `insert into locations (id,name,invoice_locales,operation_description) values ('venue','Fixture venue','["en"]','Restaurant')`,
    );
    database.run(
      sql`insert into nodes (id,location_id,name,public_key,created_at) values ('source','venue','Source',${key},'2026-10-20T00:00:00Z')`,
    );
    database.run(
      `insert into deployment (id,environment,stamped_at) values (1,'preproduction','2026-10-20T00:00:00Z')`,
    );
  }
  async function keepPrivate(key: string) {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, loadKeyRing({ WAITRON_CREDENTIALS_KEY: vaultKey }), {
        purpose: "membership.node_key",
        value: { privateKey: key },
      }),
    );
  }
  it("the registered core owner authenticates and matches its captured membership key", async () => {
    seedIdentity();
    await keepPrivate(privateKey);
    const rows = suite.db.all(`select * from tenant_credentials`);
    expect(await verify()).toEqual({
      status: "passed",
      checks: [
        { code: "data", status: "passed" },
        { code: "secret", status: "passed" },
      ],
    });
    expect(CORE_BACKUP_VERIFICATION.secrets).toContain("vault:membership.node_key");
    expect(suite.db.all(`select * from tenant_credentials`)).toEqual(rows);
  });
  it.each(["missing", "malformed", "unrelated"])(
    "core cannot pass a %s private half",
    async (mode) => {
      seedIdentity();
      if (mode !== "missing")
        await keepPrivate(
          mode === "malformed"
            ? "not-a-key"
            : generateKeyPairSync("ed25519")
                .privateKey.export({ format: "der", type: "pkcs8" })
                .toString("base64"),
        );
      expect(await verify()).toEqual({
        status: "invalid",
        checks: [
          { code: "data", status: "passed" },
          { code: "secret", status: "invalid" },
        ],
      });
    },
  );
  it("core refuses private material without a recorded public half", async () => {
    seedIdentity(null);
    await keepPrivate(privateKey);
    expect((await verify()).status).toBe("invalid");
  });
  it("core keeps inconclusive vault key failure unavailable", async () => {
    seedIdentity();
    await keepPrivate(privateKey);
    const entries = {
      "secrets/secrets.env": `WAITRON_CREDENTIALS_KEY=${Buffer.alloc(32, 1).toString("base64")}\n`,
      "secrets/trading.env": "",
    };
    await expect(verify(entries)).rejects.toBeInstanceOf(BackupCheckUnavailable);
    await expect(verify(entries)).rejects.toMatchObject({ reason: "decryption_unavailable" });
  });
  it.each(["secrets/secrets.env", "secrets/trading.env"])(
    "core declares and requires %s",
    async (name) => {
      seedIdentity(null);
      const entries: Record<string, string> = {
        "secrets/secrets.env": keyEnv,
        "secrets/trading.env": "",
      };
      delete entries[name];
      await expect(verify(entries)).rejects.toMatchObject({ reason: "secret_unavailable" });
    },
  );
  it("core accepts explicit keyless evidence without a captured credentials table", async () => {
    seedIdentity(null, withoutVault.db);
    expect(await verify(undefined, withoutVault.db)).toEqual({
      status: "passed",
      checks: [
        { code: "data", status: "passed" },
        { code: "secret", status: "passed" },
      ],
    });
  });
  it("core does not swallow a credential query failure as a missing private half", async () => {
    seedIdentity(null);
    suite.db.run("alter table tenant_credentials rename column ciphertext to missing_ciphertext");
    try {
      await expect(verify()).rejects.toThrow("no such column");
    } finally {
      suite.db.run("alter table tenant_credentials rename column missing_ciphertext to ciphertext");
    }
  });
  it("authenticated malformed membership payload stays a fixed invalid secret check", async () => {
    seedIdentity();
    await keepPrivate(privateKey);
    const cipher = createCipheriv("aes-256-gcm", Buffer.alloc(32, 2), Buffer.alloc(12, 3));
    cipher.setAAD(Buffer.from("membership.node_key"));
    const ciphertext = Buffer.concat([cipher.update("null"), cipher.final()]);
    suite.db.run(
      sql`update tenant_credentials set ciphertext=${ciphertext},iv=${Buffer.alloc(12, 3)},auth_tag=${cipher.getAuthTag()}`,
    );
    expect(await verify()).toEqual({
      status: "invalid",
      checks: [
        { code: "data", status: "passed" },
        { code: "secret", status: "invalid" },
      ],
    });
  });
});
