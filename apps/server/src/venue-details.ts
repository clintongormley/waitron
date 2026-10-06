import { eq, sql } from "drizzle-orm";
import { locations, tenants, type Transaction } from "@waitron/db";
import { findAdministrativeArea, findAdministrativeAreaByPostalCode } from "@waitron/country";
import { getCountryPack } from "@waitron/country-packs";
import { AppError } from "@waitron/shared";
import type {
  VenueDetailField,
  VenueDetailsModel,
  VenueDetailValues,
  VenueDetailWrite,
} from "./venue-detail-types.js";
import "./errors.js";

const fields: readonly VenueDetailField[] = [
  "name",
  "addressLine1",
  "addressLine2",
  "postalCode",
  "city",
  "province",
  "timeZone",
  "dayCutover",
];
const readOnly = new Set(["country", "legalName", "taxId", "locationId", "fiscalTerritory"]);
const nullable = new Set<VenueDetailField>([
  "addressLine1",
  "addressLine2",
  "postalCode",
  "city",
  "province",
]);

function invalid(field: string, reason: string): never {
  throw new AppError("venue.detail_invalid", { field, reason });
}
function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(field, "type");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (readOnly.has(key)) throw new AppError("venue.detail_read_only", { field: key });
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid(field, "unknown_field");
  }
}
function text(value: string): string {
  return value.normalize("NFC").trim();
}
function equivalent(field: VenueDetailField, value: string | null, country: string): string | null {
  if (value === null) return null;
  const normalized = text(value);
  if (field === "addressLine2" && normalized === "") return null;
  if (field === "province") {
    const pack = getCountryPack(country);
    return pack === undefined
      ? normalized
      : (findAdministrativeArea(pack, normalized)?.code ?? normalized);
  }
  if (field === "timeZone") {
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: normalized }).resolvedOptions().timeZone;
    } catch {
      return normalized;
    }
  }
  if (field === "dayCutover" && /^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(normalized))
    return normalized.slice(0, 5);
  return normalized;
}
export async function readVenueDetails(
  tx: Transaction,
  cfg: { locationId: string },
): Promise<VenueDetailsModel> {
  const [location] = await tx.select().from(locations).where(eq(locations.id, cfg.locationId));
  if (location === undefined)
    throw new AppError("management.request_invalid", { field: "locationId" });
  const [issuer] = await tx
    .select({ country: tenants.country, legalName: tenants.legalName, taxId: tenants.taxId })
    .from(tenants)
    .where(eq(tenants.id, 1));
  if (issuer === undefined)
    throw new AppError("management.request_invalid", { field: "locationId" });
  const pack = getCountryPack(issuer.country);
  const { rows } = await tx.execute<{ sales: number; orders: number; closes: number }>(sql`
    select exists(select 1 from sales limit 1) as sales,
      exists(select 1 from working_orders limit 1) as orders,
      exists(select 1 from daily_closes limit 1) as closes`);
  const history = rows[0]!;
  const clockReason = history.sales
    ? "sales"
    : history.orders
      ? "orders"
      : history.closes
        ? "daily_close"
        : undefined;
  const clockPolicy: VenueDetailsModel["policy"]["timeZone"] =
    clockReason === undefined
      ? { decision: "allow_with_warning", reasons: ["clock_effects"] }
      : { decision: "refuse", reasons: [clockReason] };
  return {
    details: {
      name: location.name,
      addressLine1: location.addressLine1,
      addressLine2: location.addressLine2,
      postalCode: location.postalCode,
      city: location.city,
      province: location.province,
      timeZone: location.timeZone,
      dayCutover: equivalent("dayCutover", location.dayCutover, issuer.country)!,
    },
    issuer,
    hasSales: Boolean(history.sales),
    hasOrderHistory: Boolean(history.orders),
    hasDailyClose: Boolean(history.closes),
    policy: {
      name: { decision: "allow_with_warning", reasons: ["current_details_only"] },
      addressLine1: { decision: "allow", reasons: [] },
      addressLine2: { decision: "allow", reasons: [] },
      city:
        pack === undefined
          ? { decision: "refuse", reasons: ["geography_context"] }
          : { decision: "allow_with_warning", reasons: ["holiday_geography"] },
      postalCode:
        pack === undefined ||
        (pack.administrativeAreas.length > 0 &&
          (location.province === null ||
            findAdministrativeArea(pack, location.province) === undefined))
          ? { decision: "refuse", reasons: ["geography_context"] }
          : { decision: "allow_with_warning", reasons: ["current_details_only"] },
      province: { decision: "refuse", reasons: [history.sales ? "sales" : "geography_context"] },
      timeZone: clockPolicy,
      dayCutover: clockPolicy,
    },
    provinces: pack?.administrativeAreas.map(({ code, name }) => ({ code, name })) ?? [],
  };
}
export async function writeVenueDetails(
  tx: Transaction,
  cfg: { locationId: string },
  input: VenueDetailWrite,
): Promise<{ changed: boolean; model: VenueDetailsModel }> {
  const body = object(input, "body");
  keys(body, ["changes", "expected"], "body");
  const changes = object(body.changes, "changes");
  const expected = object(body.expected, "expected");
  keys(changes, fields, "changes");
  keys(expected, fields, "expected");
  for (const field of fields) {
    if (!Object.hasOwn(expected, field)) invalid(field, "type");
    const value = expected[field];
    if (typeof value !== "string" && !(value === null && nullable.has(field)))
      invalid(field, "type");
  }
  const model = await readVenueDetails(tx, cfg);
  const delta: Partial<VenueDetailValues> = {};
  for (const field of fields) {
    if (!Object.hasOwn(changes, field)) continue;
    const value = changes[field];
    if (typeof value !== "string" && !(value === null && nullable.has(field)))
      invalid(field, "type");
    const typed = value as string | null;
    if (
      equivalent(field, typed, model.issuer.country) ===
      equivalent(field, model.details[field], model.issuer.country)
    )
      continue;
    let normalized: string | null = typed === null ? null : text(typed);
    if (field === "addressLine2" && normalized === "") normalized = null;
    if (field !== "addressLine2" && (normalized === null || normalized === ""))
      invalid(field, "required");
    if (
      normalized !== null &&
      ["name", "city", "addressLine1", "addressLine2"].includes(field) &&
      [...normalized].length > 200
    )
      invalid(field, "length");
    if (field === "timeZone") {
      try {
        normalized = new Intl.DateTimeFormat("en-GB", { timeZone: normalized! }).resolvedOptions()
          .timeZone;
      } catch {
        invalid(field, "time_zone");
      }
      if (/^[+-]/.test(normalized!)) invalid(field, "time_zone");
    }
    if (field === "dayCutover") {
      if (!/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(normalized!)) invalid(field, "cutover");
      normalized = normalized!.slice(0, 5);
    }
    if (field === "postalCode" || field === "province" || field === "city") {
      const pack = getCountryPack(model.issuer.country);
      if (pack === undefined) invalid(field, "country_unavailable");
      if (field === "province") {
        const area = findAdministrativeArea(pack, normalized!);
        if (area === undefined) invalid(field, "province");
        normalized = area.name;
      }
      if (field === "postalCode") {
        const result = pack.postalCode?.validate(normalized!);
        if (result !== undefined && !result.valid) invalid(field, "postcode");
        const province =
          model.details.province === null
            ? undefined
            : findAdministrativeArea(pack, model.details.province);
        if (pack.administrativeAreas.length > 0) {
          if (province === undefined)
            throw new AppError("venue.detail_locked", { field, reason: "geography_context" });
          if (findAdministrativeAreaByPostalCode(pack, normalized!)?.code !== province.code)
            invalid(field, "postcode");
        }
        if (result?.valid) normalized = result.normalized;
      }
    }
    if (
      equivalent(field, expected[field] as string | null, model.issuer.country) !==
      equivalent(field, model.details[field], model.issuer.country)
    )
      throw new AppError("venue.detail_changed", { field });
    if (field === "province" || field === "timeZone" || field === "dayCutover") {
      const reason = model.hasSales
        ? "sales"
        : field === "province"
          ? "geography_context"
          : model.hasOrderHistory
            ? "orders"
            : model.hasDailyClose
              ? "daily_close"
              : undefined;
      if (reason !== undefined) throw new AppError("venue.detail_locked", { field, reason });
    }
    Object.assign(delta, { [field]: normalized });
  }
  if (Object.keys(delta).length === 0) return { changed: false, model };
  const update = {
    ...delta,
    ...(delta.dayCutover === undefined ? {} : { dayCutover: `${delta.dayCutover}:00` }),
  };
  await tx.update(locations).set(update).where(eq(locations.id, cfg.locationId));
  return { changed: true, model: await readVenueDetails(tx, cfg) };
}
