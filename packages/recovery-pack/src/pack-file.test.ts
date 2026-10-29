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

const serverKey = {
  kind: "waitron-recovery-document",
  version: 1,
  scope: { taxpayerNif: "B12345678", softwareId: "01", environment: "preproduction" },
  taxpayerName: "Bar Example SL",
  venueName: "Bar Example",
  createdAt: "2026-10-12T09:30:00.000Z",
  nodeKey: { nodeId: "node-1", name: "2026-10-12 · key", secret: "A".repeat(32) },
};

const full: RecoveryPackFile = {
  kind: "waitron-recovery-pack",
  version: 1,
  number: 3,
  madeAt: "2026-10-29T17:00:00.000Z",
  bucketCode: "WAITRON-RECOVERY-KIT-1:" + "b".repeat(600),
  archiveCode: "WAITRON-ARCHIVE-PACK-1:" + "c".repeat(400),
  backupKey: "k".repeat(43),
  serverKey,
  serverKeyName: "2026-10-12 · key",
  serverKeyHeldBy: null,
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
  it("builds canonical bytes: keys sorted at every depth, no spaces", () => {
    const bytes = buildRecoveryPackFile(full);
    const out = text(bytes);
    expect(out.startsWith('{"archiveCode":')).toBe(true);
    expect(out).toContain('"scope":{"environment":"preproduction","softwareId":"01"');
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
      serverKey: null,
      serverKeyName: "2026-10-12 · key",
      serverKeyHeldBy: { number: 2, madeOn: "2026-10-12", received: false },
    };
    expect(parseRecoveryPackFile(buildRecoveryPackFile(bare))).toEqual(bare);
    const none = { ...bare, serverKeyName: null, serverKeyHeldBy: null };
    expect(parseRecoveryPackFile(buildRecoveryPackFile(none))).toEqual(none);
  });

  it("carries the server key byte for byte", () => {
    const out = text(buildRecoveryPackFile(full));
    expect(out).toContain(`"serverKey":${canonicalJson(serverKey)}`);
  });

  it("refuses to build a file it would refuse to read", () => {
    expect(() => buildRecoveryPackFile({ ...full, number: 0 })).toThrow(RecoveryPackFileError);
    expect(() =>
      buildRecoveryPackFile({ ...full, bucketCode: full.bucketCode + "b".repeat(MAX_PACK_FILE) }),
    ).toThrow("Recovery pack file refused: size");
  });

  it("refuses a missing key and an extra key", () => {
    const missing: Partial<RecoveryPackFile> = { ...full };
    delete missing.backupKey;
    expect(refusal(bytesOf(missing))).toBe("shape");
    expect(refusal(bytesOf({ ...full, extra: "secret" }))).toBe("shape");
    expect(
      refusal(bytesOf({ ...full, serverKeyHeldBy: { number: 2, madeOn: "2026-10-12" } })),
    ).toBe("shape");
    expect(
      refusal(
        bytesOf({
          ...full,
          serverKey: null,
          serverKeyHeldBy: { number: 2, madeOn: "2026-10-12", received: true, extra: 1 },
        }),
      ),
    ).toBe("shape");
  });

  it.each([
    ["kind", { kind: "waitron-recovery-document" }],
    ["version", { version: 2 }],
    ["number zero", { number: 0 }],
    ["number fraction", { number: 1.5 }],
    ["number as text", { number: "3" }],
    ["madeAt not a time", { madeAt: "yesterday" }],
    ["madeAt without milliseconds", { madeAt: "2026-10-29T17:00:00Z" }],
    ["madeAt an impossible day", { madeAt: "2026-02-30T17:00:00.000Z" }],
    ["bucketCode without its prefix", { bucketCode: "b".repeat(40) }],
    ["bucketCode with a space", { bucketCode: "WAITRON-RECOVERY-KIT-1:ab cd" }],
    ["bucketCode prefix alone", { bucketCode: "WAITRON-RECOVERY-KIT-1:" }],
    ["archiveCode without its prefix", { archiveCode: "WAITRON-RECOVERY-KIT-1:abc" }],
    ["backupKey empty", { backupKey: "" }],
    ["backupKey with a line break", { backupKey: "abc\ndef" }],
    ["backupKey a number", { backupKey: 7 }],
    ["serverKey an array", { serverKey: [1] }],
    ["serverKey text", { serverKey: "key" }],
    ["serverKeyName empty", { serverKeyName: "" }],
    ["serverKeyName padded", { serverKeyName: " key" }],
    [
      "heldBy number zero",
      { serverKeyHeldBy: { number: 0, madeOn: "2026-10-12", received: true } },
    ],
    ["heldBy bad day", { serverKeyHeldBy: { number: 2, madeOn: "2026-13-01", received: true } }],
    [
      "heldBy received as text",
      { serverKeyHeldBy: { number: 2, madeOn: "2026-10-12", received: "yes" } },
    ],
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

describe("the package runs in a browser", () => {
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
