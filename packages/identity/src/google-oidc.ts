import type { KeyRing } from "@waitron/credentials";
import { queueSecurityChangeMail } from "./security-change-mail.js";
import "./errors.js";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, inArray, lte } from "drizzle-orm";
import { isUniqueViolation, signInChallenges, persons, withFoldedPersonChanges } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { startManagementSession } from "./management-session.js";
import type { ManagementSession } from "./management-session.js";
import { verifyOwnCredentials } from "./profile.js";

import { insertSignInChallenge } from "./sign-in-challenges.js";

const STATE_TTL_MS = 10 * 60 * 1000;

/** A later expiry was stamped before a backward clock step, and counts as passed. */
function latestLiveExpiry(now: Date): string {
  return new Date(now.getTime() + STATE_TTL_MS).toISOString();
}
const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

interface GoogleStartInput {
  clientId: string;
  redirectUri: string;
  now?: Date;
}

export interface GoogleOidcClaim {
  mode: "login" | "link";
  personId: string | null;
  nonce: string;
  verifier: string;
}

async function begin(
  tx: Transaction,
  input: GoogleStartInput,
  mode: GoogleOidcClaim["mode"],
  personId: string | null,
): Promise<{ authorizationUrl: string; state: string }> {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const now = input.now ?? new Date();
  await insertSignInChallenge(tx, {
    kind: mode === "login" ? "google_login" : "google_link",
    personId,
    stateHash: digest(state),
    nonce,
    verifier,
    lifetimeMs: STATE_TTL_MS,
    now,
  });
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return { authorizationUrl: url.toString(), state };
}

export function beginGoogleLogin(tx: Transaction, input: GoogleStartInput) {
  return begin(tx, input, "login", null);
}

export async function beginGoogleLink(
  tx: Transaction,
  input: GoogleStartInput & {
    managementSessionId: string;
    totp?: string;
    keyRing: KeyRing;
  },
) {
  const person = await verifyOwnCredentials(tx, input);
  return begin(tx, input, "link", person.id);
}

export async function claimGoogleState(
  tx: Transaction,
  input: { state: string; now?: Date },
): Promise<GoogleOidcClaim> {
  const rows = await tx
    .delete(signInChallenges)
    .where(
      and(
        eq(signInChallenges.stateHash, digest(input.state)),
        inArray(signInChallenges.kind, ["google_login", "google_link"]),
        gt(signInChallenges.expiresAt, (input.now ?? new Date()).toISOString()),
        lte(signInChallenges.expiresAt, latestLiveExpiry(input.now ?? new Date())),
      ),
    )
    .returning({
      kind: signInChallenges.kind,
      personId: signInChallenges.personId,
      nonce: signInChallenges.nonce,
      verifier: signInChallenges.verifier,
    });
  const row = rows[0];
  if (row === undefined) {
    throw new AppError("google.invalid", {});
  }
  return {
    mode: row.kind === "google_login" ? "login" : "link",
    personId: row.personId,
    nonce: row.nonce!,
    verifier: row.verifier!,
  };
}

export async function completeGoogleLink(
  tx: Transaction,
  input: { personId: string; subject: string },
): Promise<void> {
  const [person] = await tx
    .select({ googleSubject: persons.googleSubject })
    .from(persons)
    .where(eq(persons.id, input.personId));
  try {
    const updated = await tx
      .update(persons)
      .set(withFoldedPersonChanges({ googleSubject: input.subject }))
      .where(and(eq(persons.id, input.personId), eq(persons.status, "active")))
      .returning({ id: persons.id });
    if (updated.length !== 1) throw new AppError("google.invalid", {});
    if (person?.googleSubject !== input.subject)
      await queueSecurityChangeMail(tx, { personId: input.personId, change: "google_connected" });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("google.already_linked", {});
    throw error;
  }
}

export async function loginWithGoogle(
  tx: Transaction,
  input: { subject: string },
): Promise<ManagementSession> {
  const [person] = await tx
    .select({ id: persons.id, status: persons.status, totpSecret: persons.totpSecret })
    .from(persons)
    .where(eq(persons.googleSubject, input.subject));
  if (person === undefined || person.status !== "active") throw new AppError("google.invalid", {});
  if (person.totpSecret !== null) throw new AppError("google.second_factor_required", {});
  return startManagementSession(tx, { method: "google", personId: person.id });
}
