import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { KeyRing } from "@waitron/credentials";
import { writeFileAtomic } from "./fs-atomic.js";
import { decodeConfigurationBundle, type ConfigurationBundle } from "./configuration-transfer.js";

const ARTIFACT = "configuration-import.artifact";
const KEY = "configuration-import.key";
const MARKER = "configuration-import.json";
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

export interface ConfigurationPreview {
  venue: ConfigurationBundle["venue"];
  counts: Record<string, number>;
  reconnect: string[];
}

export async function stageConfigurationImport(
  stateDir: string,
  ring: KeyRing,
  artifact: Uint8Array,
  passphrase: string,
  validate: (bundle: ConfigurationBundle) => Promise<void>,
): Promise<ConfigurationPreview> {
  const bundle = decodeConfigurationBundle(artifact, passphrase);
  await validate(bundle);
  const counts = Object.fromEntries(
    Object.entries(bundle.tables)
      .filter(([, rows]) => rows.length > 0)
      .map(([name, rows]) => [name, rows.length]),
  );
  await rm(join(stateDir, MARKER), { force: true });
  await writeFileAtomic(join(stateDir, ARTIFACT), artifact, 0o600);
  await writeFileAtomic(join(stateDir, KEY), wrapPassphrase(ring, passphrase), 0o600);
  await writeFileAtomic(join(stateDir, MARKER), JSON.stringify({ version: 1 }), 0o600);
  return { venue: bundle.venue, counts, reconnect: bundle.reconnect };
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
    bundle: decodeConfigurationBundle(artifact, unwrapped),
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
