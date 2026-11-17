import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { generateSync } from "otplib";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openBackupQuery } from "@waitron/store";
import { purposeKey, sealText } from "@waitron/credentials";
import { seedManager, TOTP_KEY_RING } from "../test/fixtures.js";
import * as identity from "./index.js";
import { verifyPassword } from "./verify-password.js";

vi.mock("./verify-password.js", async (original) => {
  const actual = await original<typeof import("./verify-password.js")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const keys = [{ version: 1, key: purposeKey(TOTP_KEY_RING.current, "totp") }];
let directory: string | undefined;
let copy: Awaited<ReturnType<typeof openBackupQuery>> | undefined;
afterEach(async () => {
  await copy?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
  copy = undefined;
  directory = undefined;
});
async function fixture(
  role: "admin" | "staff" = "admin",
  status: "active" | "pending" | "suspended" = "active",
) {
  const personId = await seedManager(suite.db, { email: "\u00c9lodie@example.test", role, status });
  await withTransaction(suite.db, (tx) =>
    tx.execute(
      sql`update persons set totp_secret = ${sealText(TOTP_KEY_RING, "totp", secret)} where id = ${personId}`,
    ),
  );
  return personId;
}
async function readCopy() {
  directory = await mkdtemp(join(tmpdir(), "locked-login-"));
  const path = join(directory, "venue.db");
  await suite.db.archiveTo(path);
  copy = await openBackupQuery(path, { immutable: true });
  vi.mocked(verifyPassword).mockClear();
  return copy.query;
}
const input = () => ({
  email: "  \u00e9LODIE@EXAMPLE.TEST ",
  password: "correct horse",
  totp: generateSync({ secret }),
  totpPurposeKeys: keys,
});
const check = () => identity.checkLockedCopyLogin;

it("authenticates a folded non-ASCII email against the immutable copy without starting a session", async () => {
  const personId = await fixture();
  const query = await readCopy();
  expect(await check()(query, input())).toEqual({ personId, recoveryCodeId: null });
  expect(verifyPassword).toHaveBeenCalledTimes(1);
  const sessions = [];
  for await (const row of query.rows("select id from dashboard_sessions")) sessions.push(row);
  expect(sessions).toEqual([]);
});
it.each([
  "unknown",
  "pending",
  "suspended",
  "no-password",
  "no-authenticator",
  "password",
  "code",
  "unreadable",
])("uses one password derivation and a generic factor refusal: %s", async (kind) => {
  const personId = await fixture(
    "admin",
    kind === "pending" || kind === "suspended" ? kind : "active",
  );
  if (kind === "no-password")
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`update persons set password_hash = null where id = ${personId}`),
    );
  if (kind === "no-authenticator" || kind === "unreadable")
    await withTransaction(suite.db, (tx) =>
      tx.execute(
        sql`update persons set totp_secret = ${kind === "unreadable" ? "v2.1.invalid.secret.text" : null} where id = ${personId}`,
      ),
    );
  const attempt = input();
  if (kind === "unknown") attempt.email = "unknown@example.test";
  if (kind === "password") attempt.password = "wrong password";
  if (kind === "code") attempt.totp = "invalid";
  await expect(check()(await readCopy(), attempt)).rejects.toMatchObject({
    code: "password.invalid",
    params: {},
  });
  expect(verifyPassword).toHaveBeenCalledTimes(1);
});
it("refuses correct factors without Box administration", async () => {
  await fixture("staff");
  await expect(check()(await readCopy(), input())).rejects.toMatchObject({
    code: "authorization.not_permitted",
    params: { permission: "node.manage" },
  });
});
it("returns an unused recovery row without consuming it, and refuses an already used one", async () => {
  const personId = await fixture();
  const code = "ABCD-0123-ABCD-0123";
  const codeHash = createHash("sha256").update(code.replaceAll("-", "")).digest("hex");
  await withTransaction(suite.db, (tx) =>
    tx.execute(
      sql`insert into recovery_codes (id, person_id, code_hash, created_at) values ('pending-recovery', ${personId}, ${codeHash}, '2026-11-17T00:00:00Z')`,
    ),
  );
  const query = await readCopy();
  expect(
    await check()(query, { ...input(), totp: "invalid", recoveryCode: code.toLowerCase() }),
  ).toEqual({ personId, recoveryCodeId: "pending-recovery" });
  const rows = [];
  for await (const row of query.rows("select used_at from recovery_codes")) rows.push(row);
  expect(rows).toEqual([{ used_at: null }]);
  await copy!.close();
  await withTransaction(suite.db, (tx) =>
    tx.execute(sql`update recovery_codes set used_at = '2026-11-17T00:00:00Z'`),
  );
  await rm(directory!, { recursive: true, force: true });
  await expect(
    check()(await readCopy(), { ...input(), totp: "invalid", recoveryCode: code }),
  ).rejects.toMatchObject({ code: "password.invalid" });
});
