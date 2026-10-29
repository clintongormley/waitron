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
  }
  return errors;
}

export function composeRecipientAddress(draft: RecipientAddressDraft): string {
  const place = [draft.postalCode.trim(), draft.locality.trim()].filter(Boolean).join(" ");
  return [draft.streetAddress.trim(), place, draft.province.trim()].filter(Boolean).join(", ");
}
