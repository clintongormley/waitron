import { strFromU8, strToU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { PersonalDataFile } from "@waitron/module";
import { archiveFileName, zipArchive, zipArchiveInTurns } from "./download-archive.js";

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
function centralEntries(zip: Uint8Array): Record<string, { method: number; date: number }> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = u16(zip, end + 10);
  let at = view.getUint32(end + 16, true);
  const found: Record<string, { method: number; date: number }> = {};
  for (let index = 0; index < count; index++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const nameLength = u16(zip, at + 28);
    const name = strFromU8(zip.subarray(at + 46, at + 46 + nameLength));
    found[name] = { method: u16(zip, at + 10), date: u16(zip, at + 14) };
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
    expect(centralEntries(streamed)).toEqual({
      "README.txt": { method: 8, date },
      "invoices.json": { method: 8, date },
      "invoices/FF-1.pdf": { method: 0, date },
      "invoices/FF-3.pdf": { method: 0, date },
      "invoices/FF-6.pdf": { method: 0, date },
    });
    expect(centralEntries(whole)["README.txt"]!.date).toBe(date);
  });

  it("dates its entries inside 1980-2099 as zipArchive does", async () => {
    const at = new Date("1970-01-01T00:00:00Z");
    const one = [{ name: "a.json", content: "{}" }];
    expect(centralEntries(await zipArchiveInTurns(one, at))["a.json"]!.date).toBe(
      dosDate(zipArchive(one, at)),
    );
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
