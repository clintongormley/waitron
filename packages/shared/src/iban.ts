export type IbanProblem = "format" | "checksum";

const IBAN_FORMAT = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;
const SPANISH_LENGTH = 24;

export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** Checks a value already passed through `normalizeIban`. */
export function ibanProblem(iban: string): IbanProblem | undefined {
  if (!IBAN_FORMAT.test(iban)) return "format";
  if (iban.startsWith("ES") && iban.length !== SPANISH_LENGTH) return "format";
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  // ISO 7064 mod 97: a 34-character IBAN is too long for a Number, so the remainder uses BigInt.
  return BigInt(digits) % 97n === 1n ? undefined : "checksum";
}

export function ibanGroups(iban: string): string[] {
  return iban.match(/.{1,4}/g) ?? [];
}

/** For an IBAN `ibanProblem` accepted: the first four and last four characters, every other one `•`, in groups of four. */
export function maskIban(iban: string): string {
  const hidden = iban.slice(0, 4) + "•".repeat(iban.length - 8) + iban.slice(-4);
  return ibanGroups(hidden).join(" ");
}
