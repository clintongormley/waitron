import { strFromU8, strToU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { PersonalDataFile } from "@waitron/module";
import {
  archiveFileName,
  ZIP_LIMITS,
  zipArchive,
  zipArchiveInTurns,
  zipStream,
} from "./download-archive.js";

const AT = new Date("2026-10-04T22:30:00Z");

describe("archiveFileName", () => {
  it.each([
    ["Marta López", "marta-lopez"],
    ["José Ñúñez", "jose-nunez"],
    ["Núria Col·lell", "nuria-col-lell"],
    ["Hans Weiß", "hans-weiss"],
    ["Søren Ærø", "soren-aero"],
    ["Łukasz Đorđević", "lukasz-dordevic"],
    ["İlknur Işık", "ilknur-isik"],
    ["Ana María 2", "ana-maria-2"],
    ["Bœlla Ðóra Þór", "boella-dora-thor"],
    ["Ħamid Ŋgu Ŧom", "hamid-ngu-tom"],
    ["李雷", "person"],
    ["  ---  ", "person"],
  ])("makes %j safe as %j", (label, safe) => {
    expect(archiveFileName(label, AT, "UTC")).toBe(`${safe}-2026-10-04.zip`);
  });

  it("cuts the name to 60 characters and leaves no hyphen at the cut", () => {
    // 59 letters, then a space: the 60th character would be a hyphen.
    const label = `${"a".repeat(59)} bcdef`;
    expect(archiveFileName(label, AT, "UTC")).toBe(`${"a".repeat(59)}-2026-10-04.zip`);
    expect(archiveFileName("b".repeat(80), AT, "UTC")).toBe(`${"b".repeat(60)}-2026-10-04.zip`);
  });

  it("dates the file in the venue's time zone", () => {
    expect(archiveFileName("Marta López", AT, "Europe/Madrid")).toBe("marta-lopez-2026-10-05.zip");
    expect(archiveFileName("Marta López", AT, "UTC")).toBe("marta-lopez-2026-10-04.zip");
  });
});

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at]! | (bytes[at + 1]! << 8);
}

/** The first entry's modification date as its local header stores it, in the ZIP format's
 * packing of local time: years since 1980, month, day. */
const dosDate = (zip: Uint8Array) => u16(zip, 12);

/** Each entry's compression method, read from the local headers in order: 0 stored, 8 deflated. */
function methods(zip: Uint8Array): Record<string, number> {
  const found: Record<string, number> = {};
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = u16(zip, at + 26);
    const extraLength = u16(zip, at + 28);
    found[strFromU8(zip.subarray(at + 30, at + 30 + nameLength))] = u16(zip, at + 8);
    at += 30 + nameLength + extraLength + size;
  }
  return found;
}

describe("zipArchive", () => {
  it("stores a PDF as it is and compresses the other files", () => {
    const text = "x".repeat(1000);
    const zip = zipArchive(
      [
        { name: "profile.json", content: text },
        { name: "hours.pdf", content: strToU8(text) },
        { name: "HOURS.PDF", content: strToU8(text) },
      ],
      AT,
    );
    expect(methods(zip)).toEqual({ "profile.json": 8, "hours.pdf": 0, "HOURS.PDF": 0 });
    const entries = unzipSync(zip);
    expect(strFromU8(entries["hours.pdf"]!)).toBe(text);
    expect(strFromU8(entries["profile.json"]!)).toBe(text);
  });

  it("holds exactly the names and bytes given, strings as UTF-8", () => {
    const binary = new Uint8Array([0, 1, 2, 255, 128]);
    const zip = zipArchive(
      [
        { name: "profile.json", content: '{"name":"Marta López"}' },
        { name: "photo.pdf", content: binary },
      ],
      AT,
    );
    const entries = unzipSync(zip);
    expect(Object.keys(entries).sort()).toEqual(["photo.pdf", "profile.json"]);
    expect(strFromU8(entries["profile.json"]!)).toBe('{"name":"Marta López"}');
    expect(entries["photo.pdf"]).toEqual(binary);
  });

  it("is a ZIP by its own bytes: local header first, end record last with the entry count", () => {
    const zip = zipArchive(
      [
        { name: "a.json", content: "{}" },
        { name: "b.json", content: "[]" },
        { name: "c.csv", content: "x" },
      ],
      AT,
    );
    expect([...zip.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const end = zip.subarray(zip.length - 22);
    expect([...end.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
    // Entries on this disk, then in total.
    expect(u16(end, 8)).toBe(3);
    expect(u16(end, 10)).toBe(3);
    // No archive comment.
    expect(u16(end, 20)).toBe(0);
  });

  it.each([
    ["1970-01-01T00:00:00Z", "1980-01-01", (1 << 5) | 1],
    ["2107-06-01T12:00:00Z", "2099-12-31", (119 << 9) | (12 << 5) | 31],
  ])("builds a ZIP for request time %s, dating its entry %s", (at, _day, stamped) => {
    const zip = zipArchive([{ name: "profile.json", content: '{"a":1}' }], new Date(at));
    expect(strFromU8(unzipSync(zip)["profile.json"]!)).toBe('{"a":1}');
    expect(dosDate(zip)).toBe(stamped);
  });

  it("dates an entry with the request time when it is inside 1980-2099", () => {
    const zip = zipArchive([{ name: "profile.json", content: "{}" }], AT);
    expect(dosDate(zip)).toBe(
      ((AT.getFullYear() - 1980) << 9) | ((AT.getMonth() + 1) << 5) | AT.getDate(),
    );
  });

  it("marks a non-ASCII entry name as UTF-8 and leaves an ASCII one unmarked", () => {
    const flag = (name: string) => u16(zipArchive([{ name, content: "x" }], AT), 6) & (1 << 11);
    expect(flag("café.txt")).not.toBe(0);
    expect(flag("profile.json")).toBe(0);
  });
});

/** Each entry's compression method and DOS date, read from the central directory: a streamed
 * ZIP's local headers carry size 0 and the sizes follow the data. */
function centralEntries(
  zip: Uint8Array,
): Record<string, { method: number; time: number; date: number }> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = u16(zip, end + 10);
  let at = view.getUint32(end + 16, true);
  const found: Record<string, { method: number; time: number; date: number }> = {};
  for (let index = 0; index < count; index++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const nameLength = u16(zip, at + 28);
    const name = strFromU8(zip.subarray(at + 46, at + 46 + nameLength));
    found[name] = { method: u16(zip, at + 10), time: u16(zip, at + 12), date: u16(zip, at + 14) };
    at += 46 + nameLength + u16(zip, at + 30) + u16(zip, at + 32);
  }
  return found;
}

describe("zipArchiveInTurns", () => {
  const pdf = (seed: number) => {
    const bytes = new Uint8Array(250_000);
    for (let index = 0; index < bytes.length; index++) bytes[index] = (index * seed) & 0xff;
    bytes.set(strToU8("%PDF-"), 0);
    return bytes;
  };
  const files: PersonalDataFile[] = [
    { name: "README.txt", content: "Prepared for Jordi Puig Electrician\n".repeat(20) },
    { name: "invoices.json", content: JSON.stringify({ invoices: [1, 2, 3] }) },
    { name: "invoices/FF-1.pdf", content: pdf(7) },
    { name: "invoices/FF-3.pdf", content: pdf(11) },
    { name: "invoices/FF-6.pdf", content: pdf(13) },
  ];

  it("holds what zipArchive holds, dated alike, the PDFs stored as they are", async () => {
    const streamed = await zipArchiveInTurns(files, AT);
    const whole = zipArchive(files, AT);
    const ours = unzipSync(streamed);
    expect(Object.keys(ours)).toEqual(files.map((file) => file.name));
    expect(ours).toEqual(unzipSync(whole));
    const date = ((AT.getFullYear() - 1980) << 9) | ((AT.getMonth() + 1) << 5) | AT.getDate();
    const time = (AT.getHours() << 11) | (AT.getMinutes() << 5) | (AT.getSeconds() >> 1);
    expect(centralEntries(streamed)).toEqual({
      "README.txt": { method: 8, time, date },
      "invoices.json": { method: 8, time, date },
      "invoices/FF-1.pdf": { method: 0, time, date },
      "invoices/FF-3.pdf": { method: 0, time, date },
      "invoices/FF-6.pdf": { method: 0, time, date },
    });
    expect(centralEntries(streamed)).toEqual(centralEntries(whole));
  });

  it("dates its entries inside 1980-2099 as zipArchive does", async () => {
    const at = new Date("1970-01-01T00:00:00Z");
    const one = [{ name: "a.json", content: "{}" }];
    const streamed = centralEntries(await zipArchiveInTurns(one, at))["a.json"]!;
    expect(streamed).toEqual(centralEntries(zipArchive(one, at))["a.json"]);
    expect(streamed.date).toBe((1 << 5) | 1);
  });

  it("refuses an entry fflate refuses, as zipArchive does", async () => {
    const long = [{ name: `${"a".repeat(70_000)}.json`, content: "{}" }];
    expect(() => zipArchive(long, AT)).toThrow("filename too long");
    await expect(zipArchiveInTurns(long, AT)).rejects.toThrow("filename too long");
  });

  it("gives the event loop a turn between entries", async () => {
    // Each file, when its content is read, checks that the marker the previous file queued has
    // run, then queues its own. With no turn between entries no marker runs until the end.
    const ran: number[] = [];
    const seen: number[][] = [];
    const watched = files.map((file, index): PersonalDataFile => ({
      name: file.name,
      get content() {
        seen.push([...ran]);
        setImmediate(() => ran.push(index));
        return file.content;
      },
    }));
    await zipArchiveInTurns(watched, AT);
    await nextTurn();
    expect(seen).toEqual([[], [0], [0, 1], [0, 1, 2], [0, 1, 2, 3]]);
    expect(ran).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("zipStream", () => {
  type Entry = { name: string; content: string | Uint8Array };
  const pdfBytes = new Uint8Array(40_000).map((_, index) => (index * 7) & 0xff);
  const entries: Entry[] = [
    { name: "README.txt", content: "Facturas de marzo\n".repeat(50) },
    { name: "invoices/FF-1.pdf", content: pdfBytes },
    { name: "invoices.csv", content: "number;total\nFF-1;12.10\n" },
  ];

  /** An iterator over `items` that counts how many it has handed out and whether it was told
   * to stop. */
  function counting(items: readonly Entry[], failAt?: number) {
    const state = { pulled: 0, returned: false };
    const iterable: AsyncIterable<Entry> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (state.pulled === failAt) throw new Error("the month's sales could not be read");
          const value = items[state.pulled];
          if (value === undefined) return { done: true, value: undefined };
          state.pulled++;
          return { done: false, value };
        },
        return: async () => {
          state.returned = true;
          return { done: true, value: undefined };
        },
      }),
    };
    return { state, iterable };
  }

  /** A generator over `items`, as the tax-office export's source is one, that records whether
   * its `finally` ran. `before(index)` runs ahead of each entry and may wait. */
  function generated(items: readonly Entry[], before?: (index: number) => Promise<void>) {
    const state = { pulled: 0, finished: false };
    async function* source(): AsyncGenerator<Entry> {
      try {
        for (const [index, item] of items.entries()) {
          await before?.(index);
          state.pulled++;
          yield item;
        }
      } finally {
        state.finished = true;
      }
    }
    return { state, iterable: source() };
  }

  async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  it("unzips to exactly the entries given, a PDF stored and text deflated, dated as zipArchive", async () => {
    const zip = await readAll(zipStream(counting(entries).iterable, AT));
    const unzipped = unzipSync(zip);
    expect(Object.keys(unzipped)).toEqual(entries.map((entry) => entry.name));
    expect(strFromU8(unzipped["README.txt"]!)).toBe(entries[0]!.content);
    expect(unzipped["invoices/FF-1.pdf"]).toEqual(pdfBytes);
    expect(strFromU8(unzipped["invoices.csv"]!)).toBe(entries[2]!.content);
    const date = ((AT.getFullYear() - 1980) << 9) | ((AT.getMonth() + 1) << 5) | AT.getDate();
    const time = (AT.getHours() << 11) | (AT.getMinutes() << 5) | (AT.getSeconds() >> 1);
    expect(centralEntries(zip)).toEqual({
      "README.txt": { method: 8, time, date },
      "invoices/FF-1.pdf": { method: 0, time, date },
      "invoices.csv": { method: 8, time, date },
    });
  });

  it("dates its entries inside 1980-2099", async () => {
    const one = [{ name: "a.json", content: "{}" }];
    const zip = await readAll(zipStream(counting(one).iterable, new Date("1970-01-01T00:00:00Z")));
    expect(centralEntries(zip)["a.json"]!.date).toBe((1 << 5) | 1);
  });

  it("takes the next entry only once the reader has read what the previous one gave", async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      name: `invoices/FF-${index}.pdf`,
      content: pdfBytes,
    }));
    const { state, iterable } = counting(many);
    const reader = zipStream(iterable, AT).getReader();
    for (let turn = 0; turn < 5; turn++) await nextTurn();
    expect(state.pulled).toBe(0);
    const chunks: Uint8Array[] = [];
    // An entry's bytes begin with a chunk holding its local header.
    let headersRead = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      if (new DataView(value.buffer, value.byteOffset).getUint32(0, true) === 0x04034b50) {
        headersRead++;
      }
      for (let turn = 0; turn < 5; turn++) await nextTurn();
      expect(state.pulled).toBe(headersRead);
    }
    expect(state.pulled).toBe(many.length);
    expect(Object.keys(unzipSync(Buffer.concat(chunks)))).toHaveLength(many.length);
  });

  it("tells the iterator to stop when the reader cancels", async () => {
    const { state, iterable } = counting(entries);
    const reader = zipStream(iterable, AT).getReader();
    await reader.read();
    expect(state.returned).toBe(false);
    await reader.cancel();
    expect(state.returned).toBe(true);
    expect(state.pulled).toBeLessThan(entries.length);
  });

  it("errors the stream when the iterator fails", async () => {
    const reader = zipStream(counting(entries, 1).iterable, AT).getReader();
    await expect(
      (async () => {
        for (;;) if ((await reader.read()).done) return;
      })(),
    ).rejects.toThrow("the month's sales could not be read");
  });

  it("errors the stream on an entry fflate refuses, and stops the source", async () => {
    const long = [{ name: `${"a".repeat(70_000)}.json`, content: "{}" }, entries[0]!];
    const { state, iterable } = generated(long);
    await expect(readAll(zipStream(iterable, AT))).rejects.toThrow("filename too long");
    expect(state.finished).toBe(true);
    expect(state.pulled).toBe(1);
  });

  it("errors the stream on an entry with no content, and stops the source", async () => {
    const empty = [{ name: "a.json" } as Entry, entries[0]!];
    const { state, iterable } = generated(empty);
    await expect(readAll(zipStream(iterable, AT))).rejects.toThrow(TypeError);
    expect(state.finished).toBe(true);
    expect(state.pulled).toBe(1);
  });

  it("still errors with the entry's refusal when stopping the source fails too", async () => {
    const long = { name: `${"a".repeat(70_000)}.json`, content: "{}" };
    const iterable: AsyncIterable<Entry> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: long }),
        return: () => {
          throw new Error("the source could not stop");
        },
      }),
    };
    await expect(readAll(zipStream(iterable, AT))).rejects.toThrow("filename too long");
  });

  /** `count` one-byte entries, made only as the stream asks for them. */
  async function* tiny(count: number): AsyncGenerator<Entry> {
    const byte = new Uint8Array([1]);
    for (let index = 0; index < count; index++) yield { name: `${index}.pdf`, content: byte };
  }

  // 65,535 in the end record's count means "read the ZIP64 record", which fflate never writes.
  it("writes 65,534 entries, the most a ZIP without ZIP64 can count", async () => {
    const zip = await readAll(zipStream(tiny(65_534), AT));
    expect(Object.keys(unzipSync(zip))).toHaveLength(65_534);
  });

  it("errors the stream when the source offers a 65,535th entry, and stops the source", async () => {
    const state = { pulled: 0, finished: false };
    async function* source(): AsyncGenerator<Entry> {
      try {
        for await (const entry of tiny(65_536)) {
          state.pulled++;
          yield entry;
        }
      } finally {
        state.finished = true;
      }
    }
    await expect(readAll(zipStream(source(), AT))).rejects.toThrow(
      "a ZIP without ZIP64 holds at most 65,534 entries",
    );
    expect(state.pulled).toBe(65_535);
    expect(state.finished).toBe(true);
  });

  /** A generator over `count` one-byte entries that records each error its own `catch` sees,
   * as the tax-office route's source logs them, and whether its `finally` ran. `fail` makes its
   * own body throw before the entry at that index. */
  function catching(count: number, fail?: number) {
    const state = { caught: [] as unknown[], finished: false };
    async function* source(): AsyncGenerator<Entry> {
      try {
        for (let index = 0; index < count; index++) {
          if (index === fail) throw new Error("the month's sales could not be read");
          yield { name: `${index}.pdf`, content: new Uint8Array([1]) };
        }
      } catch (error) {
        state.caught.push(error);
        throw error;
      } finally {
        state.finished = true;
      }
    }
    return { state, iterable: source() };
  }

  it("hands its own refusal to the source's catch once, and errors the stream with it", async () => {
    const two = { ...ZIP_LIMITS, entries: 2 };
    const { state, iterable } = catching(3);
    const failure = await readAll(zipStream(iterable, AT, two)).catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: "a ZIP without ZIP64 holds at most 2 entries" });
    expect(state.caught).toEqual([failure]);
    expect(state.finished).toBe(true);
  });

  it("hands fflate's refusal of an entry to the source's catch", async () => {
    const caught: unknown[] = [];
    async function* source(): AsyncGenerator<Entry> {
      try {
        yield { name: `${"a".repeat(70_000)}.json`, content: "{}" };
      } catch (error) {
        caught.push(error);
        throw error;
      }
    }
    await expect(readAll(zipStream(source(), AT))).rejects.toThrow("filename too long");
    expect(caught).toEqual([expect.objectContaining({ message: "filename too long" })]);
  });

  it("does not hand the source's own failure back to its catch", async () => {
    const { state, iterable } = catching(3, 1);
    await expect(readAll(zipStream(iterable, AT))).rejects.toThrow(
      "the month's sales could not be read",
    );
    expect(state.caught).toHaveLength(1);
    expect(state.finished).toBe(true);
  });

  it("still errors with its own refusal when the source's catch throws something else", async () => {
    let finished = false;
    async function* source(): AsyncGenerator<Entry> {
      try {
        yield* tiny(3);
      } catch {
        throw new Error("the source failed while stopping");
      } finally {
        finished = true;
      }
    }
    await expect(readAll(zipStream(source(), AT, { ...ZIP_LIMITS, entries: 2 }))).rejects.toThrow(
      "a ZIP without ZIP64 holds at most 2 entries",
    );
    expect(finished).toBe(true);
  });

  it("stops a source that carries on after its catch", async () => {
    let finished = false;
    async function* source(): AsyncGenerator<Entry> {
      try {
        for (let index = 0; ; index++) {
          try {
            yield { name: `${index}.pdf`, content: new Uint8Array([1]) };
          } catch {
            // Carries on to the next entry.
          }
        }
      } finally {
        finished = true;
      }
    }
    await expect(readAll(zipStream(source(), AT, { ...ZIP_LIMITS, entries: 2 }))).rejects.toThrow(
      "a ZIP without ZIP64 holds at most 2 entries",
    );
    expect(finished).toBe(true);
  });

  it("errors the stream on an entry that takes the archive past its byte limit, and stops the source", async () => {
    // Each entry: a 30-byte header, its 5-letter name, 1 byte and a 16-byte descriptor.
    const three = { ...ZIP_LIMITS, bytesBeforeDirectory: 3 * 52 };
    const zip = await readAll(zipStream(tiny(3), AT, three));
    expect(Object.keys(unzipSync(zip))).toHaveLength(3);
    const { state, iterable } = generated([
      { name: "0.pdf", content: new Uint8Array([1]) },
      { name: "1.pdf", content: new Uint8Array([1]) },
      { name: "2.pdf", content: new Uint8Array([1]) },
      { name: "3.pdf", content: new Uint8Array([1]) },
    ]);
    const short = { ...three, bytesBeforeDirectory: 3 * 52 - 1 };
    await expect(readAll(zipStream(iterable, AT, short))).rejects.toThrow(
      "a ZIP without ZIP64 holds at most 155 bytes of entries",
    );
    expect(state.pulled).toBe(3);
    expect(state.finished).toBe(true);
  });

  it("finishes a cancel once the entry being prepared arrives, and stops the source", async () => {
    let arrive!: () => void;
    const second = new Promise<void>((resolve) => (arrive = resolve));
    const { state, iterable } = generated(entries, (index) =>
      index === 1 ? second : Promise.resolve(),
    );
    const reader = zipStream(iterable, AT).getReader();
    // Read the first entry's bytes until a read waits on the second entry.
    let waiting: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
    while (waiting === undefined) {
      const read = reader.read();
      const settled = await Promise.race([read.then(() => true), nextTurn().then(() => false)]);
      if (!settled) waiting = read;
    }
    expect(state.pulled).toBe(1);
    let cancelled = false;
    const cancel = reader.cancel().then(() => (cancelled = true));
    for (let turn = 0; turn < 5; turn++) await nextTurn();
    expect(cancelled).toBe(false);
    expect(state.finished).toBe(false);
    arrive();
    await cancel;
    expect(state.finished).toBe(true);
    expect(state.pulled).toBe(2);
    await expect(waiting).resolves.toEqual({ done: true, value: undefined });
  });
});
