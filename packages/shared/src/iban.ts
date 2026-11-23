export type IbanProblem = "format" | "checksum";

const IBAN_SHAPE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;
const SPANISH_LENGTH = 24;

// Each country's BBAN format, from schwifty 2026.11.4's copy of the SWIFT IBAN registry: n digits,
// a capital letters, c either.
const REGISTRY = `AD4!n4!n12!c AE3!n16!n AL8!n16!c AT5!n11!n AX3!n11!n AZ4!a20!c BA3!n3!n8!n2!n BE3!n7!n2!n
BG4!a4!n2!n8!c BH4!a14!c BI5!n5!n11!n2!n BL5!n5!n11!c2!n BR8!c5!n10!n1!c1!c BY4!c4!n16!c CH5!n12!c
CR4!n14!n CY3!n5!n16!c CZ4!n6!n10!n DE8!n10!n DJ23!n DK4!n9!n1!n DO4!c20!n EE2!n2!n11!n1!n
EG4!n4!n17!n ES4!n4!n1!n1!n10!n FI3!n11!n FK2!a12!n FO4!n9!n1!n FR5!n5!n11!c2!n GB4!a6!n8!n
GE2!a16!n GF5!n5!n11!c2!n GG4!a6!n8!n GI4!a15!c GL4!n9!n1!n GP5!n5!n11!c2!n GR3!n4!n16!c GT4!c20!c
HN4!a20!n HR7!n10!n HU3!n4!n1!n15!n1!n IE4!a6!n8!n IL3!n3!n13!n IM4!a6!n8!n IQ4!a3!n12!n
IS4!n2!n6!n10!n IT1!a5!n5!n12!c JE4!a6!n8!n JO4!a4!n18!c KW4!a22!c KZ3!n13!c LB4!n20!c LC4!a24!c
LI5!n12!c LT5!n11!n LU3!n13!c LV4!a13!c LY3!n3!n15!n MC5!n5!n11!c2!n MD2!c18!c ME3!n13!n2!n
MF5!n5!n11!c2!n MK3!n10!c2!n MN4!n12!n MQ5!n5!n11!c2!n MR5!n5!n11!n2!n MT4!a5!n18!c
MU4!a2!n2!n12!n3!n3!a NC5!n5!n11!c2!n NI4!a20!n NL4!a10!n NO4!n6!n1!n OM3!n16!c PF5!n5!n11!c2!n
PK4!a16!c PL8!n16!n PM5!n5!n11!c2!n PS4!a21!c PT4!n4!n11!n2!n QA4!a21!c RE5!n5!n11!c2!n RO4!a16!c
RS3!n13!n2!n RU9!n5!n15!c SA2!n18!c SC4!a2!n2!n16!n3!a SD2!n12!n SE3!n16!n1!n SI5!n8!n2!n
SK4!n6!n10!n SM1!a5!n5!n12!c SO4!n3!n12!n ST4!n4!n11!n2!n SV4!a20!n TF5!n5!n11!c2!n TL3!n14!n2!n
TN2!n3!n13!n2!n TR5!n1!n16!c UA6!n19!c VA3!n15!n VG4!a16!n WF5!n5!n11!c2!n XK4!n10!n2!n
YE4!a4!n18!c YT5!n5!n11!c2!n`;

const CHARACTER_CLASSES: Record<string, string> = { n: "[0-9]", a: "[A-Z]", c: "[A-Z0-9]" };

const COUNTRY_FORMATS = new Map(
  REGISTRY.split(/\s/).map((entry) => {
    const country = entry.slice(0, 2);
    const bban = entry
      .slice(2)
      .replace(
        /(\d+)!([nac])/g,
        (_, count: string, kind: string) => `${CHARACTER_CLASSES[kind]}{${count}}`,
      );
    return [country, new RegExp(`^${country}[0-9]{2}${bban}$`)];
  }),
);

export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** Checks a value already passed through `normalizeIban`. */
export function ibanProblem(iban: string): IbanProblem | undefined {
  if (COUNTRY_FORMATS.get(iban.slice(0, 2))?.test(iban) !== true) return "format";
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  // ISO 7064 mod 97: an IBAN as digits is too long for a Number, so the remainder uses BigInt.
  return BigInt(digits) % 97n === 1n ? undefined : "checksum";
}

/**
 * The looser check a stored IBAN is read with: neither its country's format nor its check digits,
 * so a value saved under an earlier rule still reads.
 */
export function ibanShapeProblem(iban: string): "format" | undefined {
  if (!IBAN_SHAPE.test(iban)) return "format";
  if (iban.startsWith("ES") && iban.length !== SPANISH_LENGTH) return "format";
  return undefined;
}

/** The most characters a saved bank name may hold. */
export const BANK_NAME_MAX_LENGTH = 70;

/** What is wrong with a bank name already NFC-normalised and trimmed, or undefined. */
export function bankNameProblem(bankName: string): "length" | undefined {
  return [...bankName].length > BANK_NAME_MAX_LENGTH ? "length" : undefined;
}

export function ibanGroups(iban: string): string[] {
  return iban.match(/.{1,4}/g) ?? [];
}

/** The IBAN in groups of four, as it is printed and typed: `ES91 2100 0418 …`. */
export function formatIban(iban: string): string {
  return ibanGroups(iban).join(" ");
}

/** For an IBAN `ibanShapeProblem` accepts: the first four and last four characters, every other one `•`, in groups of four. */
export function maskIban(iban: string): string {
  const hidden = iban.slice(0, 4) + "•".repeat(iban.length - 8) + iban.slice(-4);
  return formatIban(hidden);
}
