// The PRIMARY side of the C2b cloud-mirror operator flow (design §4). `POST /management-api/mirror-bundle`
// mints a `MirrorBundle` (venue rows + connection + a fresh per-peer sync token) for a mirror to adopt.
// The mirror calls this SERVER-SIDE, so the admin credential rides in the REQUEST BODY (not a cookie):
// the handler authenticates it and authorizes the admin-only `mirror.create` permission the SAME way the
// dashboard login does (`loginManager` → `authorizeManager`, management-api.ts's `POST /management-api/session`).
//
// Mounted ONLY on a trading + primary node (boot.ts) — a mirror emits no bundle. If the primary has no
// relay configured there is nothing for the mirror to dial, so the endpoint refuses `mirror.no_relay`
// BEFORE `assembleMirrorBundle` mints a token (design §4). The minted token appears once, in the
// response body, and is NEVER logged (the sync.* / tunnel.* no-row-content discipline).
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { authorizeManager, loginManager } from "@waitron/identity";
import type { AdoptResult } from "@waitron/provisioning";
import { assembleMirrorBundle } from "./mirror-bundle.js";
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
 */
export interface MirrorBundleApiDeps {
  appDb: Database;
  retentionDb: Database;
  stateDir: string;
  relayUrl: string | undefined;
  boxHostname: string;
  designated: AdoptResult;
}

/**
 * Every AppError CODE this route answers + its HTTP status (the management-api STATUS parallel). CLIENT
 * faults only: a genuine SERVER fault reaches `run` as a non-AppError → an opaque 500. The credential
 * codes mirror the dashboard login (`POST /management-api/session`): a wrong/short/missing credential is
 * a 401, a suspended person or an unauthorised role a 403, an unknown person a 404. `mirror.no_relay` is
 * the primary-has-no-tunnel refusal (this task wires its 400). A registered code absent here defaults to
 * 400 via `run` — which is where a structurally-unreachable `mirror.not_provisioned` (a trading primary
 * is always stamped) would land if `assembleMirrorBundle` ever threw it.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "password.invalid": 401,
  "totp.invalid": 401,
  "person.suspended": 403,
  "person.not_found": 404,
  "authorization.not_permitted": 403,
  "mirror.no_relay": 400,
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
      // The credential rides in the body (the mirror calls server-side). Screened exactly as the
      // dashboard login route: a non-string/non-UUID `personId`, a non-string `password`, or a present
      // non-string `totp` is refused as `password.invalid` — the SAME code a wrong password gets, so the
      // response never tells the caller which field failed. `readJsonBody` coerces an empty/malformed/
      // `null` body to `{}` so a degenerate body falls through to this screen rather than a 500.
      const body = await readJsonBody<{ personId?: string; password?: string; totp?: string }>(c);
      if (
        typeof body.personId !== "string" ||
        !isUuid(body.personId) ||
        typeof body.password !== "string" ||
        (body.totp !== undefined && typeof body.totp !== "string")
      ) {
        throw new AppError("password.invalid", {});
      }
      const { personId, password, totp } = body;

      // Authenticate + authorize as the dashboard does: `loginManager` mints a session (password + TOTP
      // when enrolled), `authorizeManager` checks the admin-only `mirror.create`. Runs as `app_user`
      // under the designated tenant, so RLS scopes the person + session reads to this venue.
      await withTenant(deps.appDb, deps.designated.tenantId, async (tx) => {
        await asAppUser(tx);
        const session = await loginManager(tx, {
          tenantId: deps.designated.tenantId,
          personId,
          password,
          totp,
        });
        await authorizeManager(tx, {
          managementSessionId: session.id,
          permission: "mirror.create",
        });
      });

      // A mirror with no relay to dial is unusable, so refuse BEFORE minting a token (design §4). The
      // relay endpoint is infrastructure config, not echoed — `mirror.no_relay` carries no params.
      if (deps.relayUrl === undefined) throw new AppError("mirror.no_relay", {});

      const bundle = await assembleMirrorBundle({
        appDb: deps.appDb,
        retentionDb: deps.retentionDb,
        stateDir: deps.stateDir,
        relayUrl: deps.relayUrl,
        boxHostname: deps.boxHostname,
        designated: deps.designated,
      });
      // The token appears once, here, and is never logged.
      return c.json(bundle);
    }),
  );
}
