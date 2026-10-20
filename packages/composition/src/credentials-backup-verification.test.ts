import { createCipheriv } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openBackupQuery } from "@waitron/store";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import {
  BackupCheckUnavailable,
  validateBackupModuleResult,
  validateBackupVerificationContribution,
  type BackupVerificationContext,
} from "@waitron/module";
import { CREDENTIALS_BACKUP_VERIFICATION } from "./credentials-backup-verification.js";
import { ALL_MODULES } from "./modules.js";

const before = useVenueDb({ migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS] });
const after = useVenueDb({ migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS] });
const env = `WAITRON_CREDENTIALS_KEY=${Buffer.alloc(32, 2).toString("base64")}\nWAITRON_CREDENTIALS_KEY_VERSION=2\n`;
const payload = { url: "smtp://secret-sentinel@example.test", from: "sender@example.test" };
beforeEach(async () => {
  for (const suite of [before, after]) {
    await withTransaction(suite.db, (tx) =>
      putCredential(
        tx,
        loadKeyRing({
          WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 2).toString("base64"),
          WAITRON_CREDENTIALS_KEY_VERSION: "2",
        }),
        { purpose: "email.smtp", value: payload },
      ),
    );
  }
  const row = before.db.all<{
    ciphertext: Uint8Array;
    iv: Uint8Array;
    auth_tag: Uint8Array;
    updated_at: string;
  }>(sql`select * from tenant_credentials`)[0]!;
  after.db.run(
    sql`update tenant_credentials set ciphertext=${row.ciphertext},iv=${row.iv},auth_tag=${row.auth_tag},updated_at=${row.updated_at}`,
  );
});
async function run(
  entries: Record<string, string> = { "secrets/secrets.env": env, "secrets/trading.env": "" },
) {
  const path = (s: typeof before) =>
    s.db.all<{ file: string }>(sql`pragma database_list`).find((r) => r.file.endsWith("venue.db"))!
      .file;
  const a = await openBackupQuery(path(before));
  try {
    const b = await openBackupQuery(path(after));
    try {
      const context: BackupVerificationContext = {
        before: a.query,
        after: b.query,
        entries: {
          async read(name) {
            return entries[name] === undefined ? null : Buffer.from(entries[name]);
          },
        },
        source: {
          nodeId: "node-one",
          locationId: "location-one",
          environment: "preproduction",
          createdAt: "2026-10-20T08:00:00.000Z",
        },
        sourceSchema: 1,
        targetSchema: 1,
        signal: new AbortController().signal,
      };
      return await CREDENTIALS_BACKUP_VERIFICATION.verifyRestoredData(context);
    } finally {
      await b.close();
    }
  } finally {
    await a.close();
  }
}

describe("credentials backup owner", () => {
  it("registers a complete owner whose success contains no secret output", async () => {
    const owner = validateBackupVerificationContribution(CREDENTIALS_BACKUP_VERIFICATION);
    const result = await run();
    expect(validateBackupModuleResult(result, owner, false)).toEqual({
      status: "passed",
      checks: [
        { code: "data", status: "passed" },
        { code: "secret", status: "passed" },
      ],
    });
    expect(ALL_MODULES.find((m) => m.name === "credentials")?.backup?.verification).toBe(
      CREDENTIALS_BACKUP_VERIFICATION,
    );
    expect(owner.secrets).toContain("vault:sync.mirror_token");
    expect(owner.entries).toEqual([
      { name: "secrets/secrets.env", presence: "required" },
      { name: "secrets/trading.env", presence: "required" },
      { name: "secrets/backup.env", presence: "optional" },
    ]);
  });
  it("refuses same-count row changes even when the new ciphertext decrypts", async () => {
    after.db.run(sql`update tenant_credentials set updated_at='2026-10-21T00:00:00.000Z'`);
    expect(await run()).toEqual({
      status: "invalid",
      checks: [
        { code: "data", status: "invalid" },
        { code: "secret", status: "passed" },
      ],
    });
  });
  it.each(["secrets/secrets.env", "secrets/trading.env"])(
    "missing private input stays unavailable: %s",
    async (name) => {
      const entries: Record<string, string> = {
        "secrets/secrets.env": env,
        "secrets/trading.env": "",
      };
      delete entries[name];
      await expect(run(entries)).rejects.toBeInstanceOf(BackupCheckUnavailable);
      await expect(run(entries)).rejects.toMatchObject({ reason: "secret_unavailable" });
    },
  );
  it("does not turn an uncertain authenticated-decryption failure into archive corruption", async () => {
    for (const s of [before, after])
      s.db.run(sql`update tenant_credentials set auth_tag=zeroblob(16)`);
    await expect(run()).rejects.toMatchObject({ reason: "decryption_unavailable" });
  });
  it("uses the optional later env file rather than ambient inputs", async () => {
    const wrong = `WAITRON_CREDENTIALS_KEY=${Buffer.alloc(32, 1).toString("base64")}\nWAITRON_CREDENTIALS_KEY_VERSION=2`;
    const entries = {
      "secrets/secrets.env": wrong,
      "secrets/trading.env": "",
      "secrets/backup.env": env,
    };
    expect((await run(entries)).status).toBe("passed");
  });
  it.each(["before", "after", "both"])(
    "refuses authenticated malformed payloads in %s",
    async (side) => {
      const cipher = createCipheriv("aes-256-gcm", Buffer.alloc(32, 2), Buffer.alloc(12, 3));
      cipher.setAAD(Buffer.from("email.smtp"));
      const ciphertext = Buffer.concat([cipher.update("null"), cipher.final()]);
      const tag = cipher.getAuthTag();
      for (const suite of side === "before"
        ? [before]
        : side === "after"
          ? [after]
          : [before, after]) {
        suite.db.run(
          sql`update tenant_credentials set ciphertext=${ciphertext}, iv=${Buffer.alloc(12, 3)}, auth_tag=${tag}`,
        );
      }
      expect(await run()).toEqual({
        status: "invalid",
        checks: [
          { code: "data", status: side === "both" ? "passed" : "invalid" },
          { code: "secret", status: "invalid" },
        ],
      });
    },
  );

  it("does not claim a known owner policy for an unknown captured purpose", async () => {
    for (const s of [before, after])
      s.db.run(sql`update tenant_credentials set purpose='future.purpose'`);
    expect(await run()).toEqual({
      status: "unsupported",
      checks: [
        { code: "data", status: "passed" },
        { code: "secret", status: "unsupported" },
      ],
    });
  });
});
