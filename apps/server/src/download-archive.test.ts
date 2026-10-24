import { strFromU8, strToU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { archiveFileName, zipArchive } from "./download-archive.js";

const AT = new Date("2026-10-04T22:30:00Z");

describe("archiveFileName", () => {
  it.each([
    ["Marta López", "marta-lopez"],
    ["José Ñúñez", "jose-nunez"],
    ["Núria Col·lell", "nuria-col-lell"],
    ["Straße", "strasse"],
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
