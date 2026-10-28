import {
  abandonedRecoveryBytes,
  canonicalFirstSetupDirectory,
  createFirstSetupBackupWorkspace,
  type FirstSetupRoots,
} from "@waitron/provisioning";

/**
 * The bytes the start's emptying would still remove from a backup recovery that Start again
 * discarded, judged from the same canonical folders the emptying uses; null when the journal's last
 * record is not an abandon or nothing is left to remove. A copy holding a link is refused, as the
 * emptying refuses it.
 */
export async function discardedCopyBytes(anchor: FirstSetupRoots): Promise<number | null> {
  const roots = {
    venueDir: await canonicalFirstSetupDirectory(anchor.venueDir),
    stateDir: await canonicalFirstSetupDirectory(anchor.stateDir),
  };
  const last = (await createFirstSetupBackupWorkspace(roots).readChain()).at(-1);
  if (last?.phase !== "abandoned") return null;
  const bytes = await abandonedRecoveryBytes(roots, last.target.recoveryId);
  return bytes === 0 ? null : bytes;
}
