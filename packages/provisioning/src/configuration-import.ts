import {
  CONFIGURATION_IMPORT_ARTIFACT,
  CONFIGURATION_IMPORT_FILE,
  CONFIGURATION_IMPORT_KEY,
} from "@waitron/store";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { KeyRing } from "@waitron/credentials";
import type { WaitronModule } from "@waitron/module";
import {
  mkdirDurable,
  publishFileDurable,
  syncFolderHolding,
  writeFileDurable,
} from "./fs-atomic.js";
import {
  decodeConfigurationBundleAsync,
  type ConfigurationBundle,
} from "./configuration-transfer.js";

const ARTIFACT = CONFIGURATION_IMPORT_ARTIFACT;
const KEY = CONFIGURATION_IMPORT_KEY;
const MARKER = CONFIGURATION_IMPORT_FILE;
const KEY_AAD = Buffer.from("waitron:configuration-import:passphrase:v1", "utf8");

interface WrappedPassphrase {
  version: 1;
  keyVersion: number;
  iv: string;
  tag: string;
  ciphertext: string;
}

function wrapPassphrase(ring: KeyRing, passphrase: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ring.current.key, iv);
  cipher.setAAD(KEY_AAD);
  const ciphertext = Buffer.concat([cipher.update(passphrase, "utf8"), cipher.final()]);
  return JSON.stringify({
    version: 1,
    keyVersion: ring.current.version,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  } satisfies WrappedPassphrase);
}

function unwrapPassphrase(ring: KeyRing, raw: string): string {
  const wrapped = JSON.parse(raw) as Partial<WrappedPassphrase>;
  const entry = [ring.current, ring.previous].find(
    (candidate) => candidate?.version === wrapped.keyVersion,
  );
  if (
    wrapped.version !== 1 ||
    entry === undefined ||
    typeof wrapped.iv !== "string" ||
    typeof wrapped.tag !== "string" ||
    typeof wrapped.ciphertext !== "string"
  ) {
    throw new Error("invalid staged configuration import key");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", entry.key, Buffer.from(wrapped.iv, "base64"));
    decipher.setAAD(KEY_AAD);
    decipher.setAuthTag(Buffer.from(wrapped.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(wrapped.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("invalid staged configuration import key");
  }
}

/** Named by module, never table, so a renamed table leaves the setup page's words alone. */
export interface ConfigurationPreview {
  venue: ConfigurationBundle["venue"];
  modules: string[];
  reconnectModules: string[];
}

type TransferringModule = Pick<WaitronModule, "name" | "configurationTransfer">;

function previewOf(
  bundle: ConfigurationBundle,
  validated: readonly TransferringModule[],
): ConfigurationPreview {
  const owners = new Map<string, string>();
  for (const module of validated) {
    const transfer = module.configurationTransfer;
    if (transfer?.kind === "tables")
      for (const table of transfer.tables) owners.set(table.name, module.name);
  }
  const ownerOf = (table: string): string => {
    const owner = owners.get(table);
    if (owner === undefined) throw new Error(`no module declares table ${table}`);
    return owner;
  };
  const withRows = new Set<string>();
  for (const [table, rows] of Object.entries(bundle.tables))
    if (rows.length > 0) withRows.add(ownerOf(table));
  const reconnecting = new Set(
    bundle.reconnect
      .filter((table) => Object.hasOwn(bundle.tables, table) && bundle.tables[table]!.length > 0)
      .map(ownerOf),
  );
  const inValidatedOrder = (names: Set<string>) =>
    [...new Set(validated.map((module) => module.name))].filter((name) => names.has(name));
  return {
    venue: bundle.venue,
    modules: inValidatedOrder(withRows),
    reconnectModules: inValidatedOrder(reconnecting),
  };
}

type ValidateConfiguration = (
  bundle: ConfigurationBundle,
) => Promise<readonly TransferringModule[]>;

export async function stageConfigurationImport(
  stateDir: string,
  ring: KeyRing,
  artifact: Uint8Array,
  passphrase: string,
  validate: ValidateConfiguration,
): Promise<ConfigurationPreview> {
  const snapshot = Buffer.from(artifact);
  return validateAndStage(stateDir, ring, snapshot, passphrase, validate, (target) =>
    writeFileDurable(target, snapshot, 0o600),
  );
}

/** Takes over the private upload file once the bundle has been validated. */
export async function stageConfigurationImportFile(
  stateDir: string,
  ring: KeyRing,
  artifactPath: string,
  passphrase: string,
  validate: ValidateConfiguration,
  signal?: AbortSignal,
): Promise<ConfigurationPreview> {
  const artifact = await readFile(artifactPath, { signal });
  return validateAndStage(
    stateDir,
    ring,
    artifact,
    passphrase,
    validate,
    (target) => publishFileDurable(artifactPath, target),
    signal,
  );
}

async function validateAndStage(
  stateDir: string,
  ring: KeyRing,
  artifact: Uint8Array,
  passphrase: string,
  validate: ValidateConfiguration,
  publishArtifact: (target: string) => Promise<void>,
  signal?: AbortSignal,
): Promise<ConfigurationPreview> {
  const bundle = await decodeConfigurationBundleAsync(artifact, passphrase);
  const preview = previewOf(bundle, await validate(bundle));
  const marker = join(stateDir, MARKER);
  await mkdirDurable(dirname(marker), 0o700);
  signal?.throwIfAborted();
  // Disarm the old import durably before its ciphertext and key can disagree after a restart.
  await rm(marker, { force: true });
  await syncFolderHolding(marker);
  try {
    await publishArtifact(join(stateDir, ARTIFACT));
    await writeFileDurable(join(stateDir, KEY), wrapPassphrase(ring, passphrase), 0o600);
    await writeFileDurable(marker, JSON.stringify({ version: 1 }), 0o600);
  } catch (error) {
    await clearStagedConfigurationImport(stateDir);
    throw error;
  }
  return preview;
}

export async function readStagedConfigurationImport(
  stateDir: string,
  ring: KeyRing,
): Promise<{ bundle: ConfigurationBundle; artifact: Uint8Array; passphrase: string } | null> {
  try {
    const marker = JSON.parse(await readFile(join(stateDir, MARKER), "utf8")) as {
      version?: unknown;
    };
    if (marker.version !== 1) throw new Error("invalid staged configuration import");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const [artifact, passphrase] = await Promise.all([
    readFile(join(stateDir, ARTIFACT)),
    readFile(join(stateDir, KEY), "utf8"),
  ]);
  const unwrapped = unwrapPassphrase(ring, passphrase);
  return {
    bundle: await decodeConfigurationBundleAsync(artifact, unwrapped),
    artifact,
    passphrase: unwrapped,
  };
}

export async function clearStagedConfigurationImport(stateDir: string): Promise<void> {
  await rm(join(stateDir, MARKER), { force: true });
  await Promise.all([
    rm(join(stateDir, ARTIFACT), { force: true }),
    rm(join(stateDir, KEY), { force: true }),
  ]);
}
