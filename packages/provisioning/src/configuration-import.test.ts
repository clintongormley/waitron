import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import { configurationBundle } from "../test/configuration-bundle.js";
import { encodeConfigurationBundle } from "./configuration-transfer.js";
import {
  clearStagedConfigurationImport,
  readStagedConfigurationImport,
  stageConfigurationImport,
} from "./configuration-import.js";

const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 91).toString("base64") });
const passphrase = "SYNTHETIC export passphrase";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "configuration-stage-"));
  roots.push(root);
  return root;
}
async function staged() {
  const root = await directory();
  const bundle = configurationBundle();
  bundle.tables = { printers: [{ id: "printer" }], empty: [] };
  bundle.reconnect = ["printers"];
  const artifact = encodeConfigurationBundle(bundle, passphrase);
  const preview = await stageConfigurationImport(root, ring, artifact, passphrase, async () => {});
  return { root, bundle, artifact, preview };
}

it("keeps the exact artifact and decrypts its passphrase after restart and key rotation", async () => {
  const { root, artifact, bundle, preview } = await staged();
  expect(preview).toEqual({
    venue: bundle.venue,
    counts: { printers: 1 },
    reconnect: ["printers"],
  });
  const rotated: KeyRing = {
    current: { version: 2, key: Buffer.alloc(32, 92) },
    previous: ring.current,
  };
  const held = await readStagedConfigurationImport(root, rotated);
  expect(held).toEqual({ bundle, artifact, passphrase });
  expect(await readStagedConfigurationImport(root, ring)).toEqual(held);
  const wrapped = await readFile(join(root, "configuration-import.key"), "utf8");
  expect(wrapped).not.toContain(passphrase);
  for (const name of ["artifact", "key", "json"])
    expect((await stat(join(root, `configuration-import.${name}`))).mode & 0o777).toBe(0o600);
  await clearStagedConfigurationImport(root);
  expect(await readStagedConfigurationImport(root, ring)).toBeNull();
  for (const name of ["artifact", "key", "json"])
    await expect(stat(join(root, `configuration-import.${name}`))).rejects.toMatchObject({
      code: "ENOENT",
    });
  await clearStagedConfigurationImport(root);
});

it("preserves a usable staged import when replacement validation refuses", async () => {
  const { root, artifact, bundle } = await staged();
  const replacement = configurationBundle();
  replacement.venue.legalName = "Refused replacement";
  await expect(
    stageConfigurationImport(
      root,
      ring,
      encodeConfigurationBundle(replacement, passphrase),
      passphrase,
      async () => {
        throw new Error("synthetic schema refusal");
      },
    ),
  ).rejects.toThrow("synthetic schema refusal");
  expect(await readStagedConfigurationImport(root, ring)).toEqual({ bundle, artifact, passphrase });
});

it("ignores an incomplete stage until its publication marker exists", async () => {
  const root = await directory();
  await writeFile(join(root, "configuration-import.key"), "unfinished");
  expect(await readStagedConfigurationImport(root, ring)).toBeNull();
  await writeFile(join(root, "configuration-import.json"), JSON.stringify({ version: 2 }));
  await expect(readStagedConfigurationImport(root, ring)).rejects.toThrow(
    "invalid staged configuration import",
  );
  await writeFile(join(root, "configuration-import.json"), "{");
  await expect(readStagedConfigurationImport(root, ring)).rejects.toBeInstanceOf(SyntaxError);
});

it.each([
  ["version", 2],
  ["keyVersion", 99],
  ["iv", null],
  ["tag", null],
  ["ciphertext", null],
  ["tag", Buffer.alloc(16).toString("base64")],
] as const)("refuses a changed wrapped key %s=%s", async (field, value) => {
  const { root } = await staged();
  const path = join(root, "configuration-import.key");
  const wrapped = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  wrapped[field] = value;
  await writeFile(path, JSON.stringify(wrapped));
  await expect(readStagedConfigurationImport(root, ring)).rejects.toThrow(
    "invalid staged configuration import key",
  );
});

it("refuses a replacement key with the same version and a changed encrypted artifact", async () => {
  const { root, artifact } = await staged();
  await expect(
    readStagedConfigurationImport(root, {
      current: { version: ring.current.version, key: Buffer.alloc(32, 93) },
    }),
  ).rejects.toThrow("invalid staged configuration import key");
  const damaged = Buffer.from(artifact);
  damaged[damaged.length - 1]! ^= 1;
  await writeFile(join(root, "configuration-import.artifact"), damaged);
  await expect(readStagedConfigurationImport(root, ring)).rejects.toMatchObject({
    code: "recovery.passphrase_invalid",
  });
});
