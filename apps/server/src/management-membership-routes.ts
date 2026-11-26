import type { KeyRing } from "@waitron/credentials";
import { withTransaction, readNodeMembership } from "@waitron/db";
import {
  checkManagerPassword,
  loginManagerById,
  withInspectorAdmitted,
  authorizeManager,
  endManagementSession,
} from "@waitron/identity";
import type { Logger } from "@waitron/server-kit";
import { AppError, isUuid } from "@waitron/shared";
import type { Hono } from "hono";
import type { ManagementApiDeps } from "./management-api-deps.js";
import { run } from "./management-api-errors.js";

export function mountManagementMembershipRoutes(
  app: Hono,
  deps: ManagementApiDeps,
  log: Logger,
  credentialKeyRing: KeyRing,
): void {
  // A peer fetches this node's signed membership chart (`null` when none was adopted). The caller
  // re-verifies the signature regardless. The credential rides in a header because a GET carries no
  // body. Every malformed credential is `password.invalid`,
  // so the response does not say which field failed. The session authorizes this read alone and is
  // ended in the same transaction; no cookie is set.
  app.get("/management-api/membership", (c) =>
    run(c, log, async () => {
      const raw = c.req.header("x-waitron-peer-credential");
      let credential: { personId?: string; password?: string; totp?: string } = {};
      if (raw !== undefined) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new AppError("password.invalid", {}, { reason: "invalid_json" });
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new AppError("password.invalid", {}, { reason: "malformed" });
        }
        credential = parsed as { personId?: string; password?: string; totp?: string };
      }
      if (
        typeof credential.personId !== "string" ||
        !isUuid(credential.personId) ||
        typeof credential.password !== "string" ||
        (credential.totp !== undefined && typeof credential.totp !== "string")
      ) {
        throw new AppError("password.invalid", {}, { reason: "malformed" });
      }
      const { personId, password, totp } = credential;
      const checked = await checkManagerPassword(deps.db, { personId }, password);
      await withTransaction(deps.db, async (tx) => {
        const session = await loginManagerById(tx, {
          personId,
          password,
          totp,
          totpKeyRing: credentialKeyRing,
          checked,
        });
        await withInspectorAdmitted(() =>
          authorizeManager(tx, { managementSessionId: session.token, permission: "node.manage" }),
        );
        await endManagementSession(tx, session.token, "operation_finished");
      });
      const document = await readNodeMembership(deps.db);
      return c.json({ document });
    }),
  );
}
