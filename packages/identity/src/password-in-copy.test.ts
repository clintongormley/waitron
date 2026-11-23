import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { generateSync } from "otplib";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, liveBackupQuery, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sealText } from "@waitron/credentials";
import { refusalOf, seedManager, TOTP_KEY_RING } from "../test/fixtures.js";
import * as identity from "./index.js";
import { verifyPassword } from "./verify-password.js";

vi.mock("./verify-password.js", async (original) => {
  const actual = await original<typeof import("./verify-password.js")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const options = { permission: "node.manage", totpKeyRing: TOTP_KEY_RING } as const;

async function account(
  options: {
    role?: "admin" | "staff";
    status?: "active" | "pending" | "suspended";
    authenticator?: boolean;
  } = {},
) {
  const personId = await seedManager(suite.db, {
    email: "Élodie@example.test",
    role: options.role ?? "admin",
    status: options.status ?? "active",
  });
  if (options.authenticator)
    await withTransaction(suite.db, (tx) =>
      tx.execute(
        sql`update persons set totp_secret = ${sealText(TOTP_KEY_RING, "totp", secret)} where id = ${personId}`,
      ),
    );
  vi.mocked(verifyPassword).mockClear();
  return personId;
}
const signIn = { email: "  éLODIE@EXAMPLE.TEST ", password: "correct horse" };
const check = (input: { email: string; password: string; totp?: string }) =>
  identity.checkPasswordInCopy(liveBackupQuery(suite.db), input, options);
const refused = (reason: string) => ({ code: "password.invalid", params: {}, reason });

async function fileHashes(): Promise<Record<string, string>> {
  const [main] = suite.db.all<{ file: string }>(sql`pragma database_list`);
  const hashes: Record<string, string> = {};
  for (const path of [main!.file, `${main!.file}-wal`]) {
    const bytes = await readFile(path).catch(() => null);
    hashes[path] = bytes === null ? "absent" : createHash("sha256").update(bytes).digest("hex");
  }
  return hashes;
}

it("signs an administrator with no authenticator in by its folded address, returning its id", async () => {
  const personId = await account();
  expect(await check(signIn)).toEqual({ personId });
  expect(verifyPassword).toHaveBeenCalledTimes(1);
});

it.each([
  ["unknown address", "unknown_account"],
  ["suspended account", "suspended"],
  ["pending account", "pending"],
  ["account with no password", "no_password"],
  ["wrong password", "wrong_password"],
])("refuses a %s with password.invalid after one password check", async (kind, reason) => {
  const personId = await account({
    status:
      kind === "suspended account"
        ? "suspended"
        : kind === "pending account"
          ? "pending"
          : "active",
  });
  if (kind === "account with no password")
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`update persons set password_hash = null where id = ${personId}`),
    );
  const attempt = { ...signIn };
  if (kind === "unknown address") attempt.email = "unknown@example.test";
  if (kind === "wrong password") attempt.password = "wrong password";
  expect(await refusalOf(() => check(attempt))).toEqual(refused(reason));
  expect(verifyPassword).toHaveBeenCalledTimes(1);
});

it("asks for the authenticator code after a right password sent without one", async () => {
  await account({ authenticator: true });
  expect(await refusalOf(() => check(signIn))).toEqual({
    code: "totp.required",
    params: {},
    reason: "missing_code",
  });
});

it("signs in with the right authenticator code and refuses a wrong one", async () => {
  const personId = await account({ authenticator: true });
  expect(await check({ ...signIn, totp: generateSync({ secret }) })).toEqual({ personId });
  expect(await refusalOf(() => check({ ...signIn, totp: "000000" }))).toEqual(
    refused("wrong_code"),
  );
});

it("refuses a recovery code typed as the authenticator code", async () => {
  const personId = await account({ authenticator: true });
  const code = "ABCD-0123-ABCD-0123";
  const codeHash = createHash("sha256").update(code.replaceAll("-", "")).digest("hex");
  await withTransaction(suite.db, (tx) =>
    tx.execute(
      sql`insert into recovery_codes (id, person_id, code_hash, created_at) values ('unused-recovery', ${personId}, ${codeHash}, '2026-11-17T00:00:00Z')`,
    ),
  );
  expect(await refusalOf(() => check({ ...signIn, totp: code }))).toEqual(refused("wrong_code"));
});

it("refuses right factors without the permission", async () => {
  await account({ role: "staff" });
  expect(await refusalOf(() => check(signIn))).toEqual({
    code: "authorization.not_permitted",
    params: { permission: "node.manage" },
    reason: undefined,
  });
});

it("judges the permission the caller names, not a fixed one", async () => {
  await account({ role: "staff" });
  expect(
    await refusalOf(() =>
      identity.checkPasswordInCopy(liveBackupQuery(suite.db), signIn, {
        ...options,
        permission: "report.export",
      }),
    ),
  ).toEqual({
    code: "authorization.not_permitted",
    params: { permission: "report.export" },
    reason: undefined,
  });
});

it("leaves the database file and its write-ahead log unchanged on a sign-in and on a refusal", async () => {
  const personId = await account({ authenticator: true });
  const before = await fileHashes();
  expect(await check({ ...signIn, totp: generateSync({ secret }) })).toEqual({ personId });
  await expect(check({ ...signIn, password: "wrong password" })).rejects.toMatchObject({
    code: "password.invalid",
  });
  await expect(check(signIn)).rejects.toMatchObject({ code: "totp.required" });
  expect(await fileHashes()).toEqual(before);
});

it("refuses a right code when the stored authenticator secret cannot be opened", async () => {
  const personId = await account({ authenticator: true });
  await withTransaction(suite.db, (tx) =>
    tx.execute(
      sql`update persons set totp_secret = 'v2.1.invalid.secret.text' where id = ${personId}`,
    ),
  );
  expect(await refusalOf(() => check({ ...signIn, totp: generateSync({ secret }) }))).toEqual(
    refused("unreadable_secret"),
  );
});
