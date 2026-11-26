import { encryptArtifactFileUnderBackupKey } from "../artifact-cipher-file.js";
import { backupKeyFrameInput } from "../backup-key-record.js";
import { heldBackupKey, HELD_MASTER_KEY_DAY } from "./backup-key.js";

/** Writes `plaintext` to `path` as a version 2 file under backup key `n` (1 unless given) of
 * `masterKey` made on `day`, as a backup run holding that key writes it. */
export async function writeMasterKeyArchive(
  path: string,
  plaintext: Uint8Array,
  masterKey: Uint8Array,
  n = 1,
  day = HELD_MASTER_KEY_DAY,
): Promise<void> {
  await encryptArtifactFileUnderBackupKey(
    (async function* () {
      yield plaintext;
    })(),
    path,
    backupKeyFrameInput(heldBackupKey(masterKey, n, day)),
  );
}
