import {
  findAdministrativeArea,
  findAdministrativeAreaByPostalCode,
  type CountryPack,
} from "@waitron/country";

export interface RegisteredAddressParts {
  street: string;
  line2: string;
  postalCode: string;
  city: string;
  province: string;
}

export type RegisteredAddressError = "required" | "invalid" | "mismatch";

/** "street, line 2, postcode city, province", leaving blank parts out. */
export function joinRegisteredAddress(parts: RegisteredAddressParts): string {
  const place = [parts.postalCode.trim(), parts.city.trim()].filter(Boolean).join(" ");
  return [parts.street.trim(), parts.line2.trim(), place, parts.province.trim()]
    .filter(Boolean)
    .join(", ");
}

function isPostalCode(pack: CountryPack, value: string): boolean {
  return pack.postalCode?.validate(value).valid === true;
}

/** "postcode city" when its first word passes the pack's postcode check. */
function postalPlace(
  pack: CountryPack,
  part: string,
): { postalCode: string; city: string } | undefined {
  const words = /^(\S+) (\S.*)$/su.exec(part);
  return words !== null && isPostalCode(pack, words[1]!)
    ? { postalCode: words[1]!, city: words[2]! }
    : undefined;
}

/** The longest of the pack's area names the line ends with after a comma, when the comma part
 *  before it is "postcode city". Aliases are not matched, as an alias can also be a city's name. */
export function trailingProvince(
  line: string,
  pack: CountryPack,
): { rest: string; province: string } | undefined {
  let found: { rest: string; province: string } | undefined;
  for (const { name } of pack.administrativeAreas) {
    if (!line.endsWith(`, ${name}`) || name.length <= (found?.province.length ?? -1)) continue;
    const rest = line.slice(0, -(name.length + 2));
    if (postalPlace(pack, rest.split(", ").pop()!) !== undefined) found = { rest, province: name };
  }
  return found;
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
