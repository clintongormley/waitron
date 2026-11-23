import {
  generateAuthenticationOptions,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { decodeClientDataJSON } from "@simplewebauthn/server/helpers";
import { nodeSigningPublicKey, type KeyRing } from "@waitron/credentials";
import { withTransaction, type Database, type NodeDatabase } from "@waitron/db";
import { verifyEnvelope } from "@waitron/handover";
import { holds, persons, readPersonAuthority, verifyPasskeyAssertion } from "@waitron/identity";
import { readNodeMode } from "@waitron/node-db";
import { AppError, isAppError } from "@waitron/shared";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { isRecord } from "./boot-peer-check.js";
import { signAsThisBox } from "./handover-signing.js";
import { readNodeIdentityKey } from "./node-identity.js";
import { switchSignedInAs, type SwitchSignedIn } from "./operation-authentication.js";
import { passkeyVerifySite, venuePasskeyOrigins } from "./passkey-origins.js";
import "./errors.js";

export const SWITCH_PROOF_COOKIE = "waitron_switch_proof";
export const SWITCH_PROOF_TTL_MS = 15 * 60_000;
export const SWITCH_CHALLENGE_TTL_MS = 2 * 60_000;
/** Statuses for the passkey refusals every emergency step can answer. */
export const SWITCH_SIGN_IN_STATUS = {
  "passkey.not_registered": 401,
  "passkey.verification_failed": 401,
  "passkey.challenge_expired": 400,
} as const;
// Anyone may ask for a challenge, so past this many the earliest made or given back go first.
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

/** Refuses unless the person is active and holds `node.manage` in `db`. */
async function requireSwitchPerson(db: Database, personId: string): Promise<void> {
  const [person] = await db
    .select({ status: persons.status })
    .from(persons)
    .where(eq(persons.id, personId));
  if (person?.status !== "active" || !holds(await readPersonAuthority(db, personId), "node.manage"))
    refuse("not_permitted");
}

/** As `readSwitchProof`, once the person is also active and holds `node.manage` in `deps.db`. */
export async function checkSwitchProof(
  deps: SwitchProofDeps,
  proof: string | null,
): Promise<{ personId: string }> {
  const personId = await readSwitchProof(deps, proof);
  await requireSwitchPerson(deps.db, personId);
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

interface HeldChallenge {
  /** When the challenge stops being live. */
  until: number;
  givenBack: boolean;
}

/**
 * Passkey challenges for the switch, kept in memory and never in `sign_in_challenges`, which
 * streams with the copy a spare follows (A947 4d plan D9). Each succeeds at most once, and is live
 * for 2 minutes from when it is made, or 15 from when it is given back or last carried by a
 * catching-up take.
 */
export function createSwitchChallenges() {
  const made = new Map<string, HeldChallenge>();
  const live = (challenge: string) => {
    const held = made.get(challenge);
    return held !== undefined && Date.now() < held.until;
  };
  const prune = () => {
    for (const challenge of made.keys())
      if (made.size >= MAX_SWITCH_CHALLENGES || !live(challenge)) made.delete(challenge);
  };
  return {
    live,
    async make(rpId: string) {
      const options = await generateAuthenticationOptions({
        rpID: rpId,
        userVerification: "required",
      });
      prune();
      made.set(options.challenge, {
        until: Date.now() + SWITCH_CHALLENGE_TTL_MS,
        givenBack: false,
      });
      return options;
    },
    /** The challenge as it was held, if it is live; either way it is no longer held. */
    take(challenge: string): HeldChallenge | undefined {
      const held = live(challenge) ? made.get(challenge) : undefined;
      made.delete(challenge);
      return held;
    },
    /** Holds a taken challenge again, once, live for as long as a proof. */
    giveBack(challenge: string, held: HeldChallenge): void {
      if (held.givenBack) return;
      prune();
      made.set(challenge, { until: Date.now() + SWITCH_PROOF_TTL_MS, givenBack: true });
    },
    /** A live challenge stays live for as long as a proof from now. */
    keepAlive(challenge: string): void {
      if (live(challenge)) made.get(challenge)!.until = Date.now() + SWITCH_PROOF_TTL_MS;
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
    const { challenge } = decodeClientDataJSON(response.response.clientDataJSON);
    return typeof challenge === "string" ? challenge : undefined;
  } catch {
    return undefined;
  }
}

/** An emergency step's sign-in, read once. With no sign-in, this box's proof cookie stands in. */
export type SwitchSignInRequest =
  | { kind: "password"; email: string; password: string; totp?: string }
  | { kind: "passkey"; response: AuthenticationResponseJSON; challenge: string | undefined }
  | { kind: "proof"; proof: string | null }
  | { kind: "malformed" };

export function parseSwitchSignIn(c: Context, signIn: unknown): SwitchSignInRequest {
  if (signIn === undefined) return { kind: "proof", proof: readSwitchProofCookie(c) };
  if (!isRecord(signIn)) return { kind: "malformed" };
  const { email, password, totp, passkey } = signIn;
  if (email !== undefined)
    return typeof email === "string" &&
      typeof password === "string" &&
      (totp === undefined || typeof totp === "string")
      ? { kind: "password", email, password, ...(totp === undefined ? {} : { totp }) }
      : { kind: "malformed" };
  if (!isRecord(passkey)) return { kind: "malformed" };
  const response = passkey as unknown as AuthenticationResponseJSON;
  return { kind: "passkey", response, challenge: challengeOf(response) };
}

type NotPassword = Exclude<SwitchSignInRequest, { kind: "password" }>;

/**
 * Without `db`, checks only what needs no copy and uses nothing up. With it, a passkey's challenge
 * is taken, its answer checked against `db` and the proof cookie set, or the proof's person is
 * checked against `db` and the proof cookie renewed.
 */
async function checkSwitchSignIn(
  c: Context,
  sw: SwitchSignIn,
  signIn: NotPassword,
  db?: Database,
): Promise<string | undefined> {
  if (signIn.kind === "malformed") refuse("malformed");
  if (signIn.kind === "proof") {
    const personId = await readSwitchProof(sw, signIn.proof);
    if (db !== undefined) {
      await requireSwitchPerson(db, personId);
      setSwitchProofCookie(c, await makeSwitchProof({ ...sw, db }, personId));
    }
    return personId;
  }
  const { challenge, response } = signIn;
  if (challenge === undefined) throw new AppError("passkey.challenge_expired", {});
  if (db === undefined) {
    if (!sw.challenges.live(challenge)) throw new AppError("passkey.challenge_expired", {});
    return undefined;
  }
  const held = sw.challenges.take(challenge);
  if (held === undefined) throw new AppError("passkey.challenge_expired", {});
  let personId: string;
  try {
    const site = await passkeyVerifySite(c, sw, venuePasskeyOrigins(db, sw.origin));
    ({ personId } = await withTransaction(db, (tx) =>
      verifyPasskeyAssertion(tx, { challenge, response, ...site }),
    ));
  } catch (error) {
    // A copy that does not know the passkey has checked nothing, so the challenge is held again,
    // once, so a later step can check the same answer against a newer copy.
    if (isAppError(error) && error.code === "passkey.not_registered")
      sw.challenges.giveBack(challenge, held);
    throw error;
  }
  if (!holds(await readPersonAuthority(db, personId), "node.manage"))
    throw new AppError("authorization.not_permitted", { permission: "node.manage" });
  setSwitchProofCookie(c, await makeSwitchProof({ ...sw, db }, personId));
  return personId;
}

/** What a take checks before it stops following, needing no copy and using up nothing. */
export async function precheckSwitchCredentials(
  c: Context,
  sw: SwitchSignIn,
  signIn: SwitchSignInRequest,
): Promise<void> {
  if (signIn.kind !== "password") await checkSwitchSignIn(c, sw, signIn);
}

/**
 * For a take answered while the spare catches up: a proof that still passes against `db` is
 * renewed, and a passkey answer's challenge that is still live is kept alive. A sign-in that
 * cannot be kept alive is left as it is and not refused here.
 */
export async function keepSwitchSignInAlive(
  c: Context,
  sw: SwitchSignIn,
  db: Database,
  signIn: SwitchSignInRequest,
): Promise<void> {
  if (signIn.kind === "passkey") {
    if (signIn.challenge !== undefined) sw.challenges.keepAlive(signIn.challenge);
    return;
  }
  if (signIn.kind !== "proof") return;
  try {
    await checkSwitchSignIn(c, sw, signIn, db);
  } catch (error) {
    if (!isAppError(error) || error.code !== "password.invalid") throw error;
  }
}

/**
 * A passkey over one of `sw`'s challenges, checked against `db`, which sets the proof cookie; or
 * this box's proof cookie. A malformed sign-in is refused as a wrong password is.
 */
export async function switchCredentials(
  c: Context,
  sw: SwitchSignIn,
  db: Database,
  signIn: NotPassword,
): Promise<SwitchSignedIn> {
  return switchSignedInAs((await checkSwitchSignIn(c, sw, signIn, db))!);
}
