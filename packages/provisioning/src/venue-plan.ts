import { AppError } from "@waitron/shared";
import { DEFAULT_DEVICE_PROFILES, defaultProfileName, type CapabilityFlag } from "@waitron/layouts";
import type { WaitronModule } from "@waitron/module";
import { resolveFiscalModules } from "./fiscal-modules.js";
import { obligadoTenantId } from "./tenant-id.js";
import "@waitron/fiscal"; // side-effect: registers fiscal.regime_not_implemented on ErrorParams
import "./errors.js"; // side-effect: registers provisioning.invalid_locales on ErrorParams

export interface VenueRequest {
  country: string;
  taxId: string;
  legalName: string;
  location: {
    name: string;
    fiscalTerritory: string;
    invoiceLocales: string[];
    operationDescription: string;
    addressLine1: string;
    addressLine2: string | null;
    postalCode: string;
    city: string;
    province: string;
    timeZone: string;
    dayCutover: string; // "HH:MM" or "HH:MM:SS"
  };
  tillName: string;
  seriesCode: string;
  rectificativeSeriesCode: string;
  /** The initial ADMIN person a freshly provisioned venue needs, so someone can log in and
   * authorize privileged actions from day one. Both secrets are already HASHED here (hashed at the CLI
   * boundary by `hashPin` / `hashPassword`) — `pinHash` for the till, `passwordHash` for the dashboard,
   * never a plaintext secret, so neither enters the plan or any action. `email` is the admin's
   * dashboard-login address, captured during onboarding; OPTIONAL because the CLI/dev-setup/e2e paths
   * seed an emailless admin, and validated/normalized at the setup-api boundary, not here. */
  admin: { displayName: string; pinHash: string; passwordHash: string; email?: string };
}

export type VenueAction =
  | { kind: "ensure-tenant"; tenantId: string; country: string; taxId: string; legalName: string }
  | {
      kind: "seed-admin";
      displayName: string;
      pinHash: string;
      passwordHash: string;
      email?: string;
    }
  | {
      kind: "create-location";
      name: string;
      fiscalTerritory: string;
      invoiceLocales: string[];
      operationDescription: string;
      addressLine1: string;
      addressLine2: string | null;
      postalCode: string;
      city: string;
      province: string;
      timeZone: string;
      dayCutover: string;
    }
  | {
      // Non-fiscal. Seeds the tenant's starter device profiles (Counter/Kitchen/Handheld), authored
      // under an admin management session (so seed-admin must precede it). Touches no series/SIF/chain.
      // Names are already resolved to the venue's primary invoice locale here in the pure planner;
      // capabilities are the form-factor defaults from DEFAULT_DEVICE_PROFILES.
      kind: "seed-device-profiles";
      profiles: { name: string; capabilities: CapabilityFlag[] }[];
    }
  | { kind: "create-till"; name: string }
  | { kind: "create-node"; name: string; filingModule: string; taxModule: string }
  | { kind: "create-series"; code: string; purpose: "standard" | "rectificative" }
  /** Runs `modules[module].provisioning.seed` inside the venue transaction, after every core row.
   * `summary` is the seed's own one-line description, so the plan summary reads without the list. */
  | { kind: "seed-module"; module: string; summary: string };

/**
 * Pure: request → the flat action list applyVenue runs, or a throw. Every refusal that can be made
 * without a database is made here (spec D4's input half, the locale cardinality the DB CHECK also
 * enforces), where a unit test reaches it without a container. Mirrors planInstance.
 *
 * The location/till/node ids are NOT in the actions: they are generated at apply time and threaded
 * by order (ensure-tenant sets the scope; create-location makes a location; create-node makes the
 * node the following actions reference). Only the tenant id is here, and it is DERIVED — so a
 * re-run reuses the same obligado by its deterministic id without a tax_id lookup (spec D8).
 */
export function planVenue(request: VenueRequest, modules: readonly WaitronModule[]): VenueAction[] {
  // Canonicalize the fiscal identity ONCE, at the top, and use these values for BOTH the derived id
  // AND the stored `tenants (country, tax_id)` row. This is the functional fix for the §5 footgun:
  // both provisioning paths go through here — the wizard (setup-api → provisionVenue) emits a
  // trimmed-but-not-uppercased country ("es") and never touches taxId casing, and the CLI trims
  // taxId but never uppercases it (its `assertCountry` already upper-cases country, now belt-and-
  // suspenders). Deriving the id from a raw casing, OR storing a raw (country, tax_id) row, would let
  // `es`/`ES` (or a taxId that differs only in letter case or in leading/trailing whitespace) for the
  // same business mint a second, permanent, unmergeable obligado — a re-run meant to add a shop would
  // silently start a second SIF/hash chain. `.trim().toUpperCase()` collapses exactly those two
  // differences; INTERNAL whitespace is deliberately left alone (a taxId's inner content is not ours
  // to alter), so `"B123 45678"` stays a distinct identity. Canonicalizing makes the id AND the
  // unique-index row match across case/surrounding-space variants, so applyVenue's `on conflict
  // (country, tax_id) do nothing` reuses the one obligado. No data to preserve (pre-production, no
  // backfill); ISO-3166 alpha-2 is upper-case by convention.
  const country = request.country.trim().toUpperCase();
  const taxId = request.taxId.trim().toUpperCase();
  const locales = request.location.invoiceLocales;
  if (locales.length < 1 || locales.length > 2) {
    throw new AppError("provisioning.invalid_locales", { count: locales.length });
  }
  // Equal codes collide on the series natural key (tenant, node, code): applyVenue's
  // `ON CONFLICT DO NOTHING` would drop the second series, leaving the venue unable to issue
  // rectificative invoices. Refuse here so no admin connection is spent on a malformed request.
  if (request.seriesCode === request.rectificativeSeriesCode) {
    throw new AppError("provisioning.duplicate_series_code", { code: request.seriesCode });
  }
  const fiscal = resolveFiscalModules(request.location.fiscalTerritory); // throws for unimplemented
  // The territory must belong to the tenant's country. Fiscal territories are country-prefixed
  // (`ES-common`, `ES-PV-bizkaia`, …), and applyVenue writes tax_id into `registro_sif.nif` (a
  // Spanish-NIF field), so `country=PT` + `ES-common` would file under a non-NIF identity — a
  // mis-filing under the wrong country that a hash-chained record cannot take back (spec §8). Checked
  // AFTER resolveFiscalModules so an unimplemented territory fails first with the more specific
  // `fiscal.regime_not_implemented`; refused here, in the pure planner, so no admin connection is
  // spent (spec D4). Case-insensitive on the prefix, so `es`/`ES` both match `ES-common`.
  if (!request.location.fiscalTerritory.toUpperCase().startsWith(`${country}-`)) {
    throw new AppError("provisioning.territory_country_mismatch", {
      country,
      fiscalTerritory: request.location.fiscalTerritory,
    });
  }
  const tenantId = obligadoTenantId(country, taxId);

  return [
    {
      kind: "ensure-tenant",
      tenantId,
      country,
      taxId,
      legalName: request.legalName,
    },
    // A person needs only the tenant scope, so the admin is seeded immediately after ensure-tenant,
    // before the location. `pinHash` is already a hash (hashed at the CLI boundary); no plaintext PIN
    // ever reaches an action.
    {
      kind: "seed-admin",
      displayName: request.admin.displayName,
      pinHash: request.admin.pinHash,
      passwordHash: request.admin.passwordHash,
      email: request.admin.email,
    },
    // Seed the starter device-profile set right after the admin: createDeviceProfile authorises a
    // `till.configure` management session, which only the just-seeded admin can open. Names are
    // resolved HERE to the venue's primary invoice locale (locales[0]); a re-provision is made
    // idempotent (find-or-create by name) in applyVenue. Non-fiscal, so it precedes create-location.
    {
      kind: "seed-device-profiles",
      profiles: DEFAULT_DEVICE_PROFILES.map((profile) => ({
        name: defaultProfileName(profile, locales[0]!),
        capabilities: profile.capabilities,
      })),
    },
    {
      kind: "create-location",
      name: request.location.name,
      fiscalTerritory: request.location.fiscalTerritory,
      invoiceLocales: locales,
      operationDescription: request.location.operationDescription,
      addressLine1: request.location.addressLine1,
      addressLine2: request.location.addressLine2,
      postalCode: request.location.postalCode,
      city: request.location.city,
      province: request.location.province,
      timeZone: request.location.timeZone,
      dayCutover: request.location.dayCutover,
    },
    { kind: "create-till", name: request.tillName },
    {
      kind: "create-node",
      name: request.location.name,
      filingModule: fiscal.filing,
      taxModule: fiscal.tax,
    },
    { kind: "create-series", code: request.seriesCode, purpose: "standard" },
    { kind: "create-series", code: request.rectificativeSeriesCode, purpose: "rectificative" },
    // Module seeds run LAST, once every core row exists, one per declaring module in list order.
    ...modules.flatMap((m) =>
      m.provisioning?.seed === undefined
        ? []
        : [{ kind: "seed-module", module: m.name, summary: m.provisioning.seed.summary } as const],
    ),
  ];
}

/** One action as a line an operator can check in the plan summary. Mirrors describeAction. */
export function describeVenueAction(action: VenueAction): string {
  switch (action.kind) {
    case "ensure-tenant":
      return `ensure tenant ${action.country}/${action.taxId} (${action.legalName})`;
    case "seed-admin":
      // The admin's NAME only — never the pin hash. This line goes into the plan summary an operator
      // reads, and the hash is a secret (§ SECRET DISCIPLINE).
      return `seed admin ${action.displayName}`;
    case "seed-device-profiles":
      return `seed device profiles ${action.profiles.map((p) => p.name).join(", ")}`;
    case "create-location":
      return `create location ${action.name} in ${action.fiscalTerritory} (${action.invoiceLocales.join(", ")})`;
    case "create-till":
      return `create till ${action.name}`;
    case "create-node":
      return `create node ${action.name} filing=${action.filingModule} tax=${action.taxModule}`;
    case "create-series":
      return `create ${action.purpose} series ${action.code}`;
    case "seed-module":
      return `seed module ${action.module}: ${action.summary}`;
  }
}
