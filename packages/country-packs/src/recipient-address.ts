import { getCountryPack } from "./registry.js";
import { normalizeRecipientCountryCode } from "./recipient-countries.js";

export interface RecipientAddressDraft {
  countryCode: string;
  streetAddress: string;
  postalCode: string;
  locality: string;
  province: string;
}

export function recipientAddressErrors(
  draft: RecipientAddressDraft,
): Partial<Record<keyof RecipientAddressDraft, "required" | "invalid">> {
  const errors: Partial<Record<keyof RecipientAddressDraft, "required" | "invalid">> = {};
  const code = normalizeRecipientCountryCode(draft.countryCode);
  if (code === undefined)
    errors.countryCode = draft.countryCode.trim() === "" ? "required" : "invalid";
  if (draft.streetAddress.trim() === "") errors.streetAddress = "required";
  if (draft.locality.trim() === "") errors.locality = "required";
  if (code === "ES") {
    if (draft.postalCode.trim() === "") errors.postalCode = "required";
    else if (!getCountryPack("ES")!.postalCode!.validate(draft.postalCode).valid)
      errors.postalCode = "invalid";
    if (draft.province.trim() === "") errors.province = "required";
    if (!getCountryPack("ES")!.postalAddress!.isComplete(composeRecipientAddress(draft))) {
      if (draft.locality.includes(",")) errors.locality = "invalid";
      if (draft.province.includes(",")) errors.province = "invalid";
    }
  }
  return errors;
}

export function composeRecipientAddress(draft: RecipientAddressDraft): string {
  const place = [draft.postalCode.trim(), draft.locality.trim()].filter(Boolean).join(" ");
  return [draft.streetAddress.trim(), place, draft.province.trim()].filter(Boolean).join(", ");
}

/** The inverse of `composeRecipientAddress`: composing the result gives back `address` exactly. */
export function recipientAddressFields(
  address: string,
  countryCode: string,
): Omit<RecipientAddressDraft, "countryCode"> {
  const parts = address.split(", ");
  if (parts.length < 2)
    return { streetAddress: address, postalCode: "", locality: "", province: "" };
  const province = parts.length >= 3 ? parts.pop()! : "";
  const place = parts.pop()!;
  const space = place.indexOf(" ");
  const first = place.slice(0, space);
  const split =
    space > 0 && (normalizeRecipientCountryCode(countryCode) === "ES" || /\d/.test(first));
  return {
    streetAddress: parts.join(", "),
    postalCode: split ? first : "",
    locality: split ? place.slice(space + 1) : place,
    province,
  };
}
