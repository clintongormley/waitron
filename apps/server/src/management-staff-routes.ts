import { type Transaction, withTransaction } from "@waitron/db";
import {
  queueInvitation,
  listAccessRoles,
  setPersonAccessRoles,
  listPersonsPage,
  listPersons,
  authorizeManager,
  requireFreshManagementSignIn,
  invitePerson,
  authorizePersonLoginChange,
  updatePersonDetails,
  clearPersonPin,
  deactivatePerson,
  requireLoginEmail,
  resetPersonLogin,
  reactivatePersonForInvitation,
} from "@waitron/identity";
import {
  type Logger,
  requireManagementSession,
  readJsonBody,
  requireEnum,
} from "@waitron/server-kit";
import { isUuid, AppError, SUPPORTED_LOCALE_CODES } from "@waitron/shared";
import type { Hono, Context } from "hono";
import type { ManagementApiDeps } from "./management-api-deps.js";
import { run } from "./management-api-errors.js";
import type { managementSite } from "./request-from-box.js";

async function queueInvitationAnswer(
  tx: Transaction,
  deps: ManagementApiDeps,
  input: { managementSessionId: string; personId: string; origin: string },
) {
  await deps.assertAccountMailPrimary?.();
  const mode = (await deps.accountMailMode?.(tx)) ?? "unconfigured";
  if (mode === "unconfigured")
    return { invitationSent: false, problem: "email.unconfigured", uncertain: false };
  await queueInvitation(tx, input);
  return { invitationSent: true, delivery: mode === "local_capture" ? "captured" : "queued" };
}

function requirePersonId(id: string): string {
  if (!isUuid(id)) throw new AppError("person.not_found", { personId: id });
  return id;
}

export function mountManagementStaffRoutes(
  app: Hono,
  deps: ManagementApiDeps,
  log: Logger,
  passkeySite: (c: Context) => ReturnType<typeof managementSite>,
  acceptInvitation: (personId: string) => boolean,
): void {
  app.get("/management-api/access-roles", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(await withTransaction(deps.db, (tx) => listAccessRoles(tx, sessionId)));
    }),
  );

  app.put("/management-api/staff/:id/access-roles", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const personId = requirePersonId(c.req.param("id"));
      const body = await readJsonBody<{ roleIds?: unknown; expectedRoleIds?: unknown }>(c);
      for (const field of ["roleIds", "expectedRoleIds"] as const) {
        if (!Array.isArray(body[field]) || body[field].some((id) => typeof id !== "string"))
          throw new AppError("management.request_invalid", { field });
      }
      return c.json(
        await withTransaction(deps.db, (tx) =>
          setPersonAccessRoles(tx, {
            managementSessionId,
            personId,
            roleIds: body.roleIds as string[],
            expectedRoleIds: body.expectedRoleIds as string[],
          }),
        ),
      );
    }),
  );

  app.get("/management-api/staff/page", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const params = new URL(c.req.url).searchParams;
      const allowed = ["page", "search", "roleId", "status", "sortKey", "sortDirection", "locale"];
      for (const key of params.keys()) {
        if (!allowed.includes(key) || (key !== "roleId" && params.getAll(key).length !== 1))
          throw new AppError("management.request_invalid", { field: key });
      }
      const rawPage = params.get("page") ?? "0";
      const page = Number(rawPage);
      if (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(page * 50))
        throw new AppError("management.request_invalid", { field: "page" });
      const roleIds = params.getAll("roleId");
      if (roleIds.some((id) => !isUuid(id)))
        throw new AppError("management.request_invalid", { field: "roleId" });
      const query = {
        page,
        search: params.get("search") ?? "",
        roleIds: [...new Set(roleIds.map((id) => id.toLowerCase()))],
        status: requireEnum(params.get("status") ?? "current", "status", [
          "current",
          "all",
          "active",
          "pending",
          "suspended",
        ]),
        sortKey: requireEnum(params.get("sortKey") ?? "displayName", "sortKey", [
          "",
          "displayName",
          "legalName",
          "role",
          "email",
          "telephone",
          "status",
        ]),
        sortDirection: requireEnum(params.get("sortDirection") ?? "ascending", "sortDirection", [
          "ascending",
          "descending",
        ]),
        locale: requireEnum(params.get("locale") ?? "en-GB", "locale", SUPPORTED_LOCALE_CODES),
      };
      return c.json(
        await withTransaction(deps.db, (tx) =>
          listPersonsPage(tx, { managementSessionId: sessionId, ...query }),
        ),
      );
    }),
  );

  app.get("/management-api/staff", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const people = await withTransaction(deps.db, async (tx) => {
        return listPersons(tx, { managementSessionId: sessionId });
      });
      return c.json(people);
    }),
  );

  // The person and its queued invitation commit together.
  app.post("/management-api/staff", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{
        displayName?: string;
        firstNames?: string;
        lastNames?: string;
        telephone?: string | null;
        roleIds?: unknown;
        email?: string;
      }>(c);
      if (
        typeof body.displayName !== "string" ||
        typeof body.firstNames !== "string" ||
        typeof body.lastNames !== "string" ||
        !Array.isArray(body.roleIds) ||
        body.roleIds.some((id) => typeof id !== "string") ||
        (body.telephone !== undefined &&
          body.telephone !== null &&
          typeof body.telephone !== "string")
      ) {
        throw new AppError("management.request_invalid", {
          field: "displayName|firstNames|lastNames|roleIds|telephone",
        });
      }
      if (typeof body.email !== "string") {
        throw new AppError("management.request_invalid", { field: "email" });
      }
      const { displayName, firstNames, lastNames, telephone = null, email } = body;

      const { created, delivery } = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, { managementSessionId: sessionId, permission: "person.admin" });
        await deps.assertAccountMailPrimary?.();
        await requireFreshManagementSignIn(tx, sessionId);
        const created = await invitePerson(tx, {
          managementSessionId: sessionId,
          displayName,
          firstNames,
          lastNames,
          telephone,
          roleIds: body.roleIds as string[],
          email,
        });
        const delivery = await queueInvitationAnswer(tx, deps, {
          managementSessionId: sessionId,
          personId: created.id,
          origin: passkeySite(c).origin,
        });
        return { created, delivery };
      });
      return c.json({ ...created, ...delivery }, 201);
    }),
  );

  app.post("/management-api/staff/:id/invitation", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const personId = requirePersonId(c.req.param("id"));
      await withTransaction(deps.db, async (tx) => {
        await authorizePersonLoginChange(tx, { managementSessionId: sessionId, personId });
        await deps.assertAccountMailPrimary?.();
        await requireFreshManagementSignIn(tx, sessionId);
      });
      if (!acceptInvitation(personId)) {
        return c.json({ invitationSent: false });
      }
      const delivery = await withTransaction(deps.db, async (tx) => {
        await authorizePersonLoginChange(tx, { managementSessionId: sessionId, personId });
        await requireFreshManagementSignIn(tx, sessionId);
        return queueInvitationAnswer(tx, deps, {
          managementSessionId: sessionId,
          personId,
          origin: passkeySite(c).origin,
        });
      });
      return c.json(delivery);
    }),
  );

  app.put("/management-api/staff/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const personId = requirePersonId(c.req.param("id"));
      const body = await readJsonBody<{
        displayName?: unknown;
        firstNames?: unknown;
        lastNames?: unknown;
        telephone?: unknown;
        email?: unknown;
        status?: unknown;
        locale?: unknown;
      }>(c);
      for (const field of ["displayName", "firstNames", "lastNames", "email"] as const) {
        if (typeof body[field] !== "string") {
          throw new AppError("management.request_invalid", { field });
        }
      }
      if (body.telephone !== null && typeof body.telephone !== "string") {
        throw new AppError("management.request_invalid", { field: "telephone" });
      }
      if (body.locale !== undefined && body.locale !== null && typeof body.locale !== "string")
        throw new AppError("management.request_invalid", { field: "locale" });
      const status = requireEnum(body.status, "status", ["pending", "active", "suspended"]);
      await withTransaction(deps.db, async (tx) => {
        await updatePersonDetails(tx, {
          managementSessionId: sessionId,
          personId,
          displayName: body.displayName as string,
          firstNames: body.firstNames as string,
          lastNames: body.lastNames as string,
          telephone: body.telephone as string | null,
          email: body.email as string,
          status,
          locale: body.locale as string | null | undefined,
        });
      });
      return c.body(null, 204);
    }),
  );

  // The person chooses the replacement PIN in their own profile; an administrator never handles it.
  app.post("/management-api/staff/:id/reset-pin", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requirePersonId(c.req.param("id"));
      await withTransaction(deps.db, async (tx) => {
        await clearPersonPin(tx, { managementSessionId: sessionId, personId: id });
      });
      return c.body(null, 204);
    }),
  );

  app.post("/management-api/staff/:id/deactivate", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const personId = requirePersonId(c.req.param("id"));
      await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, { managementSessionId: sessionId, permission: "person.admin" });
        await requireFreshManagementSignIn(tx, sessionId);
        await deactivatePerson(tx, { managementSessionId: sessionId, personId });
      });
      return c.body(null, 204);
    }),
  );

  app.post("/management-api/staff/:id/reset-login", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const personId = requirePersonId(c.req.param("id"));
      const delivery = await withTransaction(deps.db, async (tx) => {
        await authorizePersonLoginChange(tx, { managementSessionId: sessionId, personId });
        await deps.assertAccountMailPrimary?.();
        await requireFreshManagementSignIn(tx, sessionId);
        await requireLoginEmail(tx, { personId, change: "reset-login" });
        await resetPersonLogin(tx, { managementSessionId: sessionId, personId });
        if (!acceptInvitation(personId)) return { invitationSent: false };
        return queueInvitationAnswer(tx, deps, {
          managementSessionId: sessionId,
          personId,
          origin: passkeySite(c).origin,
        });
      });
      return c.json(delivery);
    }),
  );

  app.post("/management-api/staff/:id/reactivate", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const personId = requirePersonId(c.req.param("id"));
      await withTransaction(deps.db, async (tx) => {
        await authorizePersonLoginChange(tx, { managementSessionId: sessionId, personId });
        await deps.assertAccountMailPrimary?.();
        await requireFreshManagementSignIn(tx, sessionId);
        await requireLoginEmail(tx, { personId, change: "reactivate" });
      });
      if (!acceptInvitation(personId)) {
        return c.json({ invitationSent: false });
      }
      const delivery = await withTransaction(deps.db, async (tx) => {
        await authorizePersonLoginChange(tx, { managementSessionId: sessionId, personId });
        await requireFreshManagementSignIn(tx, sessionId);
        await reactivatePersonForInvitation(tx, { managementSessionId: sessionId, personId });
        return queueInvitationAnswer(tx, deps, {
          managementSessionId: sessionId,
          personId,
          origin: passkeySite(c).origin,
        });
      });
      return c.json(delivery);
    }),
  );
}
