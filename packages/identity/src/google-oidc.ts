import "./errors.js";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { isUniqueViolation } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { startManagementSession } from "./management-session.js";
import type { ManagementSession } from "./management-session.js";
import { googleOidcStates } from "./schema/google-oidc-states.js";
import { persons } from "./schema/persons.js";
import { verifyOwnCredentials } from "./profile.js";
import type { TotpKeyRing } from "./mfa.js";

const STATE_TTL_MS = 10 * 60 * 1000;
const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

interface GoogleStartInput {
  tenantId: string;
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
  await tx
    .delete(googleOidcStates)
    .where(
      and(
        eq(googleOidcStates.tenantId, input.tenantId),
        lt(googleOidcStates.expiresAt, now.toISOString()),
      ),
    );
  await tx.insert(googleOidcStates).values({
    tenantId: input.tenantId,
    personId,
    mode,
    stateHash: digest(state),
    nonce,
    verifier,
    expiresAt: new Date(now.getTime() + STATE_TTL_MS).toISOString(),
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
    currentPassword?: string;
    totp?: string;
    keyRing?: TotpKeyRing;
  },
) {
  const person = await verifyOwnCredentials(tx, input);
  return begin(tx, input, "link", person.id);
}

export async function claimGoogleState(
  tx: Transaction,
  input: { tenantId: string; state: string; now?: Date },
): Promise<GoogleOidcClaim> {
  const rows = await tx
    .delete(googleOidcStates)
    .where(
      and(
        eq(googleOidcStates.tenantId, input.tenantId),
        eq(googleOidcStates.stateHash, digest(input.state)),
        gt(googleOidcStates.expiresAt, (input.now ?? new Date()).toISOString()),
      ),
    )
    .returning({
      mode: googleOidcStates.mode,
      personId: googleOidcStates.personId,
      nonce: googleOidcStates.nonce,
      verifier: googleOidcStates.verifier,
    });
  const row = rows[0];
  if (row === undefined || (row.mode !== "login" && row.mode !== "link")) {
    throw new AppError("google.invalid", {});
  }
  return { ...row, mode: row.mode };
}

export async function completeGoogleLink(
  tx: Transaction,
  input: { tenantId: string; personId: string; subject: string },
): Promise<void> {
  try {
    const updated = await tx
      .update(persons)
      .set({ googleSubject: input.subject })
      .where(
        and(
          eq(persons.tenantId, input.tenantId),
          eq(persons.id, input.personId),
          eq(persons.status, "active"),
        ),
      )
      .returning({ id: persons.id });
    if (updated.length !== 1) throw new AppError("google.invalid", {});
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("google.already_linked", {});
    throw error;
  }
}

export async function loginWithGoogle(
  tx: Transaction,
  input: { tenantId: string; subject: string },
): Promise<ManagementSession> {
  const [person] = await tx
    .select({ id: persons.id, status: persons.status, totpSecret: persons.totpSecret })
    .from(persons)
    .where(and(eq(persons.tenantId, input.tenantId), eq(persons.googleSubject, input.subject)));
  if (person === undefined || person.status === "pending") throw new AppError("google.invalid", {});
  if (person.status === "suspended")
    throw new AppError("person.suspended", { personId: person.id });
  if (person.totpSecret !== null) throw new AppError("google.second_factor_required", {});
  return startManagementSession(tx, { tenantId: input.tenantId, personId: person.id });
}
