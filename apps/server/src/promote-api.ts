// `POST /management-api/promote` — the operator's failover trigger (spec §3). A server-to-server
// endpoint (the operator's browser calls it through the management surface, the credential in the
// REQUEST BODY, mirroring `mirror-bundle-api.ts`), it authorizes TWO ways then delegates to the
// boot-wired `run` closure (Task 7). It NEVER calls the promote functions directly: which promote
// path runs (mirror vs already-primary), the trading.env correction and the restart all live in
// `run`; this module only decides WHO may promote and hands `run` the operator's fence attestation.
//
// Two authorization paths, checked in this order:
//  - A `breakGlass` secret present in the body → the offline fallback (`verifyBreakGlass`), for when
//    the primary that held the admin's credentials is the very node that died. A wrong secret is
//    `promotion.break_glass_invalid` (401) and `run` is never reached.
//  - Otherwise the admin-login path — `loginManagerById` → `authorizeManager("node.promote")` →
//    `endManagementSession`, as `app_user` under `withTenant`, the `mirror-bundle-api.ts` shape.
//    `node.promote` is ADMIN-only, so a staff credential authenticates but fails authorization (403).
//  - Neither usable (no secret, and no well-formed id+password) → `password.invalid` (401), the same
//    code a wrong password gets, so the response never says which field was missing.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { authorizeManager, endManagementSession, loginManagerById } from "@waitron/identity";
import type { FenceAttestation } from "./promote.js";
import { verifyBreakGlass } from "./break-glass.js";
import { createErrorBoundary, readJsonBody } from "@waitron/server-kit";
import { isUuid } from "./till-session.js";
import type { Logger } from "./logger.js";

/**
 * What the boot-wired `run` closure reports back (Task 7 computes both). `alreadyPrimary` is the
 * idempotent no-op case (the node already held the singletons); `restarting` is true only for a real
 * mirror→primary promote, which reboots the box `mode=primary` — the operator UI polls for the node
 * to come back on that flag. The endpoint returns this object verbatim (spec §3); it needs no
 * `MirrorPromotionResult` (the reserved `seriesId` is `run`'s own concern).
 */
export interface PromoteRunResult {
  alreadyPrimary: boolean;
  restarting: boolean;
}

/**
 * `appDb` authenticates + authorizes (as `app_user` under `withTenant` + `asAppUser`, the
 * dashboard-login shape) AND backs `verifyBreakGlass`'s verifier read; `tenantId` scopes the auth
 * transaction. `run` is the boot-wired promote closure (Task 7) — the endpoint delegates to it and
 * never calls the promote functions itself.
 */
export interface PromoteApiDeps {
  appDb: Database;
  tenantId: string;
  /**
   * The boot-wired promote closure (Task 7). `ctx.breakGlass` carries the VERIFIED break-glass secret
   * when the operator authorized that way (Task 9) — the closure unwraps the dormant AEAT cert with it
   * inside the promote's point-of-no-return; the admin-login path passes an empty `ctx`.
   */
  run: (attestation: FenceAttestation, ctx: { breakGlass?: string }) => Promise<PromoteRunResult>;
}

/**
 * Every AppError CODE this route answers + its HTTP status (the management-api STATUS parallel).
 * Credential faults: a wrong/malformed/missing credential is 401 (`password.invalid`/`totp.invalid`),
 * a wrong break-glass secret 401 (`promotion.break_glass_invalid`); a suspended person or an
 * unauthorised role 403; an unknown person 404 (`loginManagerById` throws `person.not_found` for an id
 * with no row — no enumeration surface to hide on this trusted server-to-server path). The promote
 * codes come out of `run`: a missing fence attestation is a client fault (400,
 * `promotion.fence_not_attested`); a node its own chart marks fenced, or a chart superseded mid-promote,
 * is a conflict (409). A registered code absent here defaults to 400 via `run`; a non-AppError is an
 * opaque 500.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "password.invalid": 401,
  "totp.invalid": 401,
  "promotion.break_glass_invalid": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "person.not_found": 404,
  "promotion.fence_not_attested": 400,
  "promotion.node_fenced": 409,
  "promotion.membership_superseded": 409,
};

/**
 * Mounts `POST /management-api/promote` on an existing Hono app — the `mountMirrorBundleApi`
 * convention. `log` is optional (a boot always threads one; a unit mount may omit it) and defaults to
 * a no-op so `run` always has a sink.
 */
export function mountPromoteApi(app: Hono, deps: PromoteApiDeps, log: Logger = () => {}): void {
  const run = createErrorBoundary(STATUS, "promotion.failed");

  app.post("/management-api/promote", (c) =>
    run(c, log, async () => {
      // `readJsonBody` coerces an empty/malformed/`null` body to `{}` so a degenerate body falls
      // through to the credential screens (a specific 4xx) rather than an opaque 500.
      const body = await readJsonBody<{
        oldNodeNeutralised?: unknown;
        personId?: string;
        password?: string;
        totp?: string;
        breakGlass?: string;
      }>(c);

      // Authorize: the break-glass fallback if a secret is present, else the admin-login path. A
      // present break-glass secret is authoritative — it is never silently downgraded to the login
      // path, so a wrong secret is refused here rather than falling through to `password.invalid`.
      // The verified secret is threaded to `run` as `ctx.breakGlass` (Task 9): the boot closure
      // unwraps the dormant AEAT cert with it inside the promote's point-of-no-return.
      let verifiedBreakGlass: string | undefined;
      if (typeof body.breakGlass === "string") {
        if (!(await verifyBreakGlass(deps.appDb, body.breakGlass))) {
          throw new AppError("promotion.break_glass_invalid", {});
        }
        verifiedBreakGlass = body.breakGlass;
      } else if (
        typeof body.personId === "string" &&
        isUuid(body.personId) &&
        typeof body.password === "string" &&
        (body.totp === undefined || typeof body.totp === "string")
      ) {
        // The dashboard-login shape (`mirror-bundle-api.ts`): authenticate by PERSON ID, authorize the
        // admin-only `node.promote`, end the throwaway session — all as `app_user` in one transaction.
        // The `isUuid` screen turns a malformed id into this path's clean 401 rather than a `22P02` →
        // opaque 500 when it reaches the `uuid` column.
        const { personId, password, totp } = body;
        await withTenant(deps.appDb, deps.tenantId, async (tx) => {
          await asAppUser(tx);
          const session = await loginManagerById(tx, {
            tenantId: deps.tenantId,
            personId,
            password,
            totp,
          });
          await authorizeManager(tx, {
            managementSessionId: session.id,
            permission: "node.promote",
          });
          await endManagementSession(tx, session.id);
        });
      } else {
        // No usable credential — reported as `password.invalid` so the response never says which of
        // the missing/malformed fields failed.
        throw new AppError("password.invalid", {});
      }

      // Delegate to the boot-wired closure (Task 7). It computes `alreadyPrimary`/`restarting`, runs
      // the correct promote path, and either returns a result or throws a `promotion.*` code the
      // STATUS map above maps. The endpoint never calls the promote functions directly (spec §2).
      // The admin-login path passes an empty ctx; the break-glass path passes the verified secret.
      const ctx = verifiedBreakGlass === undefined ? {} : { breakGlass: verifiedBreakGlass };
      const result = await deps.run({ oldNodeNeutralised: body.oldNodeNeutralised === true }, ctx);
      return c.json(result);
    }),
  );
}
