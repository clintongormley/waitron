import { AppError } from "@waitron/shared";
import {
  WAITRON_ID_SISTEMA,
  assertUsableIdSistema,
  resolveFiscalModules,
} from "./fiscal-modules.js";
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
   * never a plaintext secret, so neither enters the plan or any action. */
  admin: { displayName: string; pinHash: string; passwordHash: string };
}

export type VenueAction =
  | { kind: "ensure-tenant"; tenantId: string; country: string; taxId: string; legalName: string }
  | { kind: "seed-admin"; displayName: string; pinHash: string; passwordHash: string }
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
  | { kind: "create-till"; name: string }
  | { kind: "create-node"; name: string; filingModule: string; taxModule: string }
  | { kind: "register-sif"; idSistemaInformatico: string }
  | { kind: "create-series"; code: string; purpose: "standard" | "rectificative" };

/**
 * Pure: request → the flat action list applyVenue runs, or a throw. Every refusal that can be made
 * without a database is made here (spec D4's input half, the locale cardinality the DB CHECK also
 * enforces), where a unit test reaches it without a container. Mirrors planInstance.
 *
 * The location/till/node ids are NOT in the actions: they are generated at apply time and threaded
 * by order (ensure-tenant sets the scope; create-location makes a location; create-node makes the
 * node the following actions reference). Only the tenant id is here, and it is DERIVED — so a
 * re-run reuses the same obligado under RLS without a tax_id lookup (spec D8).
 */
export function planVenue(request: VenueRequest): VenueAction[] {
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
  const modules = resolveFiscalModules(request.location.fiscalTerritory); // throws for unimplemented
  // The territory must belong to the tenant's country. Fiscal territories are country-prefixed
  // (`ES-common`, `ES-PV-bizkaia`, …), and applyVenue writes tax_id into `registro_sif.nif` (a
  // Spanish-NIF field), so `country=PT` + `ES-common` would file under a non-NIF identity — a
  // mis-filing under the wrong country that a hash-chained record cannot take back (spec §8). Checked
  // AFTER resolveFiscalModules so an unimplemented territory fails first with the more specific
  // `fiscal.regime_not_implemented`; refused here, in the pure planner, so no admin connection is
  // spent (spec D4). Case-insensitive on the prefix, so `es`/`ES` both match `ES-common`.
  if (
    !request.location.fiscalTerritory.toUpperCase().startsWith(`${request.country.toUpperCase()}-`)
  ) {
    throw new AppError("provisioning.territory_country_mismatch", {
      country: request.country,
      fiscalTerritory: request.location.fiscalTerritory,
    });
  }
  const tenantId = obligadoTenantId(request.country, request.taxId);

  // Defence-in-depth on an unrecoverable fiscal field. WAITRON_ID_SISTEMA is carried by the
  // register-sif action below and reaches `registro_sif.id_sistema_informatico` via applyVenue →
  // registerSif, where a wrong value could only be superseded by re-registration, never corrected.
  // The constant is "W1", so this never throws in normal operation; the guard is against a future
  // bad edit to the constant (throws provisioning.id_sistema_invalid — unit-tested in
  // fiscal-modules.test.ts), caught here on the production path before any DB connection is spent.
  assertUsableIdSistema(WAITRON_ID_SISTEMA);

  return [
    {
      kind: "ensure-tenant",
      tenantId,
      country: request.country,
      taxId: request.taxId,
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
      filingModule: modules.filing,
      taxModule: modules.tax,
    },
    { kind: "register-sif", idSistemaInformatico: WAITRON_ID_SISTEMA },
    { kind: "create-series", code: request.seriesCode, purpose: "standard" },
    { kind: "create-series", code: request.rectificativeSeriesCode, purpose: "rectificative" },
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
    case "create-location":
      return `create location ${action.name} in ${action.fiscalTerritory} (${action.invoiceLocales.join(", ")})`;
    case "create-till":
      return `create till ${action.name}`;
    case "create-node":
      return `create node ${action.name} filing=${action.filingModule} tax=${action.taxModule}`;
    case "register-sif":
      return `register the node as a SIF (id_sistema ${action.idSistemaInformatico})`;
    case "create-series":
      return `create ${action.purpose} series ${action.code}`;
  }
}
