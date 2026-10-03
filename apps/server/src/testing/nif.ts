const NIF_CONTROL_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

/**
 * An eight-digit personal NIF with its correct control letter (the number modulo 23).
 * `@waitron/verifactu` refuses a wrong letter before it builds, sends or looks up a record.
 */
export function nifWithControlLetter(digits: number): string {
  return `${String(digits).padStart(8, "0")}${NIF_CONTROL_LETTERS[digits % 23]!}`;
}
