import "./errors.js";
import type { Context, Hono } from "hono";
import { eq } from "drizzle-orm";
import { locations, nodes, readTenant, type Database, type Transaction } from "@waitron/db";
import { authorizeManager, persons, resolveManagementSession } from "@waitron/identity";
import {
  personalDataParts,
  preparePersonalData,
  type PersonalDataPart,
  type WaitronModule,
} from "@waitron/module";
import { readPrivacyContact } from "@waitron/provisioning";
import { civilDateOf } from "@waitron/reporting";
import { AppError, isUuid, resolveActiveLocale } from "@waitron/shared";
import { createErrorBoundary, requireManagementSession } from "@waitron/server-kit";
import { archiveFileName, zipArchive } from "./download-archive.js";
import { resolveLoginLocale } from "./login-locale.js";
import type { Logger } from "./logger.js";
import { personalDataReadme } from "./personal-data-readme.js";
import { knownZone } from "./venue-time-zone.js";

export interface PersonalDataExportDeps {
  db: Database;
  nodeId: string;
  modules: readonly WaitronModule[];
  /** Parts the server adds itself. */
  serverParts: readonly PersonalDataPart[];
  venueLocale: string;
  now?: () => Date;
}
export type PersonalDataAuthorize = (
  tx: Transaction,
) => Promise<{ personId: string; label: string; language: "en" | "es" }>;

export const withPersonalDataErrors = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "person.not_found": 404,
    "invoice_customer.not_found": 404,
    "node.read_only": 403,
    "module.config_invalid": 500,
  },
  "personal_data.failed",
);

export const toLanguage = (locale: string): "en" | "es" => (locale.startsWith("es-") ? "es" : "en");

export async function venuePlace(tx: Transaction, nodeId: string) {
  const [row] = await tx
    .select({ locationId: nodes.locationId, timeZone: locations.timeZone })
    .from(nodes)
    .innerJoin(locations, eq(locations.id, nodes.locationId))
    .where(eq(nodes.id, nodeId));
  if (row === undefined) return { locationId: null, timeZone: "UTC" };
  return { locationId: row.locationId, timeZone: knownZone(row.timeZone) };
}

/** Does not catch: wrap the call in `withPersonalDataErrors`. */
export async function sendPersonalData(
  c: Context,
  deps: PersonalDataExportDeps,
  authorize: PersonalDataAuthorize,
): Promise<Response> {
  const at = (deps.now ?? (() => new Date()))();
  const parts = [...personalDataParts(deps.modules), ...deps.serverParts];
  // Write-lock turns, not `withTransaction`: its closing change-log drain is a write a full disk
  // refuses even though this route changes nothing. A stated exception to one `withTransaction` per
  // route.
  const tx = deps.db;
  const snapshot = await deps.db.withWriteLock(async () => {
    const who = await authorize(tx);
    const place = await venuePlace(tx, deps.nodeId);
    const tenant = await readTenant(tx);
    const privacyNoticeUrl = (await readPrivacyContact(tx))?.privacyNoticeUrl ?? null;
    const build = await preparePersonalData(tx, parts, {
      personId: who.personId,
      language: who.language,
      at,
      ...place,
    });
    return { who, place, tenant, privacyNoticeUrl, build };
  });
  // Building outlives the snapshot turn, so authority is checked again before any bytes go.
  const files = await snapshot.build();
  await deps.db.withWriteLock(async () => {
    const again = await authorize(tx);
    if (again.personId !== snapshot.who.personId)
      throw new Error("personal-data authorisation named a different person after building");
  });
  const readme = personalDataReadme({
    language: snapshot.who.language,
    venue: snapshot.tenant?.legalName ?? null,
    person: snapshot.who.label,
    date: civilDateOf(at, snapshot.place.timeZone),
    ...(snapshot.privacyNoticeUrl === null ? {} : { privacyNoticeUrl: snapshot.privacyNoticeUrl }),
    files: files.map((f) => f.name),
  });
  const body = zipArchive([{ name: "README.txt", content: readme }, ...files], at);
  c.header("Content-Type", "application/zip");
  c.header(
    "Content-Disposition",
    `attachment; filename="${archiveFileName(snapshot.who.label, at, snapshot.place.timeZone)}"`,
  );
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  return c.body(body);
}

export function mountPersonalDataExportApi(
  app: Hono,
  deps: PersonalDataExportDeps,
  log: Logger,
): void {
  app.get("/management-api/me/personal-data/export", (c) =>
    withPersonalDataErrors(c, log, () => {
      const token = requireManagementSession(c);
      const hasQuery = new URL(c.req.url).search !== "";
      const browserLocale = resolveLoginLocale(c.req.header("Accept-Language"), deps.venueLocale);
      return sendPersonalData(c, deps, async (tx) => {
        const viewer = await resolveManagementSession(tx, token, { touch: false });
        if (hasQuery) throw new AppError("management.request_invalid", { field: "query" });
        // The rule the dashboard uses to pick its own language, so the README matches the screen.
        const locale = resolveActiveLocale(viewer.locale, browserLocale);
        return {
          personId: viewer.personId,
          label: viewer.displayName,
          language: toLanguage(locale),
        };
      });
    }),
  );

  app.get("/management-api/staff/:id/personal-data/export", (c) =>
    withPersonalDataErrors(c, log, () => {
      const token = requireManagementSession(c);
      const hasQuery = new URL(c.req.url).search !== "";
      const id = c.req.param("id");
      return sendPersonalData(c, deps, async (tx) => {
        // Permission before the id: a caller without it gets one answer for any id, real or not.
        await authorizeManager(tx, {
          managementSessionId: token,
          permission: "personal_data.export",
          touch: false,
        });
        if (hasQuery) throw new AppError("management.request_invalid", { field: "query" });
        if (!isUuid(id)) throw new AppError("person.not_found", { personId: id });
        const [target] = await tx
          .select({ id: persons.id, displayName: persons.displayName, locale: persons.locale })
          .from(persons)
          .where(eq(persons.id, id));
        if (target === undefined) throw new AppError("person.not_found", { personId: id });
        // The target's language, not the admin's browser: the README is addressed to them.
        const locale = resolveActiveLocale(target.locale, deps.venueLocale);
        return { personId: target.id, label: target.displayName, language: toLanguage(locale) };
      });
    }),
  );
}
