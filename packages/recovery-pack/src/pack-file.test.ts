import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "./canonical-json.js";
import {
  buildRecoveryPackFile,
  MAX_PACK_FILE,
  parseRecoveryPackFile,
  RecoveryPackFileError,
  type RecoveryPackFile,
} from "./pack-file.js";

const masterKey = "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5";
const masterKeyName = "2026-11-23 · QZJV";

const full: RecoveryPackFile = {
  kind: "waitron-recovery-pack",
  version: 2,
  number: 3,
  madeAt: "2026-10-29T17:00:00.000Z",
  bucketCode: "WAITRON-RECOVERY-KIT-2:" + "b".repeat(600),
  archiveCode: "WAITRON-ARCHIVE-PACK-1:" + "c".repeat(400),
  backupKey: "k".repeat(43),
  masterKey,
  masterKeyName,
  masterKeyHeldBy: null,
};

const encoder = new TextEncoder();
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const bytesOf = (value: unknown) => encoder.encode(canonicalJson(value));

function refusal(bytes: Uint8Array): string {
  try {
    parseRecoveryPackFile(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(RecoveryPackFileError);
    return (error as RecoveryPackFileError).reason;
  }
  throw new Error("accepted");
}

describe("the recovery pack's attached file", () => {
  it("builds canonical bytes: keys sorted, no spaces", () => {
    const bytes = buildRecoveryPackFile(full);
    const out = text(bytes);
    expect(out.startsWith('{"archiveCode":')).toBe(true);
    expect(out).not.toMatch(/[ \n]"/);
    expect(out).toBe(canonicalJson(full));
  });

  it("round-trips every field, with absent parts as null", () => {
    expect(parseRecoveryPackFile(buildRecoveryPackFile(full))).toEqual(full);
    const bare: RecoveryPackFile = {
      ...full,
      bucketCode: null,
      archiveCode: null,
      backupKey: null,
    };
    expect(parseRecoveryPackFile(buildRecoveryPackFile(bare))).toEqual(bare);
  });

  it("parses a pack file without serverKey fields", () => {
    expect(Object.keys(parseRecoveryPackFile(bytesOf(full))).sort()).toEqual([
      "archiveCode",
      "backupKey",
      "bucketCode",
      "kind",
      "madeAt",
      "masterKey",
      "masterKeyHeldBy",
      "masterKeyName",
      "number",
      "version",
    ]);
  });

  it.each([
    ["all three, empty", { serverKey: null, serverKeyName: null, serverKeyHeldBy: null }],
    [
      "all three, filled",
      {
        serverKey: { kind: "waitron-recovery-document" },
        serverKeyName: "2026-10-12 · key",
        serverKeyHeldBy: { number: 2, madeOn: "2026-10-12", received: true },
      },
    ],
    ["serverKey alone", { serverKey: null }],
    ["serverKeyName alone", { serverKeyName: null }],
    ["serverKeyHeldBy alone", { serverKeyHeldBy: null }],
  ])("refuses a pack file with serverKey fields (%s) as shape", (_name, extra) => {
    expect(refusal(bytesOf({ ...full, ...extra }))).toBe("shape");
  });

  it("carries masterKey and masterKeyName, or, on a pack without the key, the pack that holds it", () => {
    const read = parseRecoveryPackFile(buildRecoveryPackFile(full));
    expect(read.version).toBe(2);
    expect([read.masterKey, read.masterKeyName, read.masterKeyHeldBy]).toEqual([
      masterKey,
      masterKeyName,
      null,
    ]);
    const elsewhere = { ...full, masterKey: null, masterKeyHeldBy: 1 };
    expect(parseRecoveryPackFile(buildRecoveryPackFile(elsewhere))).toEqual(elsewhere);
    const unknown = { ...full, masterKey: null, masterKeyHeldBy: null };
    expect(parseRecoveryPackFile(buildRecoveryPackFile(unknown))).toEqual(unknown);
    const none = { ...unknown, masterKeyName: null };
    expect(parseRecoveryPackFile(buildRecoveryPackFile(none))).toEqual(none);
  });

  it("refuses to build a file it would refuse to read", () => {
    expect(() => buildRecoveryPackFile({ ...full, number: 0 })).toThrow(RecoveryPackFileError);
    expect(() =>
      buildRecoveryPackFile({ ...full, bucketCode: full.bucketCode + "b".repeat(MAX_PACK_FILE) }),
    ).toThrow("Recovery pack file refused: size");
  });

  it.each([
    ["spaces between words", "correct horse battery staple"],
    ["a leading and a trailing space", " correct horse battery staple "],
    ["two spaces in a row", "correct  horse"],
    ["a line break", "abc\ndef"],
  ])("carries a backup key with %s exactly as it is", (_name, backupKey) => {
    const bytes = buildRecoveryPackFile({ ...full, backupKey });
    expect(parseRecoveryPackFile(bytes).backupKey).toBe(backupKey);
  });

  it("refuses a missing key and an extra key", () => {
    const missing: Partial<RecoveryPackFile> = { ...full };
    delete missing.backupKey;
    expect(refusal(bytesOf(missing))).toBe("shape");
    expect(refusal(bytesOf({ ...full, extra: "secret" }))).toBe("shape");
  });

  it.each([
    ["kind", { kind: "waitron-recovery-document" }],
    ["version", { version: 1 }],
    ["masterKey unspaced", { masterKey: masterKey.replaceAll(" ", "") }],
    ["masterKey lower case", { masterKey: masterKey.toLowerCase() }],
    ["masterKey a letter outside its alphabet", { masterKey: "I" + masterKey.slice(1) }],
    ["masterKey a group short", { masterKey: masterKey.slice(0, -5) }],
    ["masterKeyName not a key's name", { masterKeyName: "2026-11-23 · key" }],
    ["masterKeyName an impossible day", { masterKeyName: "2026-02-30 · QZJV" }],
    ["masterKey without its name", { masterKeyName: null }],
    ["masterKey held by another pack too", { masterKeyHeldBy: 1 }],
    ["masterKeyHeldBy zero", { masterKey: null, masterKeyHeldBy: 0 }],
    [
      "masterKeyHeldBy with no key named",
      { masterKey: null, masterKeyName: null, masterKeyHeldBy: 1 },
    ],
    ["number zero", { number: 0 }],
    ["number fraction", { number: 1.5 }],
    ["number as text", { number: "3" }],
    ["madeAt not a time", { madeAt: "yesterday" }],
    ["madeAt without milliseconds", { madeAt: "2026-10-29T17:00:00Z" }],
    ["madeAt an impossible day", { madeAt: "2026-02-30T17:00:00.000Z" }],
    ["bucketCode without its prefix", { bucketCode: "b".repeat(40) }],
    ["bucketCode with a space", { bucketCode: "WAITRON-RECOVERY-KIT-2:ab cd" }],
    ["bucketCode prefix alone", { bucketCode: "WAITRON-RECOVERY-KIT-2:" }],
    ["archiveCode without its prefix", { archiveCode: "WAITRON-RECOVERY-KIT-2:abc" }],
    ["backupKey empty", { backupKey: "" }],
    ["backupKey a number", { backupKey: 7 }],
  ])("refuses a wrong %s", (_name, change) => {
    expect(refusal(bytesOf({ ...full, ...change }))).toBe("shape");
  });

  it("refuses bytes that are not the canonical form", () => {
    const canonical = text(buildRecoveryPackFile(full));
    expect(refusal(encoder.encode(" " + canonical))).toBe("noncanonical");
    expect(refusal(encoder.encode(JSON.stringify(full)))).toBe("noncanonical");
  });

  it("refuses a duplicate key, which JSON readers resolve differently", () => {
    const canonical = text(buildRecoveryPackFile(full));
    const doubled = canonical.replace('{"archiveCode":', '{"archiveCode":null,"archiveCode":');
    expect(refusal(encoder.encode(doubled))).toBe("noncanonical");
  });

  it("refuses invalid UTF-8, a byte-order mark and text that is not JSON", () => {
    const canonical = buildRecoveryPackFile(full);
    const broken = new Uint8Array([...canonical.slice(0, 10), 0xff, ...canonical.slice(10)]);
    expect(refusal(broken)).toBe("encoding");
    expect(refusal(new Uint8Array([0xef, 0xbb, 0xbf, ...canonical]))).toBe("encoding");
    expect(refusal(encoder.encode("{not json"))).toBe("encoding");
    expect(refusal(encoder.encode("[]"))).toBe("shape");
  });

  it("refuses an empty file and one over the limit, before parsing", () => {
    expect(refusal(new Uint8Array())).toBe("size");
    const big = { ...full, backupKey: "k".repeat(MAX_PACK_FILE) };
    expect(refusal(encoder.encode(canonicalJson(big)))).toBe("size");
    expect(MAX_PACK_FILE).toBe(16 * 1024);
  });

  it("says which rule refused, in its message", () => {
    expect(() => parseRecoveryPackFile(new Uint8Array())).toThrow(
      "Recovery pack file refused: size",
    );
  });
});

describe("no source file in the package imports a Node built-in (its dependencies are not read)", () => {
  it("imports no Node built-in outside its tests", () => {
    const dir = new URL(".", import.meta.url).pathname;
    const sources = readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .filter((entry) => !entry.name.endsWith(".test.ts"))
      .map((entry) => join(entry.parentPath, entry.name));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/from\s+["'](node:|fs["']|path["'])/);
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\bBuffer\b/);
    }
  });
});
