import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "./fs-atomic.js";
import { decodeConfigurationBundle, type ConfigurationBundle } from "./configuration-transfer.js";

const ARTIFACT = "configuration-import.artifact";
const KEY = "configuration-import.key";
const MARKER = "configuration-import.json";

export interface ConfigurationPreview {
  venue: ConfigurationBundle["venue"];
  counts: Record<string, number>;
  reconnect: string[];
}

export async function stageConfigurationImport(
  stateDir: string,
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
  await writeFileAtomic(join(stateDir, KEY), passphrase, 0o600);
  await writeFileAtomic(join(stateDir, MARKER), JSON.stringify({ version: 1 }), 0o600);
  return { venue: bundle.venue, counts, reconnect: bundle.reconnect };
}

export async function readStagedConfigurationImport(
  stateDir: string,
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
  return { bundle: decodeConfigurationBundle(artifact, passphrase), artifact, passphrase };
}

export async function clearStagedConfigurationImport(stateDir: string): Promise<void> {
  await rm(join(stateDir, MARKER), { force: true });
  await Promise.all([
    rm(join(stateDir, ARTIFACT), { force: true }),
    rm(join(stateDir, KEY), { force: true }),
  ]);
}
