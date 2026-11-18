import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction, venueCredentials } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openBackupQuery, type BackupQuery } from "@waitron/store";
import { seal } from "./cipher.js";
import { loadKeyRing } from "./keyring.js";
import { putCredential } from "./store.js";
import { resolveBackupKeyInputs } from "./backup-key-inputs.js";
import { readBackupCredential, verifyBackupCredentials } from "./backup-verification.js";

const key1 = Buffer.alloc(32, 1);
const key2 = Buffer.alloc(32, 2);
const current = {
  WAITRON_CREDENTIALS_KEY: key2.toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "2",
};
const inputs = {
  ...current,
  WAITRON_CREDENTIALS_KEY_PREVIOUS: key1.toString("base64"),
  WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
};
const email = { url: "smtp://private-sentinel@example.test" };
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function query<T>(body: (q: BackupQuery) => Promise<T>): Promise<T> {
  const file = suite.db
    .all<{ file: string }>(sql`pragma database_list`)
    .find((row) => row.file.endsWith("venue.db"))!.file;
  const opened = await openBackupQuery(file);
  try {
    return await body(opened.query);
  } finally {
    await opened.close();
  }
}
async function row(
  purpose = "email.smtp",
  plaintext = JSON.stringify(email),
  options: { key?: Buffer; version?: number; aad?: string } = {},
) {
  const sealed = seal(options.key ?? key2, Buffer.from(options.aad ?? purpose), plaintext);
  await suite.db.insert(venueCredentials).values({
    purpose,
    ...sealed,
    keyVersion: options.version ?? 2,
    updatedAt: "2026-10-20T08:00:00.000Z",
  });
}
const verify = (keys: Readonly<Record<string, string>> = inputs) =>
  query((q) => verifyBackupCredentials(q, keys));

describe("read-only backup vault authentication", () => {
  it("authenticates a current row and returns an immutable exact payload", async () => {
    await row();
    expect(await verify()).toBe("passed");
    const result = await query((q) => readBackupCredential(q, inputs, "email.smtp"));
    expect(result).toEqual(email);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("never borrows a valid key from the running process environment", async () => {
    await row();
    vi.stubEnv("WAITRON_CREDENTIALS_KEY", key2.toString("base64"));
    vi.stubEnv("WAITRON_CREDENTIALS_KEY_VERSION", "2");
    try {
      expect(await verify({})).toBe("unavailable");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("authenticates all rows including previous key versions without reseal or writes", async () => {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, loadKeyRing(inputs), {
        personId: null,
        purpose: "email.smtp",
        value: email,
      }),
    );
    await row("backup.archive", '{"accessKeyId":"A","secretAccessKey":"old-private-sentinel"}', {
      key: key1,
      version: 1,
    });
    const before = suite.db.all(sql`select * from venue_credentials order by purpose`);
    expect(await verify()).toBe("passed");
    expect(await query((q) => readBackupCredential(q, inputs, "email.smtp"))).toEqual(email);
    expect(await query((q) => readBackupCredential(q, inputs, "backup.archive"))).toEqual({
      accessKeyId: "A",
      secretAccessKey: "old-private-sentinel",
    });
    expect(suite.db.all(sql`select * from venue_credentials order by purpose`)).toEqual(before);
  });

  it("key shape alone cannot pass", async () => {
    await row();
    expect(await verify({ ...inputs, WAITRON_CREDENTIALS_KEY: key1.toString("base64") })).toBe(
      "unavailable",
    );
  });

  it.each([
    ["missing", {}],
    ["empty", { WAITRON_CREDENTIALS_KEY: "" }],
    ["bad length", { ...current, WAITRON_CREDENTIALS_KEY: "bad" }],
    [
      "incomplete previous",
      { ...current, WAITRON_CREDENTIALS_KEY_PREVIOUS: key1.toString("base64") },
    ],
    ["colliding versions", { ...inputs, WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "2" }],
  ])("missing or unusable external key is unavailable: %s", async (_label, keys) => {
    await row();
    expect(await verify(keys)).toBe("unavailable");
  });

  it("every older row must authenticate rather than only the newest/current row", async () => {
    await row();
    await row("backup.archive", '{"accessKeyId":"A","secretAccessKey":"older"}', {
      key: key1,
      version: 1,
    });
    expect(await verify()).toBe("passed");
    expect(await verify(current)).toBe("unavailable");
    suite.db.run(
      sql`update venue_credentials set auth_tag = zeroblob(16) where purpose = 'backup.archive'`,
    );
    expect(await verify()).toBe("unavailable");
  });

  it("wrong purpose AAD remains inconclusive rather than claiming corruption", async () => {
    await row("email.smtp", JSON.stringify(email), { aad: "payments.sumup" });
    expect(await verify()).toBe("unavailable");
  });

  it.each([
    "{secret-sentinel",
    "null",
    "[]",
    '"secret-sentinel"',
    "{}",
    '{"url":"smtp://x","from":"owner@example.test"}',
    '{"url":"x","from":"y","extra":"secret-sentinel"}',
    '{"url":1}',
    '{"url":""}',
  ])("authenticated malformed payload refuses: %s", async (plaintext) => {
    await row("email.smtp", plaintext);
    expect(await verify()).toBe("invalid");
    await expect(query((q) => readBackupCredential(q, inputs, "email.smtp"))).rejects.toMatchObject(
      { status: "invalid", message: "Backup credential could not be checked" },
    );
  });

  it("unknown purpose is unsupported, even with authenticated ciphertext", async () => {
    await row("future.purpose", '{"token":"private-sentinel"}');
    expect(await verify()).toBe("unsupported");
    await expect(
      query((q) => readBackupCredential(q, inputs, "future.purpose")),
    ).rejects.toMatchObject({ status: "unsupported" });
  });

  it("refuses the retired whole-archive payload", async () => {
    await row("backup.archive", '{"settings":"old-private-sentinel"}');
    expect(await verify()).toBe("invalid");
    await expect(
      query((q) => readBackupCredential(q, inputs, "backup.archive")),
    ).rejects.toMatchObject({ status: "invalid" });
  });

  it("archive credentials remain covered", async () => {
    await row("backup.archive", '{"accessKeyId":"A","secretAccessKey":"kept"}');
    expect(await verify()).toBe("passed");
    suite.db.run(sql`update venue_credentials set ciphertext = x'00'`);
    expect(await verify()).toBe("unavailable");
  });

  it("missing row is null but an undecryptable row never masquerades as absent", async () => {
    expect(await query((q) => readBackupCredential(q, {}, "email.smtp"))).toBeNull();
    await row();
    await expect(query((q) => readBackupCredential(q, {}, "email.smtp"))).rejects.toMatchObject({
      status: "unavailable",
      message: "Backup credential could not be checked",
    });
    expect(await verify()).toBe("passed");
  });

  it("all readers use later-file vault-key precedence", async () => {
    await row();
    const keys = resolveBackupKeyInputs({
      secretsEnv: Buffer.from(
        `WAITRON_CREDENTIALS_KEY=${key1.toString("base64")}\nWAITRON_CREDENTIALS_KEY_VERSION=1`,
      ),
      tradingEnv: Buffer.from("WAITRON_CREDENTIALS_KEY_VERSION=2"),
      backupEnv: Buffer.from(`WAITRON_CREDENTIALS_KEY=${key2.toString("base64")}`),
    });
    expect(await verify(keys)).toBe("passed");
    expect(await query((q) => readBackupCredential(q, keys, "email.smtp"))).toEqual(email);
  });

  it.each([
    "iv = zeroblob(5)",
    "auth_tag = zeroblob(4)",
    "ciphertext = 'not-binary'",
    "iv = 'not-binary'",
    "auth_tag = 'not-binary'",
    "purpose = ''",
    "key_version = 0",
    "key_version = 1.5",
    "key_version = 9007199254740992",
    "key_version = 'unknown'",
  ])("refuses a malformed captured envelope: %s", async (assignment) => {
    await row();
    suite.db.run(sql`pragma ignore_check_constraints = on`);
    try {
      suite.db.run(sql.raw(`update venue_credentials set ${assignment}`));
      expect(await verify()).toBe("invalid");
    } finally {
      suite.db.run(sql`pragma ignore_check_constraints = off`);
    }
  });

  it("keeps unavailable and unsupported checks ahead of authenticated invalid rows", async () => {
    await row("email.smtp", "null");
    await row("future.purpose", "{}");
    expect(await verify()).toBe("unsupported");
    await row("backup.archive", '{"accessKeyId":"A","secretAccessKey":"old"}', {
      key: key1,
      version: 1,
    });
    expect(await verify(current)).toBe("unavailable");
  });

  it("does not swallow SQL errors as a checked secret or absent credential", async () => {
    const missing = {
      rows() {
        throw new Error("fixture-query-unavailable");
      },
    } satisfies BackupQuery;
    await expect(verifyBackupCredentials(missing, inputs)).rejects.toThrow(
      "fixture-query-unavailable",
    );
    await expect(readBackupCredential(missing, inputs, "email.smtp")).rejects.toThrow(
      "fixture-query-unavailable",
    );
  });

  it("accepts a genuinely empty vault without borrowing ambient keys", async () => {
    expect(await verify({})).toBe("passed");
  });
});
