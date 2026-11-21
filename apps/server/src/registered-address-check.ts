import type { CountryPack } from "@waitron/country";
import { registeredAddressErrors, registeredAddressParts } from "@waitron/country-packs";

/** The server's repeat of the browser's check on a registered address line: `incomplete` when the
 *  street, postcode or city is missing, `postal_code` when the postcode fails the pack's check.
 *  Without a postcode rule the line cannot be split back into its parts, so it is not checked. */
export function registeredAddressRefusal(
  line: string,
  pack: CountryPack,
): "incomplete" | "postal_code" | undefined {
  if (pack.postalCode === undefined) return undefined;
  const errors = Object.values(registeredAddressErrors(registeredAddressParts(line, pack), pack));
  if (errors.includes("required")) return "incomplete";
  return errors.length > 0 ? "postal_code" : undefined;
}
