import { backupKey, masterKeyId, masterKeyNameOf, sealingPublicKey } from "@waitron/credentials";
import { readArtifactHeader, type ArtifactHeader } from "@waitron/provisioning";
import { AppError, decodeMasterKeyCode, isAppError } from "@waitron/shared";
import { readArtifactFileHeader } from "./artifact-cipher-file.js";
import type { BackupKeyRecord } from "./backup-env-writer.js";
import "./errors.js";

export type BackupFileSource = { artifactPath: string } | { artifact: Uint8Array };

/** The backup key text that opens a version 2 file, derived from a typed master key. A key that
 * does not decode, or is not the master key the header names, is refused with the header's master
 * key id, number and name. A version 1 file is refused before any key is derived. */
export async function openingKeyFor(
  source: BackupFileSource,
  masterKeyText: string,
): Promise<string> {
  const header =
    "artifactPath" in source
      ? await readArtifactFileHeader(source.artifactPath)
      : readArtifactHeader(source.artifact);
  if (header.version !== 2) {
    throw new AppError("backup.artifact_invalid", { reason: "bad_version" });
  }
  const wrongKey = new AppError("promotion.break_glass_invalid", {
    masterKeyId: header.masterKeyId.toString("hex"),
    keyNumber: header.keyNumber,
    keyName: masterKeyNameOf(header.masterKeyId, header.masterKeyDay),
  });
  let masterKey: Uint8Array;
  try {
    masterKey = decodeMasterKeyCode(masterKeyText);
  } catch (error) {
    if (isAppError(error) && error.code === "master_key.code_invalid") throw wrongKey;
    throw error;
  }
  if (!masterKeyId(sealingPublicKey(masterKey)).equals(header.masterKeyId)) throw wrongKey;
  return backupKey(masterKey, header.keyNumber).toString("base64url");
}

/** Whether `held` is the backup key the header names: the same master key id and number. */
export function heldKeyOpens(
  header: ArtifactHeader,
  held: Pick<BackupKeyRecord, "keyNumber" | "masterKeyId">,
): boolean {
  return (
    header.version === 2 &&
    held.keyNumber === header.keyNumber &&
    held.masterKeyId === header.masterKeyId.toString("hex")
  );
}
