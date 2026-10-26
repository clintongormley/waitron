import { setImmediate as nextTurn } from "node:timers/promises";
import { strToU8, Zip, ZipDeflate, ZipPassThrough, zipSync, type Zippable } from "fflate";
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
  ħ: "h",
  ŋ: "n",
  ŧ: "t",
};

function safeName(label: string): string {
  const safe = label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, (letter) => LETTERS[letter] ?? letter)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return safe === "" ? "person" : safe;
}

/** Plain ASCII, so a `Content-Disposition` header needs no `filename*=` form. `timeZone` must be
 * one the runtime knows (`knownZone`). */
export function archiveFileName(label: string, at: Date, timeZone: string): string {
  return `${safeName(label)}-${civilDateOf(at, timeZone)}.zip`;
}

/** fflate throws for a modification time outside 1980–2099 in local time, as a box whose clock
 * reset to 1970 would give it. */
function zipTime(at: Date): Date {
  const earliest = new Date(1980, 0, 1);
  const latest = new Date(2099, 11, 31, 23, 59, 58);
  return at < earliest ? earliest : at > latest ? latest : at;
}

export function zipArchive(files: readonly PersonalDataFile[], at: Date): Uint8Array<ArrayBuffer> {
  const entries: Zippable = {};
  const mtime = zipTime(at);
  for (const file of files) {
    const data = typeof file.content === "string" ? strToU8(file.content) : file.content;
    // A PDF is compressed already; deflating it again costs the thread that serves sales.
    entries[file.name] = [data, { mtime, level: /\.pdf$/i.test(file.name) ? 0 : 6 }];
  }
  return zipSync(entries);
}

/** `zipArchive`'s ZIP built one entry at a time with a turn of the event loop after each, so the
 * longest block while adding is one entry; the final join still copies the whole archive once.
 * Each `content` is read only when its entry is added. */
export async function zipArchiveInTurns(
  files: readonly PersonalDataFile[],
  at: Date,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else chunks.push(chunk);
  });
  const mtime = zipTime(at);
  for (const file of files) {
    const content = file.content;
    const data = typeof content === "string" ? strToU8(content) : content;
    const entry = /\.pdf$/i.test(file.name)
      ? new ZipPassThrough(file.name)
      : new ZipDeflate(file.name, { level: 6 });
    entry.mtime = mtime;
    zip.add(entry);
    entry.push(data, true);
    if (failure) throw failure;
    await nextTurn();
  }
  zip.end();
  return Buffer.concat(chunks);
}
