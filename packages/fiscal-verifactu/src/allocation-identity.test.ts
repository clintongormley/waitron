import { describe, expect, it } from "vitest";
import {
  isAllocatedSeries,
  encodeEmergencyIdentity,
  installationChecksum,
  isInstallationIdentity,
  matchesInstallationChecksum,
} from "./allocation-identity.js";

describe("externally allocated installation identity", () => {
  it.each([
    undefined,
    null,
    42,
    {},
    [],
    "",
    "42",
    "P42",
    "P000000",
    "S000000",
    "C000000",
    "P0000042",
    "p000042",
    "C00004A",
    "S000042 ",
    " P000042",
    "P000042\n",
    "E80000000000000000000000000",
    "E0000000000000000000000000I",
    "E0000000000000000000000000L",
    "E0000000000000000000000000O",
    "E0000000000000000000000000U",
    "E0000000000000000000000000",
    "E000000000000000000000000000",
    "e00000000000000000000000000",
  ])("refuses the malformed identity %j", (identity) => {
    expect(isInstallationIdentity(identity)).toBe(false);
  });

  it.each([
    "S000001",
    "S999999",
    "P000001",
    "P999999",
    "C000001",
    "C999999",
    "E00000000000000000000000000",
    "E40000000000000000000000000",
    "E7ZZZZZZZZZZZZZZZZZZZZZZZZZ",
    "E0123456789ABCDEFGHJKMNPQRS",
  ])("accepts the allocated identity %s", (identity) => {
    expect(isInstallationIdentity(identity)).toBe(true);
  });
});

describe("emergency identity encoding", () => {
  it.each([
    [new Uint8Array(16), "E00000000000000000000000000"],
    [new Uint8Array(16).fill(255), "E7ZZZZZZZZZZZZZZZZZZZZZZZZZ"],
    [Uint8Array.from([128, ...new Array<number>(15).fill(0)]), "E40000000000000000000000000"],
    [
      Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
      "E00041061050R3GG28A1C60T3GF",
    ],
  ])("encodes all 128 bits without a clock or a counter", (bytes, expected) => {
    expect(encodeEmergencyIdentity(bytes)).toBe(expected);
  });

  it.each([0, 15, 17])("refuses %i bytes instead of silently changing entropy", (length) => {
    expect(() => encodeEmergencyIdentity(new Uint8Array(length))).toThrow(RangeError);
  });
});

describe("manual emergency identity checksum", () => {
  it.each([
    ["E00000000000000000000000000", "771A"],
    ["E7ZZZZZZZZZZZZZZZZZZZZZZZZZ", "62A7"],
    ["E40000000000000000000000000", "E6DC"],
    ["E00041061050R3GG28A1C60T3GF", "87B5"],
  ])("computes CRC-16/CCITT-FALSE for %s", (identity, checksum) => {
    expect(installationChecksum(identity)).toBe(checksum);
    expect(matchesInstallationChecksum(identity, checksum)).toBe(true);
  });

  it.each([undefined, null, 42, "", "87b5", "087B5", "87B5\n", "87B4"])(
    "refuses the malformed or changed checksum %j",
    (checksum) => {
      expect(matchesInstallationChecksum("E00041061050R3GG28A1C60T3GF", checksum)).toBe(false);
    },
  );

  it("refuses a transcription change even when the identity format remains valid", () => {
    expect(matchesInstallationChecksum("E00041061050R3GG28A1C60T3GG", "87B5")).toBe(false);
  });

  it.each([
    "P000042",
    "E80000000000000000000000000",
    "E00041061050R3GG28A1C60T3GÍ",
    "E00041061050R3GG28A1C60T3GF-87B5",
  ])("refuses a malformed or checksum-bearing fiscal identity %s", (identity) => {
    expect(installationChecksum(identity)).toBeNull();
    expect(matchesInstallationChecksum(identity, "87B5")).toBe(false);
  });
});

const BASES = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
] as const;
const PAPER_SERIES = [
  { code: "A-P000042", purpose: "standard" },
  { code: "FF-P000042", purpose: "full" },
  { code: "R-P000042", purpose: "rectificative" },
];

describe("a frozen allocation's complete series set", () => {
  it("accepts every requested purpose, independent of list order", () => {
    expect(isAllocatedSeries([...PAPER_SERIES].reverse(), "P000042", BASES)).toBe(true);
  });

  it.each(
    [
      undefined,
      null,
      {},
      [],
      [null],
      PAPER_SERIES.slice(0, 2),
      [null, PAPER_SERIES[1], PAPER_SERIES[2]],
      [[], PAPER_SERIES[1], PAPER_SERIES[2]],
      [42, PAPER_SERIES[1], PAPER_SERIES[2]],
      [{ code: 42, purpose: "standard" }, PAPER_SERIES[1], PAPER_SERIES[2]],
      [{ code: "A-P000042", purpose: 42 }, PAPER_SERIES[1], PAPER_SERIES[2]],
      [...PAPER_SERIES, { code: "EXTRA-P000042", purpose: "standard" }],
      [...PAPER_SERIES, PAPER_SERIES[0]],
      [PAPER_SERIES[0], PAPER_SERIES[0], PAPER_SERIES[2]],
      [PAPER_SERIES[0], { code: "FF-P000042", purpose: "standard" }, PAPER_SERIES[2]],
      [PAPER_SERIES[0], { code: "FF-P000042", purpose: "other" }, PAPER_SERIES[2]],
      [PAPER_SERIES[0], { code: "FF-P000043", purpose: "full" }, PAPER_SERIES[2]],
      [PAPER_SERIES[0], { code: "FF-P000042\n", purpose: "full" }, PAPER_SERIES[2]],
    ].map((series) => ({ series })),
  )("refuses missing, duplicated, substituted or malformed series %j", ({ series }) => {
    expect(isAllocatedSeries(series, "P000042", BASES)).toBe(false);
  });

  it.each(["", "A".repeat(22), "A B", "Á", "A?", "A\n"])("refuses the base %j", (base) => {
    expect(
      isAllocatedSeries([{ code: `${base}-P000042`, purpose: "standard" }], "P000042", [
        { code: base, purpose: "standard" },
      ]),
    ).toBe(false);
  });

  it("accepts the longest emergency code with a 21-character base", () => {
    expect(
      isAllocatedSeries(
        [{ code: "ABCDEFGHIJKLMNOPQRSTU-E7ZZZZZZZZZZZZZZZZZZZZZZZZZ", purpose: "standard" }],
        "E7ZZZZZZZZZZZZZZZZZZZZZZZZZ",
        [{ code: "ABCDEFGHIJKLMNOPQRSTU", purpose: "standard" }],
      ),
    ).toBe(true);
  });

  it("accepts the permitted base punctuation", () => {
    expect(
      isAllocatedSeries([{ code: "a/B_1.2-3-P000042", purpose: "standard" }], "P000042", [
        { code: "a/B_1.2-3", purpose: "standard" },
      ]),
    ).toBe(true);
  });

  it.each(
    [
      [],
      [{ code: "A", purpose: "other" }],
      [{ code: "R", purpose: "rectificative" }],
      [
        { code: "A", purpose: "standard" },
        { code: "A", purpose: "full" },
      ],
    ].map((bases) => ({ bases })),
  )("refuses an unusable configured purpose set %j", ({ bases }) => {
    expect(
      isAllocatedSeries(
        bases.map(({ code, purpose }) => ({ code: `${code}-P000042`, purpose })),
        "P000042",
        bases,
      ),
    ).toBe(false);
  });

  it("refuses a malformed identity even if every series copied it", () => {
    expect(
      isAllocatedSeries([{ code: "A-42", purpose: "standard" }], "42", [
        { code: "A", purpose: "standard" },
      ]),
    ).toBe(false);
  });
});

describe("checksum input types", () => {
  it.each([undefined, null, 42, {}, []])("refuses an identity of the wrong type %j", (identity) => {
    expect(matchesInstallationChecksum(identity, "771A")).toBe(false);
  });
});
