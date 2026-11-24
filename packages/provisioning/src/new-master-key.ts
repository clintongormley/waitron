import {
  makeMasterKey,
  masterKeyCheckValue,
  masterKeyName,
  sealingPublicKey,
} from "@waitron/credentials";
import { encodeMasterKeyCode } from "@waitron/shared";

/** A new master key as printed (seven groups of four, spaced) and its name. */
export interface MadeMasterKey {
  readonly masterKey: string;
  readonly masterKeyName: string;
}

/** A master key made in memory: what is shown once, and what its `master_keys` row keeps. */
export interface NewMasterKey {
  readonly made: MadeMasterKey;
  readonly checkValue: string;
  readonly publicKey: Buffer;
}

export function makeNewMasterKey(day: string): NewMasterKey {
  const masterKey = makeMasterKey();
  const publicKey = sealingPublicKey(masterKey);
  return {
    made: {
      masterKey: encodeMasterKeyCode(masterKey),
      masterKeyName: masterKeyName(publicKey, day),
    },
    checkValue: masterKeyCheckValue(masterKey),
    publicKey,
  };
}
