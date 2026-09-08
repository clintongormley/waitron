// The two management-API endpoints for the AEAT certificate (cert-distribution §3): `/unlock` opens
// the dormant standby copy with the break-glass secret, and the bare POST installs or REPLACES the
// live cert (doubling as the renewal path). Both are PRIMARY-ONLY: they mount on the same management
// surface `mountPromoteApi` does, so a mirror's read-only gate refuses the write verb with
// `node.read_only` BEFORE the handler — there is no gate exemption for either (unlike `/promote`).
//
// Authorization differs by route, mirroring the promote endpoint's two shapes:
//  - `/unlock` takes NO admin login — the break-glass secret IS the authorization (`verifyBreakGlass`),
//    for the operator who is opening the dormant cert out-of-band on an already-primary node. A wrong
//    secret is `promotion.break_glass_invalid` (401) and the dormant row is never touched.
//  - the install POST takes the admin-login path (`loginManagerById` → `authorizeManager` →
//    `endManagementSession`, as `app_user` under `withTenant` + `asAppUser`) authorizing
//    `fiscal.configure` — admin-only (permissions.test.ts), so a staff/manager credential authenticates
//    but fails authorization (403). The regime seat (`validateFreshCert`/`sealFreshCert`) validates and
//    seals the cert; boot wires it from the enabled fiscal contribution, so this module names no regime.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import { authorizeManager, endManagementSession, loginManagerById } from "@waitron/identity";
import { createErrorBoundary, readJsonBody } from "@waitron/server-kit";
import { verifyBreakGlass } from "./break-glass.js";
import { deleteDormantCert, sealLiveCertTx, unwrapDormantCert } from "./fiscal-cert.js";
import { isUuid } from "./till-session.js";
import type { Logger } from "./logger.js";

/**
 * `appDb` authenticates + authorizes (as `app_user` under `withTenant` + `asAppUser`) AND backs
 * `verifyBreakGlass`'s read and the dormant-cert unwrap SELECT; `tenantId` scopes both transactions.
 * `withOwnerDb` hands a short-lived OWNER connection for the two writes to `tenant_credentials` the app
 * role holds no grant for — sealing the live cert and deleting a corrupt dormant row — matching boot's
 * per-call owner pool (a trading box keeps only the app pool open). `validateFreshCert`/`sealFreshCert`
 * are the enabled fiscal regime's provisioning-secret seat, wired by boot so this module imports no
 * regime package: `validate` refuses a malformed cert WITHOUT any write, `seal` validates + seals
 * `fiscal.aeat` in its own owner transaction.
 */
export interface FiscalCertApiDeps {
  appDb: Database;
  ring: KeyRing;
  tenantId: string;
  withOwnerDb: <T>(run: (ownerDb: Database) => Promise<T>) => Promise<T>;
  validateFreshCert: (raw: unknown) => void;
  sealFreshCert: (tenantId: string, raw: unknown) => Promise<void>;
}

/**
 * Every AppError code these two routes answer + its HTTP status (the management-api STATUS parallel).
 * `/unlock`: a wrong break-glass secret is 401; a missing dormant copy or a copy the secret cannot open
 * is a state conflict (409). Install: a malformed cert is a request-shape fault (400,
 * `setup.request_invalid`, the same code the regime seat throws); the admin-login codes are the
 * promote-api set — a wrong/malformed/missing credential 401, a suspended person or unauthorised role
 * 403, an unknown person 404. A non-AppError is an opaque `server.internal` 500 under the log tag below.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "promotion.break_glass_invalid": 401,
  "fiscal.certificate_dormant_missing": 409,
  "fiscal.certificate_unlock_failed": 409,
  "setup.request_invalid": 400,
  "password.invalid": 401,
  "totp.invalid": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "person.not_found": 404,
};

/**
 * Mounts the two cert endpoints on an existing Hono app — the `mountPromoteApi` convention. `log`
 * defaults to a no-op so a unit mount may omit it (boot always threads one).
 */
export function mountFiscalCertApi(
  app: Hono,
  deps: FiscalCertApiDeps,
  log: Logger = () => {},
): void {
  const run = createErrorBoundary(STATUS, "fiscal.certificate_failed");

  // POST /management-api/fiscal-certificate/unlock — break-glass unlock of the dormant standby cert.
  app.post("/management-api/fiscal-certificate/unlock", (c) =>
    run(c, log, async () => {
      // `readJsonBody` coerces an empty/malformed/`null` body to `{}` so a degenerate body falls through
      // to the break-glass screen (a 401) rather than an opaque 500. A present break-glass secret is
      // authoritative — a wrong one is refused here, never falling through to another path.
      const body = await readJsonBody<{ breakGlass?: unknown }>(c);
      if (
        typeof body.breakGlass !== "string" ||
        !(await verifyBreakGlass(deps.appDb, body.breakGlass))
      ) {
        throw new AppError("promotion.break_glass_invalid", {});
      }
      const secret = body.breakGlass;

      // Unwrap on the APP pool (the dormant SELECT is a read the app role holds), never throwing:
      // `"absent"` (no standby cert) and `"corrupt"` (the verified secret will not open the envelope)
      // are distinct operator faults, not a 500.
      const material = await withTenant(deps.appDb, deps.tenantId, (tx) =>
        unwrapDormantCert(tx, deps.ring, deps.tenantId, secret),
      );
      if (material === "absent") {
        throw new AppError("fiscal.certificate_dormant_missing", { tenantId: deps.tenantId });
      }
      if (material === "corrupt") {
        // Delete the corrupt dormant row so a later re-store is clean, then report the failure. The
        // delete needs the owner pool (the app role holds no DELETE on `tenant_credentials`).
        await deps.withOwnerDb((ownerDb) =>
          withTenant(ownerDb, deps.tenantId, (tx) => deleteDormantCert(tx, deps.tenantId)),
        );
        throw new AppError("fiscal.certificate_unlock_failed", { tenantId: deps.tenantId });
      }

      // Seal the live `fiscal.aeat` cert the drain files with, on the owner pool. The dormant row is
      // left in place (as the promote path does): `readCertStatus` reports "live", the live row winning.
      await deps.withOwnerDb((ownerDb) =>
        withTenant(ownerDb, deps.tenantId, (tx) =>
          sealLiveCertTx(tx, deps.ring, deps.tenantId, material),
        ),
      );
      log("info", "fiscal.certificate_unlocked", { tenantId: deps.tenantId });
      return c.json({ unlocked: true });
    }),
  );

  // POST /management-api/fiscal-certificate — admin-authorized install/replace (the renewal path).
  app.post("/management-api/fiscal-certificate", (c) =>
    run(c, log, async () => {
      const body = await readJsonBody<{
        personId?: unknown;
        password?: unknown;
        totp?: unknown;
        aeatCert?: unknown;
      }>(c);

      // A degenerate/missing credential is reported as `password.invalid` so the response never says
      // which field was missing. The `isUuid` screen turns a malformed id into this clean 401 rather
      // than a `22P02` → opaque 500 when it reaches the `uuid` column (the promote-api shape).
      if (
        typeof body.personId !== "string" ||
        !isUuid(body.personId) ||
        typeof body.password !== "string" ||
        (body.totp !== undefined && typeof body.totp !== "string")
      ) {
        throw new AppError("password.invalid", {});
      }
      const { personId, password, totp } = body;

      // The dashboard-login shape: authenticate by PERSON ID, authorize the admin-only
      // `fiscal.configure`, end the throwaway session — all as `app_user` in one transaction. A
      // manager/staff credential authenticates but fails `authorizeManager` (403).
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
          permission: "fiscal.configure",
        });
        await endManagementSession(tx, session.id);
      });

      // Validate the cert's SHAPE BEFORE sealing so a malformed blob 400s (`setup.request_invalid`
      // naming the field, never its value) with NOTHING sealed. `sealFreshCert` re-validates as
      // defense-in-depth and writes `fiscal.aeat` in its own owner transaction.
      deps.validateFreshCert(body.aeatCert);
      await deps.sealFreshCert(deps.tenantId, body.aeatCert);
      log("info", "fiscal.certificate_installed", { tenantId: deps.tenantId });
      return c.json({ installed: true });
    }),
  );
}
