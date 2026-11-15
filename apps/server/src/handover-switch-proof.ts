import { nodeSigningPublicKey, type KeyRing } from "@waitron/credentials";
import type { Database, NodeDatabase } from "@waitron/db";
import { verifyEnvelope } from "@waitron/handover";
import { holds, persons, readPersonAuthority } from "@waitron/identity";
import { readNodeMode } from "@waitron/node-db";
import { AppError } from "@waitron/shared";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { signAsThisBox } from "./handover-signing.js";
import { readNodeIdentityKey } from "./node-identity.js";
import "./errors.js";

export const SWITCH_PROOF_COOKIE = "waitron_switch_proof";
export const SWITCH_PROOF_TTL_MS = 15 * 60_000;

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

/**
 * The person a switch proof names, once it is this box's own, unexpired, this box is still a
 * spare, and the person is active and holds `node.manage` in `deps.db`.
 */
export async function checkSwitchProof(
  deps: SwitchProofDeps,
  proof: string | null,
): Promise<{ personId: string }> {
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
  const [person] = await deps.db
    .select({ status: persons.status })
    .from(persons)
    .where(eq(persons.id, body.personId));
  if (
    person?.status !== "active" ||
    !holds(await readPersonAuthority(deps.db, body.personId), "node.manage")
  )
    refuse("not_permitted");
  return { personId: body.personId };
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
