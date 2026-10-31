import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  readDurableHostJson,
  writeDurableHostJson,
  type BackupRepairRecord,
} from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { encryptArtifactAsync, decryptArtifact } from "./artifact-cipher.js";
import { packArchive, unpackArchive } from "./backup-archive.js";
import { validateDatabaseEntries, type ValidatedArtifact, type ValidationDeps } from "./restore.js";
import type { RecoveryBackupPreview } from "./recovery-backup-preview.js";
import type { SavedCloudRecoveryState } from "./cloud-recovery-v2.js";
import "./errors.js";

type RecordInput = Omit<
  BackupRepairRecord,
  "version" | "sequence" | "previousRecordDigest" | "recordedAt"
>;
const LIMIT = 32 * 1024 * 1024;
const META = "repair-publication.json";
const pathFor = (record: RecordInput) =>
  join(dirname(dirname(record.target.target.stateDir)), "publication.json");
function conflict(): never {
  throw new AppError("setup.attempt_conflict", {});
}
function binding(record: RecordInput) {
  return {
    target: record.target,
    observation: record.observation,
    sourceId: record.sourceId,
    activationSourceId: record.activationSourceId,
    binding: record.binding,
    input: record.input,
    retainedEvidenceDigest: record.retainedEvidenceDigest,
  };
}
export async function readBackupRepairPublication(record: RecordInput) {
  const value = await readDurableHostJson(pathFor(record), LIMIT);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !("version" in value) ||
    value.version !== 1 ||
    !("ciphertext" in value) ||
    typeof value.ciphertext !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.ciphertext)
  )
    conflict();
  return {
    ciphertext: value.ciphertext,
    digest: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  };
}
export async function persistBackupRepairPublication(
  record: RecordInput,
  copy: ValidatedArtifact,
  preview: RecoveryBackupPreview,
  secret: string,
  kind: "archive" | "stream" | "cloud",
  cloudState?: SavedCloudRecoveryState,
) {
  const metadata = {
    version: 1,
    binding: binding(record),
    preview,
    kind,
    ...(cloudState === undefined ? {} : { cloudState }),
  };
  const bytes = packArchive([
    { name: META, bytes: Buffer.from(JSON.stringify(metadata)) },
    { name: "manifest.json", bytes: Buffer.from(JSON.stringify(copy.manifest)) },
    { name: "node.dump", bytes: copy.nodeDump },
    ...copy.secretEntries,
  ]);
  if ((await readDurableHostJson(pathFor(record), LIMIT)) !== null) {
    const saved = await readBackupRepairPublication(record);
    if (!decryptArtifact(Buffer.from(saved.ciphertext, "base64"), secret).equals(bytes)) conflict();
    return saved;
  }
  const ciphertext = await encryptArtifactAsync(bytes, secret);
  await writeDurableHostJson(
    pathFor(record),
    { version: 1, ciphertext: ciphertext.toString("base64") },
    LIMIT,
  );
  return readBackupRepairPublication(record);
}
export async function openBackupRepairPublication(
  record: RecordInput,
  ciphertext: string,
  secret: string,
  databasePath: string,
  deps: Pick<
    ValidationDeps,
    "stateDir" | "stagingDir" | "migrationsRoot" | "modules" | "environment"
  >,
) {
  let bytes;
  try {
    bytes = decryptArtifact(Buffer.from(ciphertext, "base64"), secret);
  } catch {
    throw new AppError("promotion.break_glass_invalid", {});
  }
  const entries = unpackArchive(bytes);
  const metadata = entries.filter((entry) => entry.name === META);
  if (metadata.length !== 1) conflict();
  let metadataValue: unknown;
  try {
    metadataValue = JSON.parse(Buffer.from(metadata[0]!.bytes).toString("utf8"));
  } catch {
    conflict();
  }
  if (
    typeof metadataValue !== "object" ||
    metadataValue === null ||
    Array.isArray(metadataValue) ||
    Object.keys(metadataValue).length !==
      ("kind" in metadataValue && metadataValue.kind === "cloud" ? 5 : 4) ||
    !("version" in metadataValue) ||
    metadataValue.version !== 1 ||
    !("binding" in metadataValue) ||
    !isDeepStrictEqual(metadataValue.binding, binding(record)) ||
    !("kind" in metadataValue) ||
    !["archive", "stream", "cloud"].includes(String(metadataValue.kind)) ||
    (metadataValue.kind === "cloud" &&
      (!("cloudState" in metadataValue) ||
        typeof metadataValue.cloudState !== "object" ||
        metadataValue.cloudState === null ||
        Array.isArray(metadataValue.cloudState))) ||
    !("preview" in metadataValue) ||
    typeof metadataValue.preview !== "object" ||
    metadataValue.preview === null ||
    Array.isArray(metadataValue.preview)
  )
    conflict();
  const value = metadataValue as {
    preview: RecoveryBackupPreview;
    kind: "archive" | "stream" | "cloud";
    cloudState?: SavedCloudRecoveryState;
  };
  const copy = await validateDatabaseEntries(
    entries.filter((entry) => entry.name !== META),
    databasePath,
    deps,
  );
  if (
    value.preview.sourceId !== record.sourceId ||
    (value.preview.activationSourceId ?? value.preview.sourceId) !== record.activationSourceId ||
    value.preview.environment !== deps.environment
  )
    conflict();
  return {
    copy: { ...copy, sourceId: record.activationSourceId },
    preview: value.preview,
    kind: value.kind,
    ...(value.cloudState === undefined ? {} : { cloudState: value.cloudState }),
  };
}
