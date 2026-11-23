import { dirname, join } from "node:path";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import { configurationBundle } from "../test/configuration-bundle.js";
import { encodeConfigurationBundle } from "./configuration-transfer.js";
import {
  clearStagedConfigurationImport,
  readStagedConfigurationImport,
  stageConfigurationImport,
  stageConfigurationImportFile,
} from "./configuration-import.js";

vi.mock("node:fs/promises", { spy: true });

const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 91).toString("base64") });
const passphrase = "SYNTHETIC export passphrase";
const roots: string[] = [];
afterEach(async () => {
  vi.mocked(fs.open).mockReset();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "configuration-stage-"));
  roots.push(root);
  return root;
}
const modules = [
  {
    name: "core",
    configurationTransfer: {
      kind: "tables",
      tables: [{ name: "printers", reconnect: true }, { name: "products" }],
    },
  },
  { name: "menu", configurationTransfer: { kind: "tables", tables: [{ name: "units" }] } },
  { name: "media", configurationTransfer: { kind: "tables", tables: [{ name: "images" }] } },
  { name: "bookings", configurationTransfer: { kind: "none" } },
] as const;
const validated = async () => modules;
async function staged() {
  const root = await directory();
  const bundle = configurationBundle();
  bundle.tables = { printers: [{ id: "printer" }], empty: [] };
  bundle.reconnect = ["printers"];
  const artifact = encodeConfigurationBundle(bundle, passphrase);
  const preview = await stageConfigurationImport(root, ring, artifact, passphrase, validated);
  return { root, bundle, artifact, preview };
}

it("keeps the exact artifact and decrypts its passphrase after restart and key rotation", async () => {
  const { root, artifact, bundle, preview } = await staged();
  expect(preview).toEqual({
    venue: bundle.venue,
    modules: ["core"],
    reconnectModules: ["core"],
  });
  const rotated: KeyRing = {
    current: { version: 2, key: Buffer.alloc(32, 92) },
    previous: ring.current,
  };
  const held = await readStagedConfigurationImport(root, rotated);
  expect(held).toEqual({ bundle, artifact, passphrase });
  expect(await readStagedConfigurationImport(root, ring)).toEqual(held);
  const wrapped = await readFile(join(root, "flows/setup/import/key"), "utf8");
  expect(wrapped).not.toContain(passphrase);
  for (const name of ["artifact", "key", "marker.json"])
    expect((await stat(join(root, `flows/setup/import/${name}`))).mode & 0o777).toBe(0o600);
  await clearStagedConfigurationImport(root);
  expect(await readStagedConfigurationImport(root, ring)).toBeNull();
  for (const name of ["artifact", "key", "marker.json"])
    await expect(stat(join(root, `flows/setup/import/${name}`))).rejects.toMatchObject({
      code: "ENOENT",
    });
  await clearStagedConfigurationImport(root);
});

it("names the modules with entries in the validated list's order and leaves out the rest", async () => {
  const root = await directory();
  const bundle = configurationBundle();
  bundle.tables = {
    units: [{ id: "unit" }],
    images: [],
    printers: [],
    products: [{ id: "one" }, { id: "two" }],
  };
  bundle.reconnect = ["printers", "missing", "constructor"];
  const artifact = encodeConfigurationBundle(bundle, passphrase);
  await expect(
    stageConfigurationImport(root, ring, artifact, passphrase, validated),
  ).resolves.toEqual({ venue: bundle.venue, modules: ["core", "menu"], reconnectModules: [] });
});

it("names a module called constructor or __proto__ like any other", async () => {
  const root = await directory();
  const bundle = configurationBundle();
  bundle.tables = { kept: [{ id: "one" }], plugged: [{ id: "two" }, { id: "three" }] };
  bundle.reconnect = ["plugged"];
  const artifact = encodeConfigurationBundle(bundle, passphrase);
  const awkward = [
    { name: "constructor", configurationTransfer: { kind: "tables", tables: [{ name: "kept" }] } },
    {
      name: "__proto__",
      configurationTransfer: { kind: "tables", tables: [{ name: "plugged", reconnect: true }] },
    },
  ] as const;
  await expect(
    stageConfigurationImport(root, ring, artifact, passphrase, async () => awkward),
  ).resolves.toEqual({
    venue: bundle.venue,
    modules: ["constructor", "__proto__"],
    reconnectModules: ["__proto__"],
  });
});

it("refuses to preview a table no validated module declares", async () => {
  const root = await directory();
  const bundle = configurationBundle();
  bundle.tables = { undeclared: [{ id: "row" }] };
  const artifact = encodeConfigurationBundle(bundle, passphrase);
  await expect(
    stageConfigurationImport(root, ring, artifact, passphrase, validated),
  ).rejects.toThrow("undeclared");
  expect(await readStagedConfigurationImport(root, ring)).toBeNull();
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
  await mkdir(join(root, "flows/setup/import"), { recursive: true });
  await mkdir(dirname(join(root, "flows/setup/import/key")), { recursive: true });
  await writeFile(join(root, "flows/setup/import/key"), "unfinished");
  expect(await readStagedConfigurationImport(root, ring)).toBeNull();
  await mkdir(dirname(join(root, "flows/setup/import/marker.json")), { recursive: true });
  await writeFile(join(root, "flows/setup/import/marker.json"), JSON.stringify({ version: 2 }));
  await expect(readStagedConfigurationImport(root, ring)).rejects.toThrow(
    "invalid staged configuration import",
  );
  await mkdir(dirname(join(root, "flows/setup/import/marker.json")), { recursive: true });
  await writeFile(join(root, "flows/setup/import/marker.json"), "{");
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
  const path = join(root, "flows/setup/import/key");
  const wrapped = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  wrapped[field] = value;
  await mkdir(dirname(path), { recursive: true });
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
  await mkdir(dirname(join(root, "flows/setup/import/artifact")), { recursive: true });
  await writeFile(join(root, "flows/setup/import/artifact"), damaged);
  await expect(readStagedConfigurationImport(root, ring)).rejects.toMatchObject({
    code: "recovery.passphrase_invalid",
  });
});

it("refuses an excluded bundle zone before staging and preserves the earlier artifact", async () => {
  const { root, artifact } = await staged();
  const replacement = configurationBundle();
  replacement.venue.timeZone = "Europe/Madrid";
  const encoded = encodeConfigurationBundle(replacement, passphrase);
  await expect(
    stageConfigurationImport(root, ring, encoded, passphrase, async () => []),
  ).rejects.toMatchObject({ code: "venue.time_zone_invalid", params: { reason: "country" } });
  expect((await readStagedConfigurationImport(root, ring))!.artifact).toEqual(artifact);
});

it("disarms an import whose publication failed at folder sync", async () => {
  const root = await directory();
  const artifact = encodeConfigurationBundle(configurationBundle(), passphrase);
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    if (
      String(args[0]) === join(root, "flows/setup/import") &&
      existsSync(join(root, "flows/setup/import/marker.json"))
    )
      throw Object.assign(new Error("folder sync failed"), { code: "EIO" });
    return actual.open(...args);
  });
  await expect(
    stageConfigurationImport(root, ring, artifact, passphrase, async () => []),
  ).rejects.toMatchObject({ code: "EIO" });
  expect(await readStagedConfigurationImport(root, ring)).toBeNull();
});

it("publishes the validated ciphertext from a completed upload", async () => {
  const root = await directory();
  const uploaded = join(root, "uploaded");
  const bundle = configurationBundle();
  const artifact = encodeConfigurationBundle(bundle, passphrase);
  await writeFile(uploaded, artifact, { mode: 0o600 });

  await expect(
    stageConfigurationImportFile(root, ring, uploaded, passphrase, validated),
  ).resolves.toEqual({ venue: bundle.venue, modules: [], reconnectModules: [] });
  expect(await readStagedConfigurationImport(root, ring)).toEqual({ bundle, artifact, passphrase });
  expect(existsSync(uploaded)).toBe(false);
});

it.each(["validation", "disconnect"])(
  "keeps the earlier import when replacement stops during %s",
  async (reason) => {
    const { root, bundle, artifact } = await staged();
    const uploaded = join(root, "uploaded");
    const replacement = configurationBundle();
    replacement.venue.legalName = "Replacement venue";
    await writeFile(uploaded, encodeConfigurationBundle(replacement, passphrase));
    const abort = new AbortController();
    const stopped = new Error("replacement stopped");

    await expect(
      stageConfigurationImportFile(
        root,
        ring,
        uploaded,
        passphrase,
        async () => {
          if (reason === "validation") throw stopped;
          abort.abort(stopped);
          return [];
        },
        abort.signal,
      ),
    ).rejects.toBe(stopped);
    expect(await readStagedConfigurationImport(root, ring)).toEqual({
      bundle,
      artifact,
      passphrase,
    });
  },
);

it("disarms the old import before replacing its ciphertext and leaves an incomplete replacement unreadable", async () => {
  const { root } = await staged();
  const uploaded = join(root, "uploaded");
  const replacement = configurationBundle();
  replacement.venue.legalName = "Replacement venue";
  const artifact = encodeConfigurationBundle(replacement, passphrase);
  await writeFile(uploaded, artifact);
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  const stopped = new Error("could not write key");
  vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]) === join(root, "flows/setup/import/key.tmp")) {
      expect(await readFile(join(root, "flows/setup/import/artifact"))).toEqual(artifact);
      expect(await readStagedConfigurationImport(root, ring)).toBeNull();
      throw stopped;
    }
    return actual.open(...args);
  });

  await expect(
    stageConfigurationImportFile(root, ring, uploaded, passphrase, validated),
  ).rejects.toBe(stopped);
  expect(await readStagedConfigurationImport(root, ring)).toBeNull();
});

it("yields before validating a configuration import", async () => {
  const root = await directory();
  const artifact = encodeConfigurationBundle(configurationBundle(), passphrase);
  const order: string[] = [];
  const timer = new Promise<void>((resolve) =>
    setTimeout(() => {
      order.push("timer");
      resolve();
    }, 0),
  );
  await Promise.all([
    stageConfigurationImport(root, ring, artifact, passphrase, async () => {
      order.push("validated");
      return [];
    }),
    timer,
  ]);
  expect(order).toEqual(["timer", "validated"]);
});

it("stages the ciphertext it authenticated even if the caller changes its buffer during derivation", async () => {
  const root = await directory();
  const artifact = encodeConfigurationBundle(configurationBundle(), passphrase);
  const original = Buffer.from(artifact);
  const staging = stageConfigurationImport(root, ring, artifact, passphrase, async () => []);
  artifact.fill(0);
  await staging;
  expect(await readFile(join(root, "flows/setup/import/artifact"))).toEqual(original);
  expect((await readStagedConfigurationImport(root, ring))!.bundle).toEqual(configurationBundle());
});
