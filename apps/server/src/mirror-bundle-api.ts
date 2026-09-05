// The PRIMARY side of the C2b cloud-mirror operator flow (design §4). `POST /management-api/mirror-bundle`
// mints a `MirrorBundle` (venue rows + connection + a fresh per-peer sync token) for a mirror to adopt.
// The mirror calls this SERVER-SIDE, so the admin credential rides in the REQUEST BODY (not a cookie):
// the handler authenticates it and authorizes the admin-only `mirror.create` permission with the same
// identity primitives the dashboard login uses (`loginManager*` → `authorizeManager`), but it
// authenticates by PERSON ID, not email: this is a server-to-server flow carrying the admin's id (the
// operator types it into the setup connect screen), NOT the email login form. The primary's admin MAY now carry
// an email (onboarding via the setup UI sets one; the bare `venue` CLI may not), but this path never
// uses it — it keeps the id-based `loginManagerById` sibling (see the route body for why).
//
// It ALSO appends the joining node to the venue's membership document with the `contactUrl` the
// joiner advertised (till-reroute design §3.3), so tills know how to reach it before it ever promotes.
//
// Mounted ONLY on a trading + primary node (boot.ts) — a mirror emits no bundle. If the primary has no
// relay configured there is nothing for the mirror to dial, so the endpoint refuses `mirror.no_relay`
// BEFORE `assembleMirrorBundle` mints a token (design §4). The minted token appears once, in the
// response body, and is NEVER logged (the sync.* / tunnel.* no-row-content discipline).
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import {
  asAppUser,
  readNodeMembership,
  withTenant,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { withMember } from "@waitron/membership";
import { authorizeManager, endManagementSession, loginManagerById } from "@waitron/identity";
import type { KeyRing } from "@waitron/credentials";
import type { AdoptResult } from "@waitron/provisioning";
import { assembleMirrorBundle } from "./mirror-bundle.js";
import { mintNextMembershipDocument } from "./membership-mint.js";
import { createErrorBoundary } from "./error-boundary.js";
import { readJsonBody } from "./read-json-body.js";
import { isUuid } from "./till-session.js";
import type { Logger } from "./logger.js";

/**
 * Everything the mirror-bundle route needs. `appDb` authenticates + authorizes (as `app_user` under
 * `withTenant` + `asAppUser`, the dashboard-login shape) AND reads the venue rows inside
 * `assembleMirrorBundle`; `retentionDb` is the `sync_retention` connection the retention sweep already
 * opens (`enrolPeer` mints the token as that role — CLAUDE.md §3, never a broader connection).
 * `designated` are the five ids the primary till was provisioned with (`config.till.*`) — its `tenantId`
 * scopes the auth transaction. `stateDir` locates the box CA; `boxHostname` is the box's TLS SAN.
 * `relayUrl` is the primary's own relay coordinates (`loadTunnelConfig`), `undefined` when no tunnel is
 * configured — the endpoint then refuses `mirror.no_relay` rather than minting an undial-able bundle.
 * `ring` is the box vault key used to unseal the primary's identity key — `assembleMirrorBundle`
 * endorses the standby's key with it (design §6 R2), and this route signs the membership document it
 * appends the standby to with it (till-reroute §3.3).
 */
export interface MirrorBundleApiDeps {
  appDb: Database;
  retentionDb: Database;
  ring: KeyRing;
  stateDir: string;
  relayUrl: string | undefined;
  boxHostname: string;
  designated: AdoptResult;
}

/**
 * Every AppError CODE this route answers + its HTTP status (the management-api STATUS parallel). CLIENT
 * faults only: a genuine SERVER fault reaches `run` as a non-AppError → an opaque 500. The credential
 * codes: a wrong/short/missing credential is a 401, a suspended person or an unauthorised role a 403,
 * an unknown person a 404 (`loginManagerById` throws `person.not_found` for an id that resolves to no
 * row — unlike the email dashboard login, which folds unknown-vs-wrong into `password.invalid`; there
 * is no enumeration surface to hide on this trusted server-to-server path). `mirror.no_relay` is
 * the primary-has-no-tunnel refusal (this task wires its 400). `mirror.standby_invalid` is the
 * malformed-standby-identity refusal — a distinct 400 client fault from a bad credential (401), so it
 * is NOT folded into `password.invalid`. A registered code absent here defaults to 400 via `run` —
 * which is where a structurally-unreachable `mirror.not_provisioned` (a trading primary is always
 * stamped) would land if `assembleMirrorBundle` ever threw it.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "password.invalid": 401,
  "totp.invalid": 401,
  "person.suspended": 403,
  "person.not_found": 404,
  "authorization.not_permitted": 403,
  "mirror.no_relay": 400,
  "mirror.standby_invalid": 400,
};

/**
 * Mounts `POST /management-api/mirror-bundle` on an existing Hono app — the `mountReportApi` /
 * `mountManagementApi` convention, attached to the SAME trading-primary app. `log` is optional (a boot
 * always threads one; a unit mount may omit it) and defaults to a no-op so `run` always has a sink.
 */
export function mountMirrorBundleApi(
  app: Hono,
  deps: MirrorBundleApiDeps,
  log: Logger = () => {},
): void {
  const run = createErrorBoundary(STATUS, "mirror.bundle_failed");

  app.post("/management-api/mirror-bundle", (c) =>
    run(c, log, async () => {
      // The credential rides in the body (the mirror calls server-side) and is authenticated by PERSON
      // ID (a server-to-server flow carrying an id, not the email form — see below). The body screen: a
      // non-string/non-UUID `personId`, a non-string `password`, or a present non-string `totp` is
      // refused as `password.invalid` — the SAME code a wrong password gets, so the response never
      // tells the caller which field failed.
      // (The `isUuid` screen turns a malformed id into this clean 401 rather than a `22P02` → opaque 500
      // when it reaches the `uuid` column.) `readJsonBody` coerces an empty/malformed/`null` body to
      // `{}` so a degenerate body falls through to this screen rather than a 500.
      const body = await readJsonBody<{
        personId?: string;
        password?: string;
        totp?: string;
        standbyNodeId?: string;
        standbyPublicKey?: string;
        standbyContactUrl?: unknown;
      }>(c);
      if (
        typeof body.personId !== "string" ||
        !isUuid(body.personId) ||
        typeof body.password !== "string" ||
        (body.totp !== undefined && typeof body.totp !== "string")
      ) {
        throw new AppError("password.invalid", {});
      }
      const { personId, password, totp } = body;

      // The standby identity the primary will reserve + endorse rides in the same body and is REQUIRED
      // on every request (Task 5's fetcher always sends it; pre-production, no bwc). Screened exactly
      // like the credential above — a non-string/non-UUID `standbyNodeId`, a non-string/empty
      // `standbyPublicKey`, or a non-string `standbyContactUrl` is refused as `mirror.standby_invalid`
      // (a distinct 400 client fault, NOT the 401 a bad credential gets). An EMPTY `standbyContactUrl`
      // is allowed: a standby that advertises no origin is still a member of the org chart. This runs
      // AFTER the credential screen so a malformed credential still reports as `password.invalid`, and
      // BEFORE auth so a well-formed request is fully shaped before any database work.
      if (
        typeof body.standbyNodeId !== "string" ||
        !isUuid(body.standbyNodeId) ||
        typeof body.standbyPublicKey !== "string" ||
        body.standbyPublicKey === "" ||
        typeof body.standbyContactUrl !== "string"
      ) {
        throw new AppError("mirror.standby_invalid", {});
      }
      const standby = { nodeId: body.standbyNodeId, publicKey: body.standbyPublicKey };
      const standbyContactUrl = body.standbyContactUrl;

      // Authenticate + authorize: `loginManagerById` mints a session (password + TOTP when enrolled),
      // `authorizeManager` checks the admin-only `mirror.create`. Runs as `app_user` under the
      // designated tenant, so RLS scopes the person + session reads to this venue. This flow
      // authenticates by PERSON ID, not email, because it is a server-to-server flow carrying an id the
      // operator typed — not the email dashboard-login form. The primary's admin MAY now carry an email
      // (onboarding via the setup UI sets one; the bare `venue` CLI seeds it emailless, since email is
      // OPTIONAL in provisioning — `packages/provisioning/src/venue-apply.ts`), but this path never uses
      // it: `loginManagerById` is the id sibling that shares all the same credential checks
      // (`packages/identity/src/manager-login.ts`) and resolves the admin by id regardless.
      await withTenant(deps.appDb, deps.designated.tenantId, async (tx) => {
        await asAppUser(tx);
        const session = await loginManagerById(tx, {
          tenantId: deps.designated.tenantId,
          personId,
          password,
          totp,
        });
        await authorizeManager(tx, {
          managementSessionId: session.id,
          permission: "mirror.create",
        });
        // The session existed only to authorize this one credential — no cookie is set and the mirror
        // never reuses it, so end it in the same transaction rather than leave a permanently-dead
        // `management_sessions` row behind on every mint.
        await endManagementSession(tx, session.id);
      });

      // A mirror with no relay to dial is unusable, so refuse BEFORE minting a token (design §4). The
      // relay endpoint is infrastructure config, not echoed — `mirror.no_relay` carries no params.
      if (deps.relayUrl === undefined) throw new AppError("mirror.no_relay", {});

      const bundle = await assembleMirrorBundle({
        appDb: deps.appDb,
        retentionDb: deps.retentionDb,
        ring: deps.ring,
        stateDir: deps.stateDir,
        relayUrl: deps.relayUrl,
        boxHostname: deps.boxHostname,
        designated: deps.designated,
        standby,
      });
      // A node joins the org chart AT ADOPT, not at promotion (till-reroute design §3.3): a till
      // reroutes by the document's per-node `contactUrl`, so the address of every member has to be
      // published before the failover that needs it, never as part of it. `withMember` leaves every
      // other node exactly as it was; the next term is signed by this primary with its own identity
      // key, read as `app_user` (the promote.ts shape) — `app_user` holds INSERT/UPDATE on
      // `node_membership` (0097_node_membership_write_grant.sql).
      //
      // Bundle assembly and this write are deliberately separate transactions (CLAUDE.md §3): they run
      // on different roles' connections and the response sits between this flow and the mirror. Ordered
      // BEFORE the response, so a failed append is a 500 and the mirror never adopts a bundle whose
      // node the document omits; a re-run is idempotent in content (`withMember` refreshes a listed
      // node in place) and merely bumps the term again.
      const held = await readNodeMembership(deps.appDb);
      const document = await mintNextMembershipDocument(
        { db: deps.appDb, ring: deps.ring },
        {
          tenantId: deps.designated.tenantId,
          heldDocument: held,
          nodes: withMember(held?.body.nodes ?? [], standby.nodeId, standbyContactUrl),
          signerNodeId: deps.designated.nodeId,
        },
      );
      await writeNodeMembership(deps.appDb, document);

      // The token appears once, here, and is never logged.
      return c.json(bundle);
    }),
  );
}
