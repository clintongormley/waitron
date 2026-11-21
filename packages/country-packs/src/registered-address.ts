import {
  findAdministrativeArea,
  findAdministrativeAreaByPostalCode,
  type AdministrativeArea,
  type CountryPack,
} from "@waitron/country";
import { postalPlace, trailingProvince } from "./address-line.js";

export interface RegisteredAddressParts {
  street: string;
  line2: string;
  postalCode: string;
  city: string;
  province: string;
}

export type RegisteredAddressError = "required" | "invalid" | "mismatch";

/** "street, line 2, postcode city, province", leaving blank parts out; with a pack, in the
 *  pack's own spelling (`canonicalRegisteredParts`). */
export function joinRegisteredAddress(parts: RegisteredAddressParts, pack?: CountryPack): string {
  const spelt = canonicalRegisteredParts(parts, pack);
  const place = [spelt.postalCode.trim(), spelt.city.trim()].filter(Boolean).join(" ");
  return [spelt.street.trim(), spelt.line2.trim(), place, spelt.province.trim()]
    .filter(Boolean)
    .join(", ");
}

/** The postcode as the pack's check writes it and the province as the pack's area name, since
 *  `registeredAddressParts` reads back only those. A part the pack does not recognise is kept. */
export function canonicalRegisteredParts(
  parts: RegisteredAddressParts,
  pack: CountryPack | undefined,
): RegisteredAddressParts {
  if (pack === undefined) return parts;
  const postal = pack.postalCode?.validate(parts.postalCode.trim());
  return {
    ...parts,
    postalCode: postal?.valid === true ? postal.normalized : parts.postalCode,
    province: findAdministrativeArea(pack, parts.province)?.name ?? parts.province,
  };
}

/** The area a postcode the pack accepts lies in. */
export function provinceOfPostalCode(
  pack: CountryPack | undefined,
  postalCode: string,
): AdministrativeArea | undefined {
  const postal = pack?.postalCode?.validate(postalCode);
  return pack !== undefined && postal?.valid === true
    ? findAdministrativeAreaByPostalCode(pack, postal.normalized)
    : undefined;
}

/** Parts that `joinRegisteredAddress` turns back into the trimmed line, plus a province filled
 *  from the postcode when the line names none. Line 2 is never split out: a street often holds a
 *  comma. A line that cannot be split that way goes whole into the street. */
export function registeredAddressParts(line: string, pack: CountryPack): RegisteredAddressParts {
  const trimmed = line.trim();
  const whole = { street: trimmed, line2: "", postalCode: "", city: "", province: "" };
  const { rest, province } = trailingProvince(trimmed, pack) ?? { rest: trimmed, province: "" };
  const commaParts = rest.split(", ");
  const place = postalPlace(pack, commaParts.pop()!);
  if (place === undefined) return whole;
  const parts = { street: commaParts.join(", "), line2: "", ...place, province };
  if (joinRegisteredAddress(parts) !== trimmed) return whole;
  if (province === "")
    parts.province = findAdministrativeAreaByPostalCode(pack, place.postalCode)?.name ?? "";
  return parts;
}

/** Street, postcode and city are required; the postcode passes the pack's check; a province, when
 *  given, names the area the postcode lies in, where the pack can tell. */
export function registeredAddressErrors(
  parts: RegisteredAddressParts,
  pack: CountryPack,
): Partial<Record<keyof RegisteredAddressParts, RegisteredAddressError>> {
  const errors: Partial<Record<keyof RegisteredAddressParts, RegisteredAddressError>> = {};
  if (parts.street.trim() === "") errors.street = "required";
  if (parts.city.trim() === "") errors.city = "required";
  const postal = pack.postalCode?.validate(parts.postalCode);
  if (parts.postalCode.trim() === "") errors.postalCode = "required";
  else if (postal?.valid === false) errors.postalCode = "invalid";
  else if (parts.province.trim() !== "") {
    const area = findAdministrativeAreaByPostalCode(pack, postal?.normalized ?? parts.postalCode);
    if (area !== undefined && findAdministrativeArea(pack, parts.province) !== area)
      errors.province = "mismatch";
  }
  return errors;
}

/** The errors of the parts `line` reads back into, which is how the server checks a registered
 *  address. Without a postcode rule a line cannot be split, so nothing is checked. */
export function registeredLineErrors(
  line: string,
  pack: CountryPack | undefined,
): Partial<Record<keyof RegisteredAddressParts, RegisteredAddressError>> {
  if (pack?.postalCode === undefined) return {};
  return registeredAddressErrors(registeredAddressParts(line, pack), pack);
}
