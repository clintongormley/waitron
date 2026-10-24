/** The folder inside the state folder that the restore command, the staged restore and boot pass as `stagingDir`. */
export const RESTORE_STAGING_DIR = "restore-staging";
/**
 * Inside `RESTORE_STAGING_DIR`; boot and the start's clean-up (`freeSpaceAtStart`) remove it whole,
 * since each copy in it is a decrypted venue database.
 */
export const STAGED_RECOVERY_DIR = "staged-recovery";
