import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALL_MODULES } from "@waitron/composition";
import { buildManifest } from "./backup-manifest.js";
import { packArchive, type ArchiveEntry } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { validateArtifactFile } from "./restore.js";
import * as fileIo from "./artifact-file-io.js";
import { validateBackupArtifactFile as validate } from "./backup-verification-archive.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });
const modules = ALL_MODULES.filter((m) => m.name === "core");
const node = "20000000-0000-4000-8000-000000000002";
const capturedAt = "2026-10-20T08:00:00.000Z";
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "a850-strict-archive-"));
  roots.push(root);
  const stagingDir = join(root, "staging");
  const stateDir = join(root, "state");
  await mkdir(stagingDir);
  await mkdir(stateDir);
  const source = join(root, "source.db");
  await suite.db.archiveTo(source);
  const manifest = await buildManifest({
    db: suite.db,
    modules,
    environment: "preproduction",
    now: new Date(capturedAt),
  });
  const entries: ArchiveEntry[] = [
    { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
    { name: "db.dump", bytes: await readFile(source) },
    {
      name: "secrets/trading.env",
      bytes: Buffer.from(
        `WAITRON_TILL_NODE_ID=${node}\nWAITRON_TILL_LOCATION_ID=10000000-0000-4000-8000-000000000001\nWAITRON_ENV=preproduction\n`,
      ),
    },
    { name: "secrets/secrets.env", bytes: Buffer.from("private-vault-input") },
  ];
  const archive = {
    sha256: "a".repeat(64),
    bytes: 1,
    manifestVersion: 1,
    environment: "preproduction" as const,
    modules: { ...manifest.modules },
  };
  return {
    root,
    entries,
    manifest,
    artifactPath: join(root, "artifact.enc"),
    recoveryKey: "test-passphrase",
    stateDir,
    stagingDir,
    migrationsRoot: null,
    environment: "preproduction" as const,
    modules,
    expected: { capturedAt, sourceNodeId: node, archive },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function seal(f: Fixture, plaintext = packArchive(f.entries)) {
  const encrypted = encryptArtifact(plaintext, f.recoveryKey);
  await writeFile(f.artifactPath, encrypted);
  f.expected.archive.sha256 = createHash("sha256").update(encrypted).digest("hex");
  f.expected.archive.bytes = encrypted.length;
  return encrypted;
}
function rawManifest(f: Fixture, raw: string) {
  f.entries[0] = { name: "manifest.json", bytes: Buffer.from(raw) };
}
const invalid = { status: "invalid", reason: "archive_invalid" };
const unsupported = { status: "unsupported", reason: "archive_format_unsupported" };
async function refuses(f: Fixture, expected: Record<string, unknown> = invalid) {
  await expect(validate(f)).rejects.toMatchObject(expected);
  expect(await readdir(f.stagingDir)).toEqual([]);
  expect(await readdir(f.stateDir)).toEqual([]);
}

describe("authenticated verification archive", () => {
  it("owns a protected extracted database, retains ciphertext and exposes no stream source identity", async () => {
    const f = await fixture();
    const encrypted = await seal(f);
    const reads = vi.spyOn(fileIo, "readExactly");
    const validated = await validate(f);
    expect(validated.manifest).toEqual(f.manifest);
    expect(validated.sourceId).toBeUndefined();
    expect((await stat(validated.databasePath)).mode & 0o777).toBe(0o600);
    expect((await stat(join(validated.databasePath, ".."))).mode & 0o777).toBe(0o700);
    expect(await readdir(join(validated.databasePath, ".."))).toEqual(["venue.db"]);
    expect(await readFile(validated.databasePath)).toEqual(f.entries[1].bytes);
    expect(Math.max(...reads.mock.calls.map((call) => call[1]))).toBeLessThanOrEqual(65536);
    expect(validated.secretEntries.map((e) => e.name)).toEqual([
      "secrets/trading.env",
      "secrets/secrets.env",
    ]);
    await validated.discard();
    await validated.discard();
    expect(await readdir(f.stagingDir)).toEqual([]);
    expect(await readFile(f.artifactPath)).toEqual(encrypted);
  });
  it.each([
    "duplicate top",
    "duplicate modules",
    "escaped duplicate",
    "unknown top",
    "array",
    "malformed",
    "missing field",
    "invalid date",
    "invalid modules",
    "negative schema",
  ])("refuses raw manifest %s", async (mode) => {
    const f = await fixture();
    let raw = JSON.stringify(f.manifest);
    if (mode === "duplicate top")
      raw = raw.replace('"manifestVersion":1', '"manifestVersion":1,"manifestVersion":1');
    if (mode === "duplicate modules") raw = raw.replace(/"core":(\d+)/, '"core":$1,"core":$1');
    if (mode === "escaped duplicate")
      raw = raw.replace('"manifestVersion":1', '"manifestVersion":1,"manifest\\u0056ersion":1');
    if (mode === "unknown top") raw = raw.replace("{", '{"hidden":"private-value",');
    if (mode === "array") raw = "[]";
    if (mode === "malformed") raw = "{";
    if (mode === "missing field") {
      const remaining: Record<string, unknown> = { ...f.manifest };
      delete remaining.createdAt;
      raw = JSON.stringify(remaining);
    }
    if (mode === "invalid date") raw = JSON.stringify({ ...f.manifest, createdAt: "bad" });
    if (mode === "invalid modules") raw = JSON.stringify({ ...f.manifest, modules: [] });
    if (mode === "negative schema") raw = JSON.stringify({ ...f.manifest, modules: { core: -1 } });
    rawManifest(f, raw);
    await seal(f);
    await refuses(f);
  });
  it.each([
    "time",
    "environment",
    "node",
    "version",
    "module count",
    "extra module",
    "missing module",
  ])("refuses private binding mismatch: %s", async (mode) => {
    const f = await fixture();
    await seal(f);
    if (mode === "time") f.expected.capturedAt = "2026-10-20T08:00:01.000Z";
    if (mode === "environment") f.expected.archive.environment = "production" as "preproduction";
    if (mode === "node") f.expected.sourceNodeId = "30000000-0000-4000-8000-000000000003";
    if (mode === "version") f.expected.archive.manifestVersion = 2;
    if (mode === "module count") f.expected.archive.modules.core!++;
    if (mode === "extra module") f.expected.archive.modules.extra = 0;
    if (mode === "missing module") delete f.expected.archive.modules.core;
    await refuses(f, { status: "invalid", reason: "binding_mismatch" });
  });
  it.each(["manifest", "archive", "cipher"])(
    "classifies unknown %s version as unsupported",
    async (mode) => {
      const f = await fixture();
      let plaintext = packArchive(f.entries);
      if (mode === "manifest") {
        rawManifest(f, JSON.stringify({ ...f.manifest, manifestVersion: 2 }));
        plaintext = packArchive(f.entries);
      }
      if (mode === "archive") plaintext[4] = 2;
      const encrypted = await seal(f, plaintext);
      if (mode === "cipher") {
        encrypted[4] = 255;
        await writeFile(f.artifactPath, encrypted);
      }
      await refuses(f, unsupported);
    },
  );
  it.each([
    "duplicate db",
    "missing db",
    "duplicate manifest",
    "missing manifest",
    "unsafe destination",
    "duplicate destination",
    "missing identity",
  ])("keeps shared archive validation: %s", async (mode) => {
    const f = await fixture();
    let code = "restore.unsafe_entry_path";
    if (mode === "duplicate db") f.entries.push(f.entries[1]);
    if (mode === "missing db") {
      f.entries.splice(1, 1);
      code = "restore.archive_incomplete";
    }
    if (mode === "duplicate manifest") f.entries.push(f.entries[0]);
    if (mode === "missing manifest") {
      f.entries.splice(0, 1);
      code = "restore.archive_incomplete";
    }
    if (mode === "unsafe destination")
      f.entries.push({ name: "secrets/../../escape", bytes: Buffer.from("private") });
    if (mode === "duplicate destination")
      f.entries.push({ name: "secrets/./secrets.env", bytes: Buffer.from("private") });
    if (mode === "missing identity") {
      f.entries = f.entries.filter((e) => e.name !== "secrets/trading.env");
      code = "restore.identity_incomplete";
    }
    await seal(f);
    await refuses(f, { code });
  });
  it("refuses trailing framing bytes while the ordinary caller keeps its behavior", async () => {
    const f = await fixture();
    await seal(f, Buffer.concat([packArchive(f.entries), Buffer.from("trailing")]));
    await refuses(f, { code: "backup.archive_invalid", params: { reason: "trailing_data" } });
    const ordinary = await validateArtifactFile(f);
    expect(ordinary.manifest).toEqual(f.manifest);
    await ordinary.discard();
    expect(await readdir(f.stagingDir)).toEqual([]);
  });
  it("authenticates before interpreting even malformed framing and leaves no plaintext", async () => {
    const f = await fixture();
    const encrypted = await seal(f, Buffer.from("not WBA"));
    encrypted[33] ^= 1;
    await writeFile(f.artifactPath, encrypted);
    await refuses(f, { code: "recovery.passphrase_invalid" });
    expect(await readFile(f.artifactPath)).toEqual(encrypted);
  });
  it("keeps a wrong GCM key inconclusive for the host", async () => {
    const f = await fixture();
    await seal(f);
    f.recoveryKey = "wrong-passphrase";
    await refuses(f, { code: "recovery.passphrase_invalid" });
  });
  it("rejects a raw UTF-8 byte-order marker before shared JSON validation", async () => {
    const f = await fixture();
    rawManifest(f, "\uFEFF" + JSON.stringify(f.manifest));
    await seal(f);
    await refuses(f);
  });
  it.each([
    "null",
    "true",
    "false",
    "[true,false,null,{},[]]",
    "[1,2]",
    "[1 2]",
    '{"manifestVersion" 1}',
    '{"manifestVersion":1 "createdAt":0}',
    '{"manifestVersion":1,}',
    '"unterminated',
    '"bad\\x"',
    "undefined",
    "{}",
  ])("refuses malformed or non-manifest JSON %s", async (raw) => {
    const f = await fixture();
    rawManifest(f, raw);
    await seal(f);
    await refuses(f);
  });
  it.each([
    "depth",
    "trailing",
    "utf8",
    "date type",
    "date normalization",
    "date range",
    "environment",
    "module name",
    "fractional schema",
    "version type",
    "zero version",
    "same-length keys",
  ])("refuses additional raw boundary %s", async (mode) => {
    const f = await fixture();
    let value: unknown = f.manifest;
    if (mode === "date type") value = { ...f.manifest, createdAt: 0 };
    if (mode === "date normalization")
      value = { ...f.manifest, createdAt: "2026-02-30T08:00:00.000Z" };
    if (mode === "date range") value = { ...f.manifest, createdAt: "2026-13-20T08:00:00.000Z" };
    if (mode === "environment") value = { ...f.manifest, environment: "unknown" };
    if (mode === "module name") value = { ...f.manifest, modules: { "../private": 0 } };
    if (mode === "fractional schema") value = { ...f.manifest, modules: { core: 1.5 } };
    if (mode === "version type") value = { ...f.manifest, manifestVersion: "1" };
    if (mode === "zero version") value = { ...f.manifest, manifestVersion: 0 };
    if (mode === "same-length keys")
      value = {
        manifestVersion: 1,
        createdAt: capturedAt,
        environment: "preproduction",
        other: {},
      };
    let raw = JSON.stringify(value);
    if (mode === "depth") raw = "[".repeat(34) + "0" + "]".repeat(34);
    if (mode === "trailing") raw += "null";
    rawManifest(f, raw);
    if (mode === "utf8") f.entries[0] = { name: "manifest.json", bytes: Buffer.from([0xff]) };
    await seal(f);
    await refuses(f);
  });
  it("compares complete module maps by values despite their key order", async () => {
    const f = await fixture();
    const source = {
      ...f.manifest,
      modules: { media: 0, core: f.manifest.modules.core!, catalogue: 0 },
    };
    f.modules = ALL_MODULES.filter((m) => ["core", "catalogue", "media"].includes(m.name));
    rawManifest(f, JSON.stringify(source, null, 2));
    f.expected.archive.modules = { catalogue: 0, core: f.manifest.modules.core!, media: 0 };
    await seal(f);
    const validated = await validate(f);
    expect(validated.manifest.modules).toEqual(source.modules);
    await validated.discard();
    expect(await readdir(f.stagingDir)).toEqual([]);
  });
  it("classifies a future manifest with different fields as unsupported", async () => {
    const f = await fixture();
    rawManifest(f, '{"manifestVersion":2,"future":[true,null]}');
    await seal(f);
    await refuses(f, unsupported);
  });
  it("ignores an untyped skipSecrets field and still checks identity", async () => {
    const f = await fixture();
    f.entries = f.entries.filter((e) => e.name !== "secrets/trading.env");
    await seal(f);
    await refuses(Object.assign(f, { skipSecrets: true }), { code: "restore.identity_incomplete" });
  });
  it.each(["string parser", "text decoder"])(
    "keeps unexpected %s failures inconclusive",
    async (mode) => {
      const f = await fixture();
      await seal(f);
      const failure = new Error("synthetic parser infrastructure failure");
      if (mode === "string parser") {
        const original = JSON.parse;
        vi.spyOn(JSON, "parse").mockImplementation((raw: string, reviver) => {
          if (raw === '"manifestVersion"') throw failure;
          return original(raw, reviver);
        });
      } else
        vi.spyOn(TextDecoder.prototype, "decode").mockImplementation(() => {
          throw failure;
        });
      await expect(validate(f)).rejects.toBe(failure);
      expect(await readdir(f.stagingDir)).toEqual([]);
    },
  );
  it("propagates input I/O failures with no extracted state", async () => {
    const f = await fixture();
    await refuses(f, { code: "ENOENT" });
  });
});
