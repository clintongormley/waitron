import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, managementSessions, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { eq } from "drizzle-orm";
import { codeOf, openManagementSession } from "../test/fixtures.js";
import { endManagementSession, startManagementSession } from "./management-session.js";
import { hashSessionToken } from "./session-token.js";
import { requireFreshManagementSignIn } from "./fresh-sign-in.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T12:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

it.each([
  [null, "management_session.proof_required"],
  ["2026-11-09T11:45:00.001Z", ""],
  ["2026-11-09T11:45:00.000Z", "management_session.proof_required"],
  ["2026-11-09T12:00:00.001Z", "management_session.proof_required"],
  ["invalid", "management_session.proof_required"],
] as const)("judges session proof %s", async (provedAt, code) => {
  const { token } = await openManagementSession(suite.db, "admin");
  await suite.db
    .update(managementSessions)
    .set({ provedAt })
    .where(eq(managementSessions.tokenHash, hashSessionToken(token)));
  const check = () => withTransaction(suite.db, (tx) => requireFreshManagementSignIn(tx, token));
  if (code === "") await expect(check()).resolves.toMatchObject({ personId: expect.any(String) });
  else expect(await codeOf(check)).toBe(code);
});

it("proof reuse neither extends the window nor proves another browser, and logout ends it", async () => {
  const { token, personId } = await openManagementSession(suite.db, "admin");
  const other = await withTransaction(suite.db, (tx) => startManagementSession(tx, { personId }));
  await suite.db
    .update(managementSessions)
    .set({ provedAt: "2026-11-09T11:59:00.000Z" })
    .where(eq(managementSessions.tokenHash, hashSessionToken(token)));
  for (let i = 0; i < 2; i++)
    await withTransaction(suite.db, (tx) => requireFreshManagementSignIn(tx, token));
  const [row] = await suite.db
    .select()
    .from(managementSessions)
    .where(eq(managementSessions.tokenHash, hashSessionToken(token)));
  expect(row!.provedAt).toBe("2026-11-09T11:59:00.000Z");
  expect(await codeOf(() => requireFreshManagementSignIn(suite.db, other.token))).toBe(
    "management_session.proof_required",
  );
  await withTransaction(suite.db, (tx) => endManagementSession(tx, token));
  expect(await codeOf(() => requireFreshManagementSignIn(suite.db, token))).toBe(
    "management_session.required",
  );
});

it.each([
  ["password", ""],
  ["passkey", ""],
  ["recovery-code", "management_session.proof_required"],
  [null, "management_session.proof_required"],
] as const)("handover requires proof without recovery codes: %s", async (proofMethod, code) => {
  const { token } = await openManagementSession(suite.db, "admin");
  await suite.db
    .update(managementSessions)
    .set({ provedAt: "2026-11-09T11:59:00.000Z", proofMethod })
    .where(eq(managementSessions.tokenHash, hashSessionToken(token)));
  const check = () =>
    withTransaction(suite.db, (tx) =>
      requireFreshManagementSignIn(tx, token, { allowRecoveryCode: false }),
    );
  if (code === "") await expect(check()).resolves.toMatchObject({ personId: expect.any(String) });
  else expect(await codeOf(check)).toBe(code);
  await expect(
    withTransaction(suite.db, (tx) => requireFreshManagementSignIn(tx, token)),
  ).resolves.toMatchObject({ personId: expect.any(String) });
});
