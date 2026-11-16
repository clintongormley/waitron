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

function addEntry(zip: Zip, name: string, content: string | Uint8Array, mtime: Date): void {
  const data = typeof content === "string" ? strToU8(content) : content;
  const entry = /\.pdf$/i.test(name)
    ? new ZipPassThrough(name)
    : new ZipDeflate(name, { level: 6 });
  entry.mtime = mtime;
  zip.add(entry);
  entry.push(data, true);
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
    addEntry(zip, file.name, file.content, mtime);
    if (failure) throw failure;
    await nextTurn();
  }
  zip.end();
  return Buffer.concat(chunks);
}

/** fflate writes no ZIP64: its end record's entry count is two bytes and every offset and size
 * four, each written without a check, so a larger value wraps and the archive reads back wrong. A
 * count of 0xFFFF or an offset of 0xFFFFFFFF itself tells a reader to look for ZIP64. */
export const ZIP_LIMITS = { entries: 0xfffe, bytesBeforeDirectory: 0xfffffffe };

/** `zipArchiveInTurns`' ZIP as a stream that takes the next entry only when the reader asks for
 * more, so no more than one entry's bytes wait in memory. It gives the event loop no turn of its
 * own between entries: a source whose entries are slow to make must give those turns itself. An
 * entry past `limits` errors the stream instead of being written. A refusal of the stream's own
 * is thrown into the source, so its `catch` sees it as it sees a failure of its own. */
export function zipStream(
  entries: AsyncIterable<{ name: string; content: string | Uint8Array }>,
  at: Date,
  limits: typeof ZIP_LIMITS = ZIP_LIMITS,
): ReadableStream<Uint8Array> {
  const iterator = entries[Symbol.asyncIterator]();
  const mtime = zipTime(at);
  let chunks: Uint8Array[] = [];
  let failure: Error | null = null;
  let added = 0;
  let written = 0;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else chunks.push(chunk);
  });
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) zip.end();
          else {
            if (added === limits.entries)
              throw new Error(
                `a ZIP without ZIP64 holds at most ${limits.entries.toLocaleString("en")} entries`,
              );
            added++;
            addEntry(zip, next.value.name, next.value.content, mtime);
            if (failure) throw failure;
            for (const chunk of chunks) written += chunk.length;
            if (written > limits.bytesBeforeDirectory)
              throw new Error(
                `a ZIP without ZIP64 holds at most ${limits.bytesBeforeDirectory.toLocaleString("en")} bytes of entries`,
              );
          }
          for (const chunk of chunks) controller.enqueue(chunk);
          chunks = [];
          if (next.done) controller.close();
        } catch (error) {
          // An erroring stream does not call `cancel`. A generator that failed by itself has
          // finished, so `throw` reaches no `catch` of its own a second time.
          try {
            await iterator.throw?.(error);
          } catch {
            // The reader needs the first failure, not this one.
          }
          // A source whose `catch` carried on, or that has no `throw`, still holds what its
          // `finally` releases.
          try {
            await iterator.return?.();
          } catch {
            // As above.
          }
          throw error;
        }
      },
      async cancel() {
        await iterator.return?.();
      },
    },
    { highWaterMark: 0 },
  );
}
