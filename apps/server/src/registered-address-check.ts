import type { CountryPack } from "@waitron/country";
import { registeredLineErrors } from "@waitron/country-packs";

/** `incomplete` when the street, postcode or city cannot be read from the line (a malformed
 *  postcode is not read as one), `postcode` when the postcode lies outside the province the line
 *  names. Without a postcode rule the line cannot be split into its parts, so it is not checked. */
export function registeredAddressRefusal(
  line: string,
  pack: CountryPack,
): "incomplete" | "postcode" | undefined {
  const errors = Object.values(registeredLineErrors(line, pack));
  if (errors.includes("required")) return "incomplete";
  return errors.length > 0 ? "postcode" : undefined;
}
