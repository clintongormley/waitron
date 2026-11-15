import {
  generateAuthenticationOptions,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { nodeSigningPublicKey, type KeyRing } from "@waitron/credentials";
import { withTransaction, type Database, type NodeDatabase } from "@waitron/db";
import { verifyEnvelope } from "@waitron/handover";
import { holds, persons, readPersonAuthority, verifyPasskeyAssertion } from "@waitron/identity";
import { readNodeMode } from "@waitron/node-db";
import { AppError } from "@waitron/shared";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { signAsThisBox } from "./handover-signing.js";
import { readNodeIdentityKey } from "./node-identity.js";
import { switchSignedInAs, type SwitchSignedIn } from "./operation-authentication.js";
import { passkeyVerifySite, venuePasskeyOrigins } from "./passkey-origins.js";
import "./errors.js";

export const SWITCH_PROOF_COOKIE = "waitron_switch_proof";
export const SWITCH_PROOF_TTL_MS = 15 * 60_000;
export const SWITCH_CHALLENGE_TTL_MS = 2 * 60_000;
// Anyone may ask for a challenge, so the oldest go first past this many.
const MAX_SWITCH_CHALLENGES = 32;

export interface SwitchProofDeps {
  /** The venue database the request reads. */
  db: Database;
  node: NodeDatabase;
  ring: KeyRing;
  nodeId: string;
  now?: () => number;
}

interface SwitchProofBody {
  personId: string;
  nodeId: string;
  expiresAtMs: number;
}

/** A proof that `personId` passed the switch's passkey on this box, as the cookie's value. */
export async function makeSwitchProof(deps: SwitchProofDeps, personId: string): Promise<string> {
  const body = {
    personId,
    nodeId: deps.nodeId,
    expiresAtMs: (deps.now ?? Date.now)() + SWITCH_PROOF_TTL_MS,
  };
  const envelope = await signAsThisBox(deps, "switch-proof", body);
  return Buffer.from(JSON.stringify(envelope)).toString("base64url");
}

/** Throws `password.invalid` with a log-only reason, the same answer a wrong password gets. */
function refuse(reason: string): never {
  throw new AppError("password.invalid", {}, { reason });
}

/** The person a proof names, once it is this box's own, unexpired, and this box is still a spare. */
async function readSwitchProof(
  deps: Omit<SwitchProofDeps, "db">,
  proof: string | null,
): Promise<string> {
  if (proof === null || proof === "") refuse("missing");
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(proof, "base64url").toString("utf8"));
  } catch {
    refuse("malformed");
  }
  const ownKey = nodeSigningPublicKey(await readNodeIdentityKey(deps.node, deps.ring, deps.nodeId));
  const verdict = verifyEnvelope<unknown>(raw, "switch-proof", (id) =>
    id === deps.nodeId ? ownKey : undefined,
  );
  if (!verdict.valid) {
    if (verdict.reason === "malformed") refuse("malformed");
    if (verdict.reason === "wrong_purpose") refuse("wrong_kind");
    refuse("not_this_box");
  }
  const body = verdict.body as Partial<SwitchProofBody> | null;
  if (
    body === null ||
    typeof body !== "object" ||
    typeof body.personId !== "string" ||
    typeof body.expiresAtMs !== "number" ||
    body.nodeId !== deps.nodeId
  )
    refuse("malformed");
  if ((deps.now ?? Date.now)() >= body.expiresAtMs) refuse("expired");
  if ((await readNodeMode(deps.node, deps.nodeId)).mode !== "mirror") refuse("not_a_spare");
  return body.personId;
}

/** As `readSwitchProof`, once the person is also active and holds `node.manage` in `deps.db`. */
export async function checkSwitchProof(
  deps: SwitchProofDeps,
  proof: string | null,
): Promise<{ personId: string }> {
  const personId = await readSwitchProof(deps, proof);
  const [person] = await deps.db
    .select({ status: persons.status })
    .from(persons)
    .where(eq(persons.id, personId));
  if (
    person?.status !== "active" ||
    !holds(await readPersonAuthority(deps.db, personId), "node.manage")
  )
    refuse("not_permitted");
  return { personId };
}

export function setSwitchProofCookie(c: Context, proof: string): void {
  setCookie(c, SWITCH_PROOF_COOKIE, proof, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/api/node/handover",
    maxAge: SWITCH_PROOF_TTL_MS / 1000,
  });
}

export function readSwitchProofCookie(c: Context): string | null {
  return getCookie(c, SWITCH_PROOF_COOKIE) ?? null;
}

/**
 * Passkey challenges for the switch, kept in memory and never in `webauthn_challenges`, which
 * streams with the copy a spare follows (D9). Each is taken once.
 */
export function createSwitchChallenges() {
  const made = new Map<string, number>();
  const live = (challenge: string) => {
    const at = made.get(challenge);
    return at !== undefined && Date.now() - at < SWITCH_CHALLENGE_TTL_MS;
  };
  return {
    live,
    async make(rpId: string) {
      for (const challenge of made.keys())
        if (made.size >= MAX_SWITCH_CHALLENGES || !live(challenge)) made.delete(challenge);
      const options = await generateAuthenticationOptions({
        rpID: rpId,
        userVerification: "required",
      });
      made.set(options.challenge, Date.now());
      return options;
    },
    take(challenge: string): boolean {
      const ok = live(challenge);
      made.delete(challenge);
      return ok;
    },
  };
}

export interface SwitchSignIn extends Omit<SwitchProofDeps, "db" | "now"> {
  rpId: string;
  /** The management origin, as `venuePasskeyOrigins` takes it. */
  origin: string;
  challenges: ReturnType<typeof createSwitchChallenges>;
}

function challengeOf(response: AuthenticationResponseJSON): string | undefined {
  try {
    const data = JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString());
    return typeof data?.challenge === "string" ? data.challenge : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What a take checks before it stops following, needing no copy and using up nothing: a passkey's
 * challenge is still live, or the proof cookie passes all but its person check. Each refuses with
 * the code `switchCredentials` would.
 */
export async function precheckSwitchCredentials(
  c: Context,
  sw: SwitchSignIn,
  signIn: unknown,
): Promise<void> {
  const fields =
    typeof signIn === "object" && signIn !== null ? (signIn as Record<string, unknown>) : {};
  if (fields.email !== undefined) return;
  if (fields.passkey === undefined) {
    await readSwitchProof(sw, readSwitchProofCookie(c));
    return;
  }
  const challenge = challengeOf(fields.passkey as AuthenticationResponseJSON);
  if (challenge === undefined || !sw.challenges.live(challenge))
    throw new AppError("passkey.challenge_expired", {});
}

/**
 * For a sign-in without an email: a passkey over one of `sw`'s challenges, checked against `db`,
 * which sets the proof cookie; or else this box's proof cookie. Undefined for an email sign-in.
 */
export async function switchCredentials(
  c: Context,
  sw: SwitchSignIn,
  db: Database,
  signIn: unknown,
): Promise<SwitchSignedIn | undefined> {
  const fields =
    typeof signIn === "object" && signIn !== null ? (signIn as Record<string, unknown>) : {};
  if (fields.email !== undefined) return undefined;
  const deps = { ...sw, db };
  if (fields.passkey === undefined)
    return switchSignedInAs((await checkSwitchProof(deps, readSwitchProofCookie(c))).personId);
  const response = fields.passkey as AuthenticationResponseJSON;
  const challenge = challengeOf(response);
  if (challenge === undefined || !sw.challenges.take(challenge))
    throw new AppError("passkey.challenge_expired", {});
  const site = await passkeyVerifySite(c, sw, venuePasskeyOrigins(db, sw.origin));
  const { personId } = await withTransaction(db, (tx) =>
    verifyPasskeyAssertion(tx, { challenge, response, ...site }),
  );
  if (!holds(await readPersonAuthority(db, personId), "node.manage"))
    throw new AppError("authorization.not_permitted", { permission: "node.manage" });
  setSwitchProofCookie(c, await makeSwitchProof(deps, personId));
  return switchSignedInAs(personId);
}
