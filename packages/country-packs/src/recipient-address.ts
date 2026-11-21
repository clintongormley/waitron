import { getCountryPack } from "./registry.js";
import { normalizeRecipientCountryCode } from "./recipient-countries.js";
import { firstWordAndRest, trailingProvince } from "./address-line.js";
import { joinRegisteredAddress } from "./registered-address.js";

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
  return joinRegisteredAddress({
    street: draft.streetAddress,
    line2: "",
    postalCode: draft.postalCode,
    city: draft.locality,
    province: draft.province,
  });
}

/** Fields that `composeRecipientAddress` turns back into `address`, trimmed; they need not be the
 * fields the address was composed from. */
export function recipientAddressFields(
  address: string,
  countryCode: string,
): Omit<RecipientAddressDraft, "countryCode"> {
  const whole = { streetAddress: address, postalCode: "", locality: "", province: "" };
  const code = normalizeRecipientCountryCode(countryCode);
  const pack = code === undefined ? undefined : getCountryPack(code);
  const named = pack === undefined ? undefined : trailingProvince(address.trim(), pack);
  const parts = (named?.rest ?? address).split(", ");
  if (named === undefined && parts.length < 2) return whole;
  const province = named?.province ?? (parts.length >= 3 ? parts.pop()! : "");
  const place = parts.pop()!;
  const words = firstWordAndRest(place);
  const split = words !== undefined && (code === "ES" || /\d/.test(words.first));
  const fields = {
    streetAddress: parts.join(", "),
    postalCode: split ? words.first : "",
    locality: split ? words.rest : place,
    province,
  };
  return composeRecipientAddress({ ...fields, countryCode }) === address.trim() ? fields : whole;
}
