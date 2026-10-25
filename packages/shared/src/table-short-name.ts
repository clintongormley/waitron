export const SHORT_NAME_MAX = 5;

const KEPT_WHOLE_MAX = 4;
const ONE_WORD_KEEP = 3;
const SPACE_RUN = /\s+/gu;
const TRAILING_NUMBER = /\p{Nd}+$/u;
const INITIAL = /[\p{L}\p{Nd}]/u;

function characters(value: string): string[] {
  return Array.from(value.normalize("NFC"));
}

export function shortNameLength(value: string): number {
  return characters(value).length;
}

/** Not blank, and at most {@link SHORT_NAME_MAX} characters. */
export function isShortNameShaped(value: string): boolean {
  return value.trim() !== "" && shortNameLength(value) <= SHORT_NAME_MAX;
}

/** The steps are `@waitron/identity`'s `foldForUniqueness`, whose comment gives the reason for
 * each. */
export function shortNameKey(shortName: string): string {
  return shortName.trim().normalize("NFC").toLowerCase().normalize("NFC");
}

function firstCharacters(value: string, count: number): string {
  return characters(value).slice(0, count).join("").trim();
}

export function proposeShortName(label: string): string {
  const name = label.normalize("NFC").trim().replace(SPACE_RUN, " ");
  if (shortNameLength(name) <= KEPT_WHOLE_MAX) return name;
  const number = TRAILING_NUMBER.exec(name)?.[0] ?? "";
  const words = name.slice(0, name.length - number.length).split(" ");
  if (number === "" && words.length === 1) return firstCharacters(name, ONE_WORD_KEEP);
  const initials = words.map((word) => INITIAL.exec(word)?.[0].toUpperCase() ?? "").join("");
  if (initials === "" && number === "") return firstCharacters(name, ONE_WORD_KEEP);
  // The end of a number is what tells a run of tables apart, so initials give way first.
  const digits = characters(number).slice(-SHORT_NAME_MAX);
  const room = SHORT_NAME_MAX - digits.length;
  return characters(initials).slice(0, room).join("") + digits.join("");
}
