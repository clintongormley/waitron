import type { ModuleBackupContribution } from "@waitron/module";
import { decodeMasterKeyCode } from "@waitron/shared";

export {
  decodeMasterKeyCode as decodeRecoveryKey,
  encodeMasterKeyCode as encodeRecoveryKey,
} from "@waitron/shared";

export const FISCAL_SERVER_KEY_AS_TYPED: NonNullable<
  ModuleBackupContribution["serverKeyAsTyped"]
> = (typed) => {
  try {
    return decodeMasterKeyCode(typed);
  } catch {
    return undefined;
  }
};
