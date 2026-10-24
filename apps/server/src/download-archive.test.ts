import { strFromU8, unzipSync } from "fflate";
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
    ["Œuvre Ðóra Þór", "oeuvre-dora-thor"],
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

  it("dates the file in UTC when the zone is unknown", () => {
    expect(archiveFileName("Marta López", AT, "Not/AZone")).toBe("marta-lopez-2026-10-04.zip");
  });
});

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at]! | (bytes[at + 1]! << 8);
}

describe("zipArchive", () => {
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

  it("marks a non-ASCII entry name as UTF-8 and leaves an ASCII one unmarked", () => {
    const flag = (name: string) => u16(zipArchive([{ name, content: "x" }], AT), 6) & (1 << 11);
    expect(flag("café.txt")).not.toBe(0);
    expect(flag("profile.json")).toBe(0);
  });
});
