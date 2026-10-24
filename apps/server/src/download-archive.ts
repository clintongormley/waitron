import { strToU8, zipSync, type Zippable } from "fflate";
import type { PersonalDataFile } from "@waitron/module";
import { civilDateOf } from "@waitron/reporting";

/** Letters that compatibility decomposition leaves whole. */
const LETTERS: Readonly<Record<string, string>> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  ł: "l",
  đ: "d",
  ð: "d",
  þ: "th",
  ı: "i",
};

function safeName(label: string): string {
  const safe = label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (letter) => LETTERS[letter]!)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return safe === "" ? "person" : safe;
}

function knownZone(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/** Plain ASCII, so a `Content-Disposition` header needs no `filename*=` form. */
export function archiveFileName(label: string, at: Date, timeZone: string): string {
  return `${safeName(label)}-${civilDateOf(at, knownZone(timeZone))}.zip`;
}

export function zipArchive(files: readonly PersonalDataFile[], at: Date): Uint8Array {
  const entries: Zippable = {};
  for (const file of files) {
    const data = typeof file.content === "string" ? strToU8(file.content) : file.content;
    entries[file.name] = [data, { mtime: at }];
  }
  return zipSync(entries);
}
