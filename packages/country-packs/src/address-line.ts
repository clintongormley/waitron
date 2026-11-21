import type { CountryPack } from "@waitron/country";

// Not re-exported from index.ts: only this package's address readers use these.

function isPostalCode(pack: CountryPack, value: string): boolean {
  return pack.postalCode?.validate(value).valid === true;
}

/** A comma part split at its first space, when both sides are non-blank. */
export function firstWordAndRest(part: string): { first: string; rest: string } | undefined {
  const words = /^(\S+) (\S.*)$/su.exec(part);
  return words === null ? undefined : { first: words[1]!, rest: words[2]! };
}

/** "postcode city" when its first word passes the pack's postcode check. */
export function postalPlace(
  pack: CountryPack,
  part: string,
): { postalCode: string; city: string } | undefined {
  const words = firstWordAndRest(part);
  return words !== undefined && isPostalCode(pack, words.first)
    ? { postalCode: words.first, city: words.rest }
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
