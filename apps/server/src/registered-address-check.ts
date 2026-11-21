import type { CountryPack } from "@waitron/country";
import { registeredAddressErrors, registeredAddressParts } from "@waitron/country-packs";

/** `incomplete` when the street, postcode or city cannot be read from the line (a malformed
 *  postcode is not read as one), `postal_code` when the postcode lies outside the province the line
 *  names. Without a postcode rule the line cannot be split into its parts, so it is not checked. */
export function registeredAddressRefusal(
  line: string,
  pack: CountryPack,
): "incomplete" | "postal_code" | undefined {
  if (pack.postalCode === undefined) return undefined;
  const errors = Object.values(registeredAddressErrors(registeredAddressParts(line, pack), pack));
  if (errors.includes("required")) return "incomplete";
  return errors.length > 0 ? "postal_code" : undefined;
}
