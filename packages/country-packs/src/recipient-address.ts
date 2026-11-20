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

/** Fields that `composeRecipientAddress` turns back into `address`, trimmed; they need not be the
 * fields the address was composed from. */
export function recipientAddressFields(
  address: string,
  countryCode: string,
): Omit<RecipientAddressDraft, "countryCode"> {
  const whole = { streetAddress: address, postalCode: "", locality: "", province: "" };
  const parts = address.split(", ");
  if (parts.length < 2) return whole;
  const province = parts.length >= 3 ? parts.pop()! : "";
  const place = parts.pop()!;
  const words = /^(\S+) (\S.*)$/su.exec(place);
  const split =
    words !== null && (normalizeRecipientCountryCode(countryCode) === "ES" || /\d/.test(words[1]!));
  const fields = {
    streetAddress: parts.join(", "),
    postalCode: split ? words[1]! : "",
    locality: split ? words[2]! : place,
    province,
  };
  return composeRecipientAddress({ ...fields, countryCode }) === address.trim() ? fields : whole;
}
