import type { ValueValidator } from "./country.js";

export type RecipientIdentifierType =
  | "tax-number"
  | "vat-number"
  | "passport"
  | "residence-country-id"
  | "residence-certificate"
  | "other-document";

export interface RecipientIdentifier {
  taxId: string;
  identifierType?: RecipientIdentifierType;
  identifierCountryCode?: string;
}

export interface RecipientIdentifierPolicy {
  taxCountryCode: string;
  taxIdentifier: ValueValidator<string>;
  documentCountryCodes: readonly string[];
  documentTypesFor(countryCode: string): readonly RecipientIdentifierType[];
  documentMaxLength: number;
}

export type RecipientIdentifierResult =
  | { valid: true; value: RecipientIdentifier }
  | { valid: false; field: "taxId" | "identifierType" | "identifierCountryCode" };

const documentTypes: readonly string[] = [
  "vat-number",
  "passport",
  "residence-country-id",
  "residence-certificate",
  "other-document",
];

export function validateRecipientIdentifier(
  input: unknown,
  policy: RecipientIdentifierPolicy,
): RecipientIdentifierResult {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !("taxId" in input) ||
    typeof input.taxId !== "string" ||
    input.taxId.trim() === ""
  ) {
    return { valid: false, field: "taxId" };
  }
  const hasType = "identifierType" in input;
  const hasCountry = "identifierCountryCode" in input;
  if (!hasType && !hasCountry) {
    const checked = policy.taxIdentifier.validate(input.taxId);
    return checked.valid
      ? { valid: true, value: { taxId: checked.normalized } }
      : { valid: false, field: "taxId" };
  }
  if (
    !hasType ||
    typeof input.identifierType !== "string" ||
    (input.identifierType !== "tax-number" && !documentTypes.includes(input.identifierType))
  ) {
    return { valid: false, field: "identifierType" };
  }
  if (!hasCountry || typeof input.identifierCountryCode !== "string") {
    return { valid: false, field: "identifierCountryCode" };
  }
  const countryCode = input.identifierCountryCode.trim().toUpperCase();
  if (!policy.documentCountryCodes.includes(countryCode)) {
    return { valid: false, field: "identifierCountryCode" };
  }
  if (input.identifierType === "tax-number") {
    if (countryCode !== policy.taxCountryCode) {
      return { valid: false, field: "identifierType" };
    }
    const checked = policy.taxIdentifier.validate(input.taxId);
    return checked.valid
      ? { valid: true, value: { taxId: checked.normalized } }
      : { valid: false, field: "taxId" };
  }
  const identifierType = input.identifierType as RecipientIdentifierType;
  if (!policy.documentTypesFor(countryCode).includes(identifierType)) {
    return { valid: false, field: "identifierType" };
  }
  if (
    Array.from(input.taxId).length > policy.documentMaxLength ||
    !/^[\t\n\r\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]*$/u.test(input.taxId)
  ) {
    return { valid: false, field: "taxId" };
  }
  return {
    valid: true,
    value: { taxId: input.taxId, identifierType, identifierCountryCode: countryCode },
  };
}
