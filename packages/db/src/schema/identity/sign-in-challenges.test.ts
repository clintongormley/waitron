import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../../migrations.js";
import { captureError, engineErrorMessage } from "../../testing/errors.js";
import { seedPerson } from "../../testing/seed.js";
import { useVenueDb } from "../../testing/venue-db.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let personId: string;
beforeEach(async () => { personId = await seedPerson(suite.db); });
const kinds = ["passkey_registration", "passkey_login", "passkey_check", "google_login", "google_link", "totp_enrolment"] as const;
type Row = { kind: string; personId: string | null; challenge: string | null; stateHash: string | null; nonce: string | null; verifier: string | null; encryptedSecret: string | null; createdAt: string; expiresAt: string };
function row(kind: typeof kinds[number]): Row {
  return {
    kind, personId: kind.endsWith("login") ? null : personId,
    challenge: kind.startsWith("passkey_") ? "challenge" : null,
    stateHash: kind.startsWith("google_") ? "a".repeat(64) : null,
    nonce: kind.startsWith("google_") ? "nonce" : null,
    verifier: kind.startsWith("google_") ? "verifier" : null,
    encryptedSecret: kind === "totp_enrolment" ? "sealed" : null,
    createdAt: "2026-11-16T12:00:00.000Z", expiresAt: "2026-11-16T12:05:00.000Z",
  };
}
async function insert(r: Row) {
  return suite.db.execute(sql`insert into sign_in_challenges
    (id, kind, person_id, challenge, state_hash, nonce, verifier, encrypted_secret, created_at, expires_at)
    values (${randomUUID()}, ${r.kind}, ${r.personId}, ${r.challenge}, ${r.stateHash}, ${r.nonce}, ${r.verifier}, ${r.encryptedSecret}, ${r.createdAt}, ${r.expiresAt}) returning kind`);
}
it.each(kinds)("accepts a well-formed %s row", async (kind) => {
  expect((await insert(row(kind))).rows).toEqual([{ kind }]);
});
it.each([
  ["passkey_registration", { challenge: null }],
  ["passkey_check", { challenge: null }],
  ["passkey_login", { challenge: null }],
  ["passkey_registration", { stateHash: "a".repeat(64) }],
  ["passkey_registration", { nonce: "unexpected" }],
  ["passkey_registration", { verifier: "unexpected" }],
  ["passkey_registration", { encryptedSecret: "unexpected" }],
  ["passkey_registration", { personId: null }],
  ["passkey_check", { personId: null }],
  ["passkey_login", { personId: "existing" }],
  ["google_login", { personId: "existing" }],
  ["google_link", { personId: null }],
  ["google_link", { stateHash: null }],
  ["google_link", { nonce: null }],
  ["google_link", { verifier: null }],
  ["google_link", { challenge: "unexpected" }],
  ["google_link", { encryptedSecret: "unexpected" }],
  ["totp_enrolment", { encryptedSecret: "" }],
  ["totp_enrolment", { encryptedSecret: null }],
  ["totp_enrolment", { personId: null }],
  ["totp_enrolment", { challenge: "unexpected" }],
  ["totp_enrolment", { stateHash: "a".repeat(64) }],
  ["totp_enrolment", { nonce: "unexpected" }],
  ["totp_enrolment", { verifier: "unexpected" }],
] as const)("refuses a malformed %s row (%j)", async (kind, change) => {
  const malformed = { ...row(kind), ...change };
  if (malformed.personId === "existing") malformed.personId = personId;
  const error = await captureError(() => insert(malformed));
  expect(engineErrorMessage(error)).toContain("sign_in_challenges_shape_ck");
});
it.each(["", "a".repeat(63), "a".repeat(65)])("refuses a Google state hash of the wrong length (%s)", async (stateHash) => {
  const error = await captureError(() => insert({ ...row("google_login"), stateHash }));
  expect(engineErrorMessage(error)).toContain("sign_in_challenges_state_hash_ck");
});
it("refuses an unknown kind", async () => {
  const error = await captureError(() => insert({ ...row("passkey_login"), kind: "unknown" }));
  expect(engineErrorMessage(error)).toContain("sign_in_challenges_kind_ck");
});
it.each(["2026-11-16T12:00:00.000Z", "2026-11-16T11:59:59.999Z"])("refuses expiry at or before creation (%s)", async (expiresAt) => {
  const error = await captureError(() => insert({ ...row("passkey_login"), expiresAt }));
  expect(engineErrorMessage(error)).toContain("sign_in_challenges_expiry_ck");
});
it("refuses a second pending two-step setup for one person", async () => {
  await insert(row("totp_enrolment"));
  const error = await captureError(() => insert(row("totp_enrolment")));
  expect(engineErrorMessage(error)).toBe("UNIQUE constraint failed: sign_in_challenges.person_id");
});
it("accepts two-step setups for two people", async () => {
  await insert(row("totp_enrolment"));
  const other = await seedPerson(suite.db, { displayName: "Other person" });
  expect((await insert({ ...row("totp_enrolment"), personId: other })).rows).toEqual([{ kind: "totp_enrolment" }]);
});
it("refuses two rows with the same state hash", async () => {
  await insert(row("google_login"));
  const error = await captureError(() => insert(row("google_link")));
  expect(engineErrorMessage(error)).toBe("UNIQUE constraint failed: sign_in_challenges.state_hash");
});
it("refuses a row for a person who does not exist", async () => {
  const error = await captureError(() => insert({ ...row("passkey_registration"), personId: randomUUID() }));
  expect(engineErrorMessage(error)).toBe("FOREIGN KEY constraint failed");
});
it("deletes a person's challenges with the person", async () => {
  await insert(row("passkey_registration"));
  await insert(row("totp_enrolment"));
  await insert(row("google_login"));
  await suite.db.execute(sql`delete from persons where id = ${personId}`);
  expect((await suite.db.execute(sql`select kind from sign_in_challenges`)).rows).toEqual([{ kind: "google_login" }]);
});
