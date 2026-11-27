import { ALL_MODULES } from "@waitron/composition";
import {
  findAdministrativeArea,
  findAdministrativeAreaByPostalCode,
  resolveFiscalJurisdiction,
  receiptLanguageRules,
  resolveCountryDemoIdentity,
} from "@waitron/country";
import { getVenueSetupCountryPack, resolveInstalledCountryLocale } from "@waitron/country-packs";
import type { DeploymentEnvironment } from "@waitron/db";
import type { FiscalContribution } from "@waitron/fiscal";
import {
  normalizeAndValidateEmail,
  MIN_PASSWORD_LENGTH,
  hashPin,
  hashPassword,
} from "@waitron/identity";
import {
  type VenueRequest,
  parseInitialVenueInput,
  venueFiscalSelection,
  validateVenueFields,
} from "@waitron/provisioning";
import { MIN_PIN_LENGTH, SUPPORTED_LOCALE_CODES, FALLBACK_LOCALE, AppError } from "@waitron/shared";
import type { PreparedSetupAdmin } from "./cloud-sign-in.js";
import { resolveLoginLocale } from "./login-locale.js";
import type { ProvisionRequest } from "./provision.js";
import { registeredAddressRefusal } from "./registered-address-check.js";
import { invalidRequest, asObject, asString, asNullableString } from "./setup-request-fields.js";
import "./errors.js";

/**
 * A person's real name. An ABSENT field reads as `null`, unlike `asNullableString`, which only
 * accepts an explicit null. A present one is TRIMMED, and a value with nothing left after trimming is
 * refused rather than stored: the column's check refuses an empty string, and identity's own write
 * boundary normalizes a name the same way (`requiredText`, packages/identity/src/staff.ts).
 */
function asOptionalName(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") invalidRequest(field);
  const trimmed = value.trim();
  if (trimmed === "") invalidRequest(field);
  return trimmed;
}
function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) invalidRequest(field);
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) invalidRequest(field);
  }
  return value as string[];
}
export function parseSetupAdmin(
  input: unknown,
  held?: PreparedSetupAdmin,
  checkCredentials = held !== undefined,
): PreparedSetupAdmin {
  const admin = asObject(input, "admin");
  const displayName = asString(admin.displayName, "admin.displayName");
  const firstNames = asOptionalName(admin.firstNames, "admin.firstNames");
  const lastNames = asOptionalName(admin.lastNames, "admin.lastNames");
  const email = normalizeAndValidateEmail(asString(admin.email, "admin.email"));
  const pin = held && admin.pin === "" ? undefined : asString(admin.pin, "admin.pin");
  const password =
    held && admin.password === "" ? undefined : asString(admin.password, "admin.password");
  if (checkCredentials) {
    if (pin !== undefined && (pin.length < MIN_PIN_LENGTH || Buffer.byteLength(pin) > 1024))
      invalidRequest("admin.pin");
    if (
      password !== undefined &&
      (password.length < MIN_PASSWORD_LENGTH || Buffer.byteLength(password) > 1024)
    )
      invalidRequest("admin.password");
  }
  return {
    displayName,
    firstNames,
    lastNames,
    email,
    pinHash: pin === undefined ? held!.pinHash : hashPin(pin),
    passwordHash: password === undefined ? held!.passwordHash : hashPassword(password),
  };
}
/**
 * Validate the request's venue fields and HASH the admin PIN + password at this
 * boundary into a `VenueRequest` — the plaintext secrets are read, hashed and discarded here, so they
 * never enter the plan or any action. The country pack repeats the browser's tax-id, postcode,
 * province and jurisdiction checks here and derives the persisted fiscal territory and time zone.
 */
export function parseVenue(
  venueRaw: unknown,
  acceptLanguage: string | undefined,
  heldAdmin?: PreparedSetupAdmin,
): VenueRequest {
  const v = asObject(venueRaw, "venue");
  const countryInput = asString(v.country, "country");
  const taxIdInput = asString(v.taxId, "taxId");
  const fiscalTerritoryInput = asString(v.fiscalTerritory, "fiscalTerritory");
  const invoiceLocales = asStringArray(v.invoiceLocales, "invoiceLocales");
  const staffLanguage = v.staffLanguage;
  if (staffLanguage !== undefined && staffLanguage !== "en" && staffLanguage !== "es")
    invalidRequest("staffLanguage");
  const postalCodeInput = asString(v.postalCode, "postalCode");
  const provinceInput = asString(v.province, "province");
  const timeZoneInput = asString(v.timeZone, "timeZone");

  const country = getVenueSetupCountryPack(countryInput);
  if (country === undefined) invalidRequest("country");

  const taxId = country.taxIdentifier?.validate(taxIdInput);
  if (taxId?.valid === false) invalidRequest("taxId");
  const postalCode = country.postalCode?.validate(postalCodeInput);
  if (postalCode?.valid === false) invalidRequest("postalCode");

  const area = findAdministrativeArea(country, provinceInput);
  if (country.administrativeAreas.length > 0 && area === undefined) {
    invalidRequest("province");
  }
  if (country.administrativeAreas.length > 0) {
    const postalArea =
      postalCode?.valid === true
        ? findAdministrativeAreaByPostalCode(country, postalCode.normalized)
        : undefined;
    if (postalArea === undefined || postalArea.code !== area?.code) {
      invalidRequest("province");
    }
  }

  const jurisdiction = resolveFiscalJurisdiction(country, area?.code);
  if (jurisdiction === undefined || !jurisdiction.supported || jurisdiction.modules === undefined) {
    invalidRequest("fiscalTerritory");
  }
  if (fiscalTerritoryInput !== jurisdiction.id) invalidRequest("fiscalTerritory");
  if (timeZoneInput !== (area?.timeZone ?? country.defaultTimeZone)) {
    invalidRequest("timeZone");
  }
  // One receipt language, among the pack's, and the region's own where it fixes one.
  const receipt = receiptLanguageRules(country, area?.code);
  const [receiptLanguage] = invoiceLocales;
  if (
    invoiceLocales.length !== 1 ||
    !receipt.choices.includes(receiptLanguage!) ||
    (receipt.fixed !== undefined && receiptLanguage !== receipt.fixed.locale)
  ) {
    invalidRequest("invoiceLocales");
  }

  // The admin's fallback locale is derived from the province as STORED, the same value
  // `readVenueLocale` reads back off the row at boot.
  const province = area?.name ?? provinceInput;

  return {
    country: country.countryCode,
    taxId: taxId?.valid === true ? taxId.normalized : taxIdInput,
    legalName: asString(v.legalName, "legalName"),
    taxpayerDomicile:
      v.taxpayerDomicile === undefined
        ? null
        : asNullableString(v.taxpayerDomicile, "taxpayerDomicile"),
    name: asString(v.name, "name"),
    fiscalTerritory: jurisdiction.id,
    invoiceLocales,
    ...(staffLanguage === undefined ? {} : { staffLanguage }),
    addressLine1: asString(v.addressLine1, "addressLine1"),
    addressLine2: asNullableString(v.addressLine2, "addressLine2"),
    postalCode: postalCode?.valid === true ? postalCode.normalized : postalCodeInput,
    city: asString(v.city, "city"),
    province,
    timeZone: area?.timeZone ?? country.defaultTimeZone,
    dayCutover: asString(v.dayCutover, "dayCutover"),
    seriesCode: asString(v.seriesCode, "seriesCode"),
    fullSeriesCode: asString(v.fullSeriesCode, "fullSeriesCode"),
    correctiveSeriesCode: asString(v.correctiveSeriesCode, "correctiveSeriesCode"),
    ...(v.fullCorrectiveSeriesCode === undefined
      ? {}
      : {
          fullCorrectiveSeriesCode: asString(
            v.fullCorrectiveSeriesCode,
            "fullCorrectiveSeriesCode",
          ),
        }),
    admin: {
      ...parseSetupAdmin(v.admin, heldAdmin),
      // The DISPLAY language, not the fiscal `invoiceLocales`. Never null: the till after a
      // PIN sign-in and account emails have no browser header to fall back to.
      locale: resolveLoginLocale(
        acceptLanguage,
        resolveInstalledCountryLocale(SUPPORTED_LOCALE_CODES, {
          area: province,
          country: country.countryCode,
          fallback: FALLBACK_LOCALE,
        }),
      ),
    },
  };
}
export async function parseProvisionPayload(
  parsed: unknown,
  hostEnvironment: DeploymentEnvironment,
  devMode: boolean,
  acceptLanguage: string | undefined,
  heldAdmin?: PreparedSetupAdmin,
): Promise<{
  mode: "demo" | "prepare" | "live";
  request: ProvisionRequest;
  contribution: FiscalContribution;
  secret: FiscalContribution["provisioningSecret"];
  secretExpected: boolean;
  rawSecret: unknown;
  errorReportsEnabled: boolean;
}> {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    invalidRequest("body");
  }
  const body = parsed as Record<string, unknown>;
  const initialOperations =
    body.initialOperations === undefined
      ? undefined
      : parseInitialVenueInput(body.initialOperations);
  if (initialOperations === null) invalidRequest("initialOperations");
  const mode = body.mode;
  if (mode !== "demo" && mode !== "prepare" && mode !== "live") invalidRequest("mode");
  const errorReports = body.errorReportsEnabled;
  if (errorReports !== undefined && (mode === "demo" || typeof errorReports !== "boolean"))
    invalidRequest("errorReportsEnabled");
  if (body.configurationImport !== undefined && typeof body.configurationImport !== "boolean") {
    invalidRequest("configurationImport");
  }
  if (body.configurationImport === true && mode !== "live") invalidRequest("configurationImport");
  if (body.newTaxpayer !== undefined && typeof body.newTaxpayer !== "boolean") {
    invalidRequest("newTaxpayer");
  }
  if (body.newTaxpayer === true && body.configurationImport !== true) invalidRequest("newTaxpayer");

  const nameSource = body.demoVenueNameSource;
  if (
    nameSource !== undefined &&
    (mode !== "demo" || (nameSource !== "automatic" && nameSource !== "custom"))
  ) {
    invalidRequest("demoVenueNameSource");
  }
  const parsedVenue = parseVenue(body.venue, acceptLanguage, heldAdmin);
  const pack = getVenueSetupCountryPack(parsedVenue.country)!;
  const identity =
    nameSource === "automatic" ? resolveCountryDemoIdentity(pack, parsedVenue.province) : undefined;
  const venue =
    identity === undefined
      ? parsedVenue
      : {
          ...parsedVenue,
          name: identity.venueName,
        };
  if (
    mode !== "demo" &&
    (!venue.taxpayerDomicile?.trim() ||
      registeredAddressRefusal(venue.taxpayerDomicile, pack) !== undefined)
  ) {
    invalidRequest("taxpayerDomicile");
  }
  const environment: DeploymentEnvironment =
    mode === "live" && !devMode ? "production" : "preproduction";
  const selection = venueFiscalSelection(ALL_MODULES, venue.fiscalTerritory);
  if (selection.contribution === undefined) invalidRequest("fiscalTerritory");
  const contribution = selection.contribution;
  // The regime's own rules on the typed fields, run before `provision` mints the chain so a refusal
  // leaves nothing behind and the operator fixes the field in the wizard rather than at the till.
  validateVenueFields(contribution, venue);
  const secret = contribution.provisioningSecret;
  const secretExpected = secret?.required(environment) ?? false;
  const present = body.aeatCert !== undefined;
  if (secretExpected && !present) {
    throw new AppError("setup.provisioning_secret_required", { module: contribution.id });
  }
  if (!secretExpected && present) invalidRequest("aeatCert");
  if (secretExpected) await secret!.validate(body.aeatCert, { taxId: venue.taxId });
  return {
    mode,
    request: {
      environment,
      venue,
      configurationImport: mode === "live" && body.configurationImport === true,
      newTaxpayer: mode === "live" && body.newTaxpayer === true,
      ...(initialOperations === undefined
        ? throwawayMarker(mode, devMode, hostEnvironment)
        : { initialOperations }),
    },
    contribution,
    secret,
    secretExpected,
    rawSecret: body.aeatCert,
    errorReportsEnabled: errorReports === true,
  };
}
function throwawayMarker(
  mode: "demo" | "prepare" | "live",
  devMode: boolean,
  hostEnvironment: DeploymentEnvironment,
): Pick<ProvisionRequest, "initialAllocation"> {
  return mode !== "live" || devMode
    ? { initialAllocation: { kind: "throwaway", hostEnvironment } }
    : {};
}
