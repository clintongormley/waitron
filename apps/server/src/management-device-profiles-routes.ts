import { type Transaction, printers, withTransaction } from "@waitron/db";
import {
  type ProfileAdmission,
  readProfileAdmissions,
  authorizeManager,
  setProfileAdmission,
} from "@waitron/identity";
import {
  type ProfilePrinterLists,
  FORM_FACTORS,
  type DeviceProfileRow,
  listDeviceProfiles,
  getDeviceProfileWithPrinters,
  createDeviceProfile,
  emptyPrinterLists,
  readProfilePrinterLists,
  updateDeviceProfile,
  deleteDeviceProfile,
} from "@waitron/layouts";
// Error declaration for the `printer.not_found` code in `requireListedPrinters`.
import "@waitron/printing";
import {
  requireBodyUuid,
  requireNullableBodyUuid,
  requireEnum,
  type Logger,
  requireManagementSession,
  readJsonBody,
} from "@waitron/server-kit";
import { isUuid, AppError, int4InRange } from "@waitron/shared";
import { and, inArray, isNull } from "drizzle-orm";
import type { Hono, Context } from "hono";
import { parseProfileKitchenScreens } from "./device.js";
import type { ManagementApiDeps } from "./management-api-deps.js";
import { run, runBodyPrinters } from "./management-api-errors.js";
import { VENUE_SERVICE } from "./modules.js";

function requireDeviceProfileId(id: string): string {
  if (!isUuid(id)) throw new AppError("device_profile.not_found", {});
  return id;
}
/**
 * Shape only: absent or `null` is `null`; otherwise an integer number in int4 range. The domain rule
 * is `validateInactivityTimeout`'s (`@waitron/layouts`), which the store applies.
 */
function parseInactivityTimeoutSeconds(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!int4InRange(value))
    throw new AppError("management.request_invalid", { field: "inactivityTimeoutSeconds" });
  return value;
}
/**
 * The id lists `fields` names, each an array of distinct uuids; an absent one is left out, and any
 * other value is refused `management.request_invalid` naming the field.
 */
function parseIdLists<F extends string>(
  body: Partial<Record<F, unknown>>,
  fields: readonly F[],
): Partial<Record<F, string[]>> {
  const lists: Partial<Record<F, string[]>> = {};
  for (const field of fields) {
    const value = body[field];
    if (value === undefined) continue;
    if (!Array.isArray(value)) throw new AppError("management.request_invalid", { field });
    const ids = value.map((id) => requireBodyUuid(id, field));
    if (new Set(ids).size !== ids.length)
      throw new AppError("management.request_invalid", { field });
    lists[field] = ids;
  }
  return lists;
}
const PRINTER_DEFAULT_FIELDS = [
  "receiptPrinterDefaultId",
  "paymentSlipPrinterDefaultId",
  "cashDrawerPrinterDefaultId",
  "invoicePrinterDefaultId",
] as const;
/** The printer lists and defaults the body names; an absent one is left out, `null` is None. */
function parsePrinterLists(body: ProfileBody): Partial<ProfilePrinterLists> {
  const lists: Partial<ProfilePrinterLists> = parseIdLists(body, [
    "receiptPrinterIds",
    "paymentSlipPrinterIds",
    "cashDrawerPrinterIds",
    "invoicePrinterIds",
  ]);
  for (const field of PRINTER_DEFAULT_FIELDS) {
    if (body[field] !== undefined) lists[field] = requireNullableBodyUuid(body[field], field);
  }
  return lists;
}
/** The settings every profile POST and PUT must carry, checked for shape. */
function parseProfileSettings(body: ProfileBody) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("management.request_invalid", { field: "body" });
  }
  if (typeof body.name !== "string") {
    throw new AppError("management.request_invalid", { field: "name" });
  }
  if (!("capabilities" in body)) {
    throw new AppError("management.request_invalid", { field: "capabilities" });
  }
  return {
    name: body.name,
    capabilities: body.capabilities,
    inactivityTimeoutSeconds: parseInactivityTimeoutSeconds(body.inactivityTimeoutSeconds),
    formFactor: requireEnum(body.formFactor, "formFactor", FORM_FACTORS),
  };
}
type ProfileBody = {
  name?: unknown;
  formFactor?: unknown;
  capabilities?: unknown;
  inactivityTimeoutSeconds?: unknown;
  startingScreen?: unknown;
  receiptPrinterIds?: unknown;
  paymentSlipPrinterIds?: unknown;
  cashDrawerPrinterIds?: unknown;
  receiptPrinterDefaultId?: unknown;
  paymentSlipPrinterDefaultId?: unknown;
  cashDrawerPrinterDefaultId?: unknown;
  invoicePrinterIds?: unknown;
  invoicePrinterDefaultId?: unknown;
  kitchenScreens?: unknown;
  departmentId?: unknown;
  allowedZoneIds?: unknown;
  startingZoneId?: unknown;
  admittedStaffRoleIds?: unknown;
};
type ProfileScope = {
  departmentId: string | null;
  allowedZoneIds: string[] | null;
  startingZoneId: string | null;
};
/** The scope fields the body names; each one it omits is left out, and null is kept as null. */
function parseProfileScope(body: ProfileBody): Partial<ProfileScope> {
  const scope: Partial<ProfileScope> = {};
  const { departmentId, allowedZoneIds, startingZoneId } = body;
  if (departmentId !== undefined)
    scope.departmentId =
      departmentId === null ? null : requireBodyUuid(departmentId, "departmentId");
  if (allowedZoneIds !== undefined)
    scope.allowedZoneIds =
      allowedZoneIds === null ? null : parseIdLists(body, ["allowedZoneIds"]).allowedZoneIds!;
  if (startingZoneId !== undefined)
    scope.startingZoneId =
      startingZoneId === null ? null : requireBodyUuid(startingZoneId, "startingZoneId");
  return scope;
}
function parseProfileAdmission(body: ProfileBody): Partial<ProfileAdmission> {
  return parseIdLists(body, ["admittedStaffRoleIds"]);
}
/** Each profile row with where it serves and who may sign in on it, as last saved. */
async function withProfileAccess(
  tx: Transaction,
  rows: readonly DeviceProfileRow[],
): Promise<(DeviceProfileRow & ProfileScope & ProfileAdmission)[]> {
  const ids = rows.map((row) => row.id);
  const scopes = await VENUE_SERVICE.readProfileServiceScopes(tx, ids);
  const admissions = await readProfileAdmissions(tx, ids);
  return rows.map((row, index) => {
    const scope = scopes[index]!;
    const admission = admissions[index]!;
    return {
      ...row,
      departmentId: scope.departmentId,
      allowedZoneIds: scope.allowedZoneIds,
      startingZoneId: scope.startingZoneId,
      admittedStaffRoleIds: admission.admittedStaffRoleIds,
    };
  });
}
/**
 * Refuses a listed or default printer that does not exist or is deleted, after the manager gate so
 * a session without `venue.configure` learns nothing about printer ids. Only the invoice list and
 * default may name a page printer. The store's own writes authorize again.
 */
async function requireListedPrinters(
  tx: Transaction,
  sessionId: string,
  lists: Partial<ProfilePrinterLists>,
): Promise<void> {
  const defaultInvoicePrinter = lists.invoicePrinterDefaultId;
  const invoiceIds = [
    ...new Set([
      ...(lists.invoicePrinterIds ?? []),
      ...(defaultInvoicePrinter == null ? [] : [defaultInvoicePrinter]),
    ]),
  ];
  const ids = [
    ...new Set([
      ...(lists.receiptPrinterIds ?? []),
      ...(lists.paymentSlipPrinterIds ?? []),
      ...(lists.cashDrawerPrinterIds ?? []),
      ...PRINTER_DEFAULT_FIELDS.filter((field) => field !== "invoicePrinterDefaultId").flatMap(
        (field) => lists[field] ?? [],
      ),
    ]),
  ];
  if (ids.length === 0 && invoiceIds.length === 0) return;
  await authorizeManager(tx, { managementSessionId: sessionId, permission: "venue.configure" });
  const all = [...new Set([...ids, ...invoiceIds])];
  // The invoice list may include both kinds.
  const found = await tx
    .select({ id: printers.id, kind: printers.kind })
    .from(printers)
    .where(and(inArray(printers.id, all), isNull(printers.deletedAt)));
  const kinds = new Map(found.map((row) => [row.id, row.kind]));
  const missing =
    ids.find((id) => kinds.get(id) !== "receipt") ?? invoiceIds.find((id) => !kinds.has(id));
  if (missing !== undefined) throw new AppError("printer.not_found", { id: missing });
}

export function mountManagementDeviceProfileRoutes(
  app: Hono,
  deps: ManagementApiDeps,
  log: Logger,
): void {
  // ── Device profiles ──
  // Each read route carries its own gate; the write functions authorize
  // themselves.
  app.get("/management-api/device-profiles", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const deviceProfiles = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "venue.configure",
        });
        return withProfileAccess(tx, await listDeviceProfiles(tx));
      });
      return c.json({ deviceProfiles });
    }),
  );

  app.get("/management-api/device-profile-kitchen-screens", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const profiles = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "venue.configure",
        });
        return VENUE_SERVICE.readProfileKitchenScreens(tx);
      });
      return c.json({ profiles });
    }),
  );

  app.get("/management-api/device-profiles/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireDeviceProfileId(c.req.param("id"));
      const profile = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "venue.configure",
        });
        const row = await getDeviceProfileWithPrinters(tx, id);
        return row === undefined ? undefined : (await withProfileAccess(tx, [row]))[0];
      });
      if (profile === undefined) throw new AppError("device_profile.not_found", {});
      return c.json(profile);
    }),
  );

  const createProfile = (c: Context, sourcePathId?: string) =>
    runBodyPrinters(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const sourceId =
        sourcePathId === undefined ? undefined : requireDeviceProfileId(sourcePathId);
      const body = await readJsonBody<ProfileBody>(c);
      const { name, capabilities, formFactor, inactivityTimeoutSeconds } =
        parseProfileSettings(body);
      const lists = parsePrinterLists(body);
      const kitchenScreens = parseProfileKitchenScreens(body.kitchenScreens);
      const scope = parseProfileScope(body);
      const admission = parseProfileAdmission(body);
      const result = await withTransaction(deps.db, async (tx) => {
        if (sourceId !== undefined) {
          await authorizeManager(tx, {
            managementSessionId: sessionId,
            permission: "venue.configure",
          });
          if ((await getDeviceProfileWithPrinters(tx, sourceId)) === undefined)
            throw new AppError("device_profile.not_found", {});
        }
        await requireListedPrinters(tx, sessionId, lists);
        const created = await createDeviceProfile(tx, {
          managementSessionId: sessionId,
          name,
          formFactor,
          capabilities,
          inactivityTimeoutSeconds,
          startingScreen: body.startingScreen,
          printerLists: { ...emptyPrinterLists(), ...lists },
        });
        await VENUE_SERVICE.setProfileServiceScope(tx, created.id, scope);
        if (sourceId !== undefined)
          await VENUE_SERVICE.copyProfileKitchenScreens(tx, sourceId, created.id);
        else if (kitchenScreens !== undefined)
          await VENUE_SERVICE.setProfileKitchenScreens(tx, created.id, kitchenScreens);
        if (sourceId !== undefined && admission.admittedStaffRoleIds === undefined)
          admission.admittedStaffRoleIds = (
            await readProfileAdmissions(tx, [sourceId])
          )[0]!.admittedStaffRoleIds;
        await setProfileAdmission(tx, created.id, admission);
        return (await withProfileAccess(tx, [created]))[0];
      });
      return c.json(result, 201);
    });
  app.post("/management-api/device-profiles", (c) => createProfile(c));
  app.post("/management-api/device-profiles/:id/copy", (c) => createProfile(c, c.req.param("id")));

  // An omitted `inactivityTimeoutSeconds` stores null. These stay as
  // they were when omitted: the starting screen, a printer list, the kitchen screens, the job-role
  // ticks and each of the department, the zones and the starting zone.
  app.put("/management-api/device-profiles/:id", (c) =>
    runBodyPrinters(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireDeviceProfileId(c.req.param("id"));
      const body = await readJsonBody<ProfileBody>(c);
      const { name, capabilities, formFactor, inactivityTimeoutSeconds } =
        parseProfileSettings(body);
      const lists = parsePrinterLists(body);
      const kitchenScreens = parseProfileKitchenScreens(body.kitchenScreens);
      const scope = parseProfileScope(body);
      const admission = parseProfileAdmission(body);
      const result = await withTransaction(deps.db, async (tx) => {
        await requireListedPrinters(tx, sessionId, lists);
        const printerLists =
          Object.keys(lists).length === 0
            ? undefined
            : { ...(await readProfilePrinterLists(tx, id)), ...lists };
        const updated = await updateDeviceProfile(tx, {
          managementSessionId: sessionId,
          id,
          name,
          formFactor,
          capabilities,
          inactivityTimeoutSeconds,
          startingScreen: body.startingScreen,
          printerLists,
        });
        await VENUE_SERVICE.setProfileServiceScope(tx, id, scope);
        if (kitchenScreens !== undefined)
          await VENUE_SERVICE.setProfileKitchenScreens(tx, id, kitchenScreens);
        await setProfileAdmission(tx, id, admission);
        return (await withProfileAccess(tx, [updated]))[0]!;
      });
      return c.json(result);
    }),
  );

  app.delete("/management-api/device-profiles/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireDeviceProfileId(c.req.param("id"));
      await withTransaction(deps.db, async (tx) => {
        await deleteDeviceProfile(tx, {
          managementSessionId: sessionId,
          id,
        });
      });
      return c.body(null, 204);
    }),
  );
}
