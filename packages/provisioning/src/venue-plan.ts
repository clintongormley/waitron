import { AppError, assertSupportedLocale } from "@waitron/shared";
import {
  DEFAULT_DEVICE_PROFILES,
  defaultProfileName,
  type CapabilityFlag,
  type FormFactor,
} from "@waitron/layouts";
import type { WaitronModule } from "@waitron/module";
import { resolveFiscalModules } from "./fiscal-modules.js";
import "@waitron/fiscal"; // side-effect: registers fiscal.regime_not_implemented on ErrorParams
import "./errors.js"; // side-effect: registers provisioning.invalid_locales on ErrorParams

/** The four ids that name a mirror's venue for `trading.env` — the shape a mirror bundle
 * designates. */
export interface AdoptResult {
  locationId: string;
  tillId: string;
  nodeId: string;
  seriesId: string;
}

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
  /** The initial admin. Both secrets arrive already hashed (`hashPin` / `hashPassword`), so no
   * plaintext secret enters the plan. */
  admin: {
    displayName: string;
    pinHash: string;
    passwordHash: string;
    email: string;
    firstNames?: string | null;
    lastNames?: string | null;
    /** The person's own UI language. Null or absent leaves them on the venue default. Not
     * `location.invoiceLocales`, which decides the language an invoice is printed in. */
    locale?: string | null;
  };
}

export type VenueAction =
  | { kind: "ensure-tenant"; country: string; taxId: string; legalName: string }
  | {
      kind: "seed-admin";
      displayName: string;
      // Not optional here, unlike on the request: the planner resolves "not given" to `null`, the
      // value the columns' `is null or length > 0` checks accept.
      firstNames: string | null;
      lastNames: string | null;
      locale: string | null;
      pinHash: string;
      passwordHash: string;
      email: string;
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
      // Needs seed-admin first: the profiles are authored under the admin's management session.
      kind: "seed-device-profiles";
      profiles: {
        name: string;
        formFactor: FormFactor;
        capabilities: CapabilityFlag[];
        inactivityTimeoutSeconds: number | null;
      }[];
    }
  | { kind: "create-till"; name: string }
  | { kind: "create-node"; name: string; filingModule: string; taxModule: string }
  | { kind: "create-series"; code: string; purpose: "standard" | "rectificative" }
  /** Runs `modules[module].provisioning.seed` inside the venue transaction, after every core row.
   * `summary` is the seed's own one-line description, so the plan summary reads without the list. */
  | { kind: "seed-module"; module: string; summary: string };

/**
 * Pure: request → the flat action list applyVenue runs, or a throw.
 *
 * No ids are in the actions: they are generated at apply time and threaded by order.
 */
export function planVenue(request: VenueRequest, modules: readonly WaitronModule[]): VenueAction[] {
  // Canonicalized here, for every caller, because `assertNoForeignTenant` compares the stored
  // `tenants (country, tax_id)` byte-for-byte: a raw `es`/`ES` or stray surrounding space would
  // refuse a same-venue retry as a foreign taxpayer. Internal whitespace is deliberately left
  // alone: a tax id's inner content is not ours to alter.
  const country = request.country.trim().toUpperCase();
  const taxId = request.taxId.trim().toUpperCase();
  const locales = request.location.invoiceLocales;
  if (locales.length < 1 || locales.length > 2) {
    throw new AppError("provisioning.invalid_locales", { count: locales.length });
  }
  // Equal codes collide on the series key (node, code), so applyVenue would drop the second series
  // and leave the venue unable to issue rectificative invoices.
  if (request.seriesCode === request.rectificativeSeriesCode) {
    throw new AppError("provisioning.duplicate_series_code", { code: request.seriesCode });
  }
  const fiscal = resolveFiscalModules(request.location.fiscalTerritory); // throws for unimplemented
  // The territory must belong to the tenant's country: applyVenue writes tax_id into
  // `registro_sif.nif` (a Spanish-NIF field), so `country=PT` + `ES-common` would file under a
  // non-NIF identity, a mis-filing that a hash-chained record cannot take back. Checked after
  // resolveFiscalModules so an unimplemented territory fails first with the more specific code.
  if (!request.location.fiscalTerritory.toUpperCase().startsWith(`${country}-`)) {
    throw new AppError("provisioning.territory_country_mismatch", {
      country,
      fiscalTerritory: request.location.fiscalTerritory,
    });
  }
  // `persons.locale` only refuses an empty string, so a code the apps have no catalogue for would
  // be stored. `setPersonLocale` refuses one too.
  const adminLocale =
    request.admin.locale == null ? null : assertSupportedLocale(request.admin.locale);

  return [
    {
      kind: "ensure-tenant",
      country,
      taxId,
      legalName: request.legalName,
    },
    {
      kind: "seed-admin",
      displayName: request.admin.displayName,
      firstNames: request.admin.firstNames ?? null,
      lastNames: request.admin.lastNames ?? null,
      locale: adminLocale,
      pinHash: request.admin.pinHash,
      passwordHash: request.admin.passwordHash,
      email: request.admin.email,
    },
    {
      kind: "seed-device-profiles",
      profiles: DEFAULT_DEVICE_PROFILES.map((profile) => ({
        name: defaultProfileName(profile, locales[0]!),
        formFactor: profile.formFactor,
        capabilities: profile.capabilities,
        inactivityTimeoutSeconds: profile.inactivityTimeoutSeconds ?? null,
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
    // Module seeds run LAST, once every core row exists.
    ...modules.flatMap((m) =>
      m.provisioning?.seed === undefined
        ? []
        : [{ kind: "seed-module", module: m.name, summary: m.provisioning.seed.summary } as const],
    ),
  ];
}

/** One action as a line an operator can check in the plan summary. */
export function describeVenueAction(action: VenueAction): string {
  switch (action.kind) {
    case "ensure-tenant":
      return `ensure tenant ${action.country}/${action.taxId} (${action.legalName})`;
    case "seed-admin": {
      // Never a hash: this line is shown to the operator.
      const realName = [action.firstNames, action.lastNames].filter(Boolean).join(" ");
      const details = [realName, action.locale].filter(Boolean).join(", ");
      return details === ""
        ? `seed admin ${action.displayName}`
        : `seed admin ${action.displayName} (${details})`;
    }
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
