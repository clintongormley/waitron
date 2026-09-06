// Side-effect only: keeps this package's `agent.*` codes (errors.ts) reachable from the file that
// throws them — the reachability convention every code-throwing file in the tree follows, guarded
// tree-wide by scripts/errors-reachable.test.ts. See errors.ts.
import "./errors.js";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { printAgentPairingCodes, printAgents } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { hashSecret, verifySecret } from "@waitron/identity";

// Printing subsystem §3a — the CRYPTO CORE of print-agent enrolment + auth, modelled EXACTLY on
// device-identity (apps/server/src/device.ts + device-session.ts), because a print agent is the same
// "enrol a trusted local box centrally, revoke it centrally" problem, just bound to printers not a
// station. Three pure verbs on the caller's transaction — the Task-6 route layer wraps each in
// `withTenant`/`asAppUser` and owns the HTTP status mapping (and, for auth, the Bearer-header parse):
//
//   - generateAgentCode: an admin mints a single-use pairing code (the `printer.manage` verb).
//   - enrolAgent:        the local agent redeems the code and becomes a trusted `print_agents` row,
//                        receiving a bearer token it authenticates with thereafter.
//   - authenticateAgent: the auth CORE — resolves a presented bearer token to its agent id, or throws
//                        `agent.unauthorized`. A revoked (`active = false`) agent fails instantly.
//
// Two-tier secret handling, and EVERY hash/compare is REUSED, never home-rolled (the "reuse crypto,
// write none" rule, design §7):
//  - the pairing code is EPHEMERAL (single-use, TTL-bounded) and is looked up by the redeeming agent
//    from the code ALONE, so its at-rest form is a deterministic SHA-256 (createHash, node:crypto) —
//    the indexed lookup key. High entropy + single-use + a short TTL is what keeps that digest safe;
//  - the agent token is LONG-LIVED and salted per row, so it is scrypt (hashSecret, @waitron/identity)
//    — the same KDF PINs, passwords and device tokens use — and never stored plaintext.
// The plaintext code and token each leave this module EXACTLY ONCE (the return values, for the operator
// to read / the agent to store); neither is ever logged or persisted in the clear.

/**
 * How long a minted pairing code stays redeemable — the device-identity `PAIRING_TTL_MS` analogue
 * (device.ts), the WebAuthn-challenge TTL pattern (passkey.ts `CHALLENGE_TTL_MS`). The TTL is computed
 * in code from `created_at` (there is deliberately no `expires_at` column, §2a); a code older than this
 * redeems `agent.pairing_expired`, and — because the redeeming DELETE is rolled back with the enclosing
 * transaction on that throw — the row survives to lapse by its TTL rather than being burned by the
 * too-late attempt.
 */
export const PAIRING_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** Bytes of entropy per pairing code. 32 bytes = 256 bits, emitted as base64url. Unlike the device's
 * ~40-bit human-transcribed Crockford code (read off one screen, typed into another), an agent code is
 * copied into the agent process's config, so it needs no ambiguity-proof alphabet — a high-entropy
 * URL-safe string is enough. At 256 bits the SHA-256 digest collision the `(tenant_id, code_sha256)`
 * unique index guards against is unreachable in practice, so — unlike `generatePairingCode` — there is
 * no digest-collision translation/retry here; that index is a pure defense-in-depth backstop. */
const PAIRING_CODE_BYTES = 32;

/** Bytes of entropy in the bearer token's secret half. 32 bytes = 256 bits, base64url — the
 * device-token width (device.ts). */
const TOKEN_BYTES = 32;

/**
 * The tenant + venue scope a code/agent is minted under. The route resolves it (single-tenant deli
 * deployment, `deps.tenantId` + the location) and passes it down, so these verbs never derive scope
 * from client input. `authenticateAgent` reads only `tenantId` (typed narrower at its call site).
 */
export interface PrintAgentConfig {
  tenantId: string;
  locationId: string;
}

/**
 * Anchored UUID shape check for the bearer token's SELECTOR half. `print_agents.id` is a Postgres
 * `uuid` column, so a bearer whose selector is NOT a uuid would make `eq(printAgents.id, agentId)`
 * raise `22P02 invalid input syntax for type uuid` — which the route maps to an opaque 500. A forged
 * bearer is a client fault, not a server one, so its shape is screened first and fails as a clean
 * `agent.unauthorized`. Mirrors `till-session.ts`'s `isUuid`; not reusing that one because it lives in
 * apps/server (packages never import apps, design/Ruling 5) and `@waitron/shared`'s validator is a
 * private, unexported const (the same reason `till-session.ts` re-declares it).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mint a single-use pairing code for a new print agent (§3a). Stores only the code's SHA-256
 * (never the plaintext) plus the label to stamp on the enrolled agent, scoped to `cfg`'s tenant +
 * venue, and returns the plaintext code ONCE for the operator to read into the agent's config.
 * The caller runs this as `app_user` inside `withTenant` (the `printer.manage` route). The app
 * role grants permit INSERT; the inserted `tenantId` value comes from `cfg.tenantId`.
 */
export async function generateAgentCode(
  tx: Transaction,
  cfg: PrintAgentConfig,
  input: { label: string },
): Promise<{ code: string }> {
  const code = randomBytes(PAIRING_CODE_BYTES).toString("base64url");
  await tx.insert(printAgentPairingCodes).values({
    tenantId: cfg.tenantId,
    locationId: cfg.locationId,
    codeSha256: createHash("sha256").update(code).digest("hex"),
    label: input.label,
  });
  return { code };
}

/**
 * Redeem a pairing code and enrol the agent (§3a). Mirrors the WebAuthn `consumeChallenge` /
 * `enrolDevice` semantic EXACTLY:
 *
 *  1. A locking `DELETE FROM print_agent_pairing_codes WHERE tenant_id AND code_sha256 = sha256(code)
 *     RETURNING` — Drizzle-parameterised, never string-concatenated. The DELETE row-locks the code, so
 *     two agents racing on the SAME code serialise: the second blocks, then — once the first commits —
 *     matches ZERO rows. No row (unknown, or already-consumed, both folded) → `agent.pairing_invalid`.
 *  2. `now - created_at > PAIRING_TTL_MS` → `agent.pairing_expired`. The throw rolls the caller's
 *     transaction back, UNDOING the consume-DELETE, so an expired code lapses by its TTL rather than
 *     being burned by the too-late attempt (the WebAuthn semantic). No catch/commit around this — the
 *     route's `withTenant` transaction rolls it back.
 *  3. Mint a long-lived secret (`randomBytes(32).base64url`) and INSERT the `print_agents` row with its
 *     scrypt hash (`hashSecret`, @waitron/identity) — the plaintext lives ONLY in the returned token,
 *     never at rest.
 *
 * Returns the enrolled agent's id + the bearer token the agent presents thereafter. The token is
 * `${agentId}.${secret}`: a SELECTOR (the row id, needed to fetch the per-row scrypt salt) + a
 * VALIDATOR (the secret `authenticateAgent` checks). Composing it HERE (not in the route) keeps the
 * token format in one module with the split in `authenticateAgent`.
 */
export async function enrolAgent(
  tx: Transaction,
  cfg: PrintAgentConfig,
  input: { code: string },
): Promise<{ agentId: string; token: string }> {
  const codeSha256 = createHash("sha256").update(input.code).digest("hex");
  // Consume BEFORE anything else: the locking DELETE … RETURNING is the single-use guarantee under
  // concurrency (see the doc above). Parameterised by Drizzle — `code_sha256` binds as `$n`.
  const [row] = await tx
    .delete(printAgentPairingCodes)
    .where(
      and(
        eq(printAgentPairingCodes.tenantId, cfg.tenantId),
        eq(printAgentPairingCodes.codeSha256, codeSha256),
      ),
    )
    .returning({
      createdAt: printAgentPairingCodes.createdAt,
      label: printAgentPairingCodes.label,
      locationId: printAgentPairingCodes.locationId,
    });
  if (row === undefined) throw new AppError("agent.pairing_invalid", {});
  if (Date.now() - Date.parse(row.createdAt) > PAIRING_TTL_MS) {
    throw new AppError("agent.pairing_expired", {});
  }

  const secret = randomBytes(TOKEN_BYTES).toString("base64url");
  const [agent] = await tx
    .insert(printAgents)
    .values({
      tenantId: cfg.tenantId,
      // The venue the code was minted under — stamped onto the enrolled agent, so scope is fixed at
      // mint time rather than re-derived at redemption.
      locationId: row.locationId,
      name: row.label,
      tokenHash: hashSecret(secret),
      active: true,
    })
    .returning({ id: printAgents.id });
  return { agentId: agent!.id, token: `${agent!.id}.${secret}` };
}

/**
 * The agent-auth CORE (§3a, Ruling 5). Resolves a presented bearer token STRING to its agent id, or
 * throws `agent.unauthorized`. The Task-6 Hono wrapper (`requireAgent`) extracts the
 * `Authorization: Bearer <token>` header and calls this; header parsing is that wrapper's trivial
 * concern, so this core takes a plain string and never sees Hono. The `tx` is already tenant-scoped by
 * that wrapper (`withTenant` + `asAppUser`), the `sync-api.ts` machine-to-machine shape.
 *
 * The token is `${agentId}.${secret}`: the id SELECTS the row (scrypt is per-row-salted, so the id is
 * needed to fetch the salt) and the secret VALIDATES it. Every failure — a malformed token, a
 * non-uuid selector, an unknown or REVOKED (`active = false`) agent, or a secret that does not
 * `verifySecret` against the stored hash — folds into the SAME `agent.unauthorized`, so the response
 * confirms neither an agent's existence nor its revocation state (the oracle-free reasoning in
 * errors.ts). `active = true` is the revocation filter, which makes revoke INSTANT: a revoked row is
 * simply not found, with no token lifetime to expire. `verifySecret` (scrypt, @waitron/identity) is
 * constant-time — the secret is NEVER compared with `===`.
 *
 * On success the sighting is recorded (`last_seen_at`), gated to at most one write per minute — auth
 * runs on every pull/report (the hot path) and the dashboard renders last-seen coarsely, so a
 * sub-minute re-write is invisible write amplification. The gate keeps the first sighting (NULL →
 * written) and one write per minute thereafter, exactly as `requireDevice` does.
 */
export async function authenticateAgent(
  tx: Transaction,
  cfg: { tenantId: string },
  token: string,
): Promise<{ agentId: string }> {
  // Split on the FIRST `.` only: the id is a uuid (no dots) and a base64url secret has none either,
  // but splitting on the first separator keeps a secret that somehow carried one intact rather than
  // truncated. `dot <= 0` rejects both a missing separator (indexOf → -1) and an empty selector (dot at
  // index 0); `dot === token.length - 1` rejects an empty secret. Either malformed shape is unauthorized.
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) throw new AppError("agent.unauthorized", {});
  const agentId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  // Screen the selector's SHAPE before the DB: a non-uuid id looked up against the `uuid` column would
  // raise 22P02 → an opaque 500, so a forged bearer stays a clean `agent.unauthorized` (see `UUID_RE`).
  if (!UUID_RE.test(agentId)) throw new AppError("agent.unauthorized", {});

  const [row] = await tx
    .select({ tokenHash: printAgents.tokenHash })
    .from(printAgents)
    // `active = true` is the revocation filter: a revoked agent is simply not found. The explicit
    // `tenant_id` predicate limits the lookup to `cfg.tenantId`, matching the predicate
    // on `enrolAgent`'s consume-DELETE. All bind as `$n`, never string-concatenated.
    .where(
      and(
        eq(printAgents.id, agentId),
        eq(printAgents.tenantId, cfg.tenantId),
        eq(printAgents.active, true),
      ),
    );
  if (row === undefined) throw new AppError("agent.unauthorized", {});
  // Constant-time scrypt check (REUSED, never home-rolled): the secret is never compared with `===`.
  if (!verifySecret(secret, row.tokenHash)) throw new AppError("agent.unauthorized", {});

  // Record the sighting, SKIPPING the write when `last_seen_at` is already within the last minute (the
  // gate is pure SQL, so it costs no JS branch). Parameterised by Drizzle — `id` binds as `$n`; the
  // interval is a constant literal, never user input.
  await tx
    .update(printAgents)
    .set({ lastSeenAt: sql`now()` })
    .where(
      and(
        eq(printAgents.id, agentId),
        sql`(${printAgents.lastSeenAt} is null or ${printAgents.lastSeenAt} < now() - interval '1 minute')`,
      ),
    );
  return { agentId };
}
