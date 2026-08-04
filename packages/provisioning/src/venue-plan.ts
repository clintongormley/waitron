import { AppError } from "@waitron/shared";
import { WAITRON_ID_SISTEMA, resolveFiscalModules } from "./fiscal-modules.js";
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
}

export type VenueAction =
  | { kind: "ensure-tenant"; tenantId: string; country: string; taxId: string; legalName: string }
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
  const tenantId = obligadoTenantId(request.country, request.taxId);

  return [
    {
      kind: "ensure-tenant",
      tenantId,
      country: request.country,
      taxId: request.taxId,
      legalName: request.legalName,
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
