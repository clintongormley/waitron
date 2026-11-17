import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateSync } from "otplib";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openText, sealText, encodeKeyRing, keyRingEnv, type KeyRing } from "@waitron/credentials";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { openFreshManagementSession } from "../test/fixtures.js";
import { beginOwnTotpEnrollment, finishOwnTotpEnrollment } from "./profile.js";
import { loginManagerById } from "./manager-login.js";
import { issueAccountAction, confirmEmailChangeByCode } from "./account-action.js";
import * as identity from "./index.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
let commandDir: string | undefined;
let command: string;
beforeAll(async () => {
  commandDir = await mkdtemp(join(tmpdir(), "identity-command-"));
  command = join(commandDir, "credentials.mjs");
  await promisify(execFile)(
    process.execPath,
    ["../../scripts/bundle-node.mjs", `src/credentials-bin.ts=${command}`],
    { timeout: 30_000 },
  );
});
afterAll(async () => {
  if (commandDir !== undefined) await rm(commandDir, { recursive: true, force: true });
});

const first: KeyRing = { current: { version: 1, key: Buffer.alloc(32, 31) } };
const next: KeyRing = {
  current: { version: 2, key: Buffer.alloc(32, 32) },
  previous: first.current,
};
const nextOnly: KeyRing = { current: next.current };
const run = <T>(fn: Parameters<typeof withTransaction<T>>[1]) => withTransaction(suite.db, fn);
async function enrollment() {
  const session = await openFreshManagementSession(suite.db);
  const owner = { personId: session.personId, managementSessionId: session.token };
  const pending = await run((tx) => beginOwnTotpEnrollment(tx, { ...owner, keyRing: first }));
  return { owner, pending };
}
async function rotate() {
  const file = suite.db
    .all<{ file: string }>(sql`pragma database_list`)
    .find((row) => row.file.endsWith("venue.db"))!.file;
  const result = await promisify(execFile)(process.execPath, [command, "rotate"], {
    env: { ...process.env, ...keyRingEnv(encodeKeyRing(next)), WAITRON_VENUE_DIR: dirname(file) },
    timeout: 30_000,
  });
  expect(result.stderr).toBe("");
  expect(result.stdout).toMatch(/^rotated \d+, already current \d+, unopened 0\n$/);
}
async function emailCode() {
  const { personId } = await openFreshManagementSession(suite.db);
  await run((tx) =>
    tx.execute(
      sql`update persons set pending_email='new@example.test', pending_email_folded='new@example.test' where id=${personId}`,
    ),
  );
  const action = await run((tx) =>
    issueAccountAction(tx, { personId, purpose: "email_change", keyRing: first }),
  );
  expect(action.code).toMatch(/^\d{6}$/);
  return { personId, code: action.code! };
}

describe("vault key change, measurement 7", () => {
  it("a person enrolled before a vault key change signs in with their authenticator after it", async () => {
    const { owner, pending } = await enrollment();
    await run((tx) =>
      finishOwnTotpEnrollment(tx, {
        ...owner,
        enrollmentId: pending.enrollmentId,
        code: generateSync({ secret: pending.secret }),
        keyRing: first,
      }),
    );
    await rotate();
    await expect(
      run((tx) =>
        loginManagerById(tx, {
          personId: owner.personId,
          password: "correct horse",
          totp: generateSync({ secret: pending.secret }),
          totpKeyRing: nextOnly,
        }),
      ),
    ).resolves.toMatchObject({ personId: owner.personId });
    expect(
      suite.db.get<{ totp_secret: string }>(
        sql`select totp_secret from persons where id=${owner.personId}`,
      )!.totp_secret,
    ).toMatch(/^v2\.2\./);
  });
  it("a code emailed before a vault key change works inside its ten minutes", async () => {
    const code = await emailCode();
    await expect(
      run((tx) => confirmEmailChangeByCode(tx, { ...code, keyRing: next })),
    ).resolves.toBe("new@example.test");
  });
  it("that code is refused once the previous key is gone", async () => {
    const code = await emailCode();
    expect(
      await run((tx) => confirmEmailChangeByCode(tx, { ...code, keyRing: nextOnly })),
    ).toBeNull();
    expect(
      suite.db.get(
        sql`select code_attempts, used_at from account_actions where person_id=${code.personId}`,
      ),
    ).toEqual({ code_attempts: 1, used_at: null });
  });
  it("a pending two-step setup started before the change can be confirmed after it", async () => {
    const { owner, pending } = await enrollment();
    await rotate();
    await expect(
      run((tx) =>
        finishOwnTotpEnrollment(tx, {
          ...owner,
          enrollmentId: pending.enrollmentId,
          code: generateSync({ secret: pending.secret }),
          keyRing: nextOnly,
        }),
      ),
    ).resolves.toMatchObject({ codes: expect.any(Array) });
  });
  it("rotation does not overwrite a two-step setup made while it ran", async () => {
    const { owner, pending } = await enrollment();
    await run((tx) =>
      finishOwnTotpEnrollment(tx, {
        ...owner,
        enrollmentId: pending.enrollmentId,
        code: generateSync({ secret: pending.secret }),
        keyRing: first,
      }),
    );
    const fresh = sealText(nextOnly, "totp", "JBSWY3DPEHPK3PXP");
    const original = suite.db.withWriteLock.bind(suite.db);
    const gate = vi.spyOn(suite.db, "withWriteLock").mockImplementationOnce(async (fn) => {
      gate.mockRestore();
      await run((tx) =>
        tx.execute(sql`update persons set totp_secret=${fresh} where id=${owner.personId}`),
      );
      return original(fn);
    });
    try {
      await identity.resealTwoStepSecrets(suite.db, next);
    } finally {
      gate.mockRestore();
    }
    const stored = suite.db.get<{ totp_secret: string }>(
      sql`select totp_secret from persons where id=${owner.personId}`,
    )!.totp_secret;
    expect(stored).toBe(fresh);
    expect(openText(nextOnly, "totp", stored)?.value).toBe("JBSWY3DPEHPK3PXP");
  });
});
