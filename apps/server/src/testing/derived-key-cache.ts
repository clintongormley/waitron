import type { ScryptParams } from "@waitron/provisioning";

export type KdfModule = Pick<
  typeof import("@waitron/provisioning"),
  "deriveKey" | "deriveKeyAsync" | "SCRYPT_PARAMS"
>;

type CacheState = { keys: Map<string, Buffer>; requested: number; derived: number };

// On globalThis so the setup file's dynamic import and a test's static import share one state,
// whichever module instance each of them gets.
const slot = Symbol.for("waitron.derivedKeyCache");
const holder = globalThis as typeof globalThis & { [slot]?: CacheState };
const state: CacheState = (holder[slot] ??= { keys: new Map(), requested: 0, derived: 0 });

function cacheKey(passphrase: string, salt: Buffer, params: ScryptParams): string {
  const { N, r, p, keylen, maxmem } = params;
  return JSON.stringify([passphrase, salt.toString("hex"), N, r, p, keylen, maxmem]);
}

export function derivedKeyStats(): { requested: number; derived: number } {
  return { requested: state.requested, derived: state.derived };
}

export function cachedKdf(real: KdfModule): KdfModule {
  return {
    ...real,
    deriveKey(passphrase: string, salt: Buffer, params: ScryptParams = real.SCRYPT_PARAMS) {
      state.requested += 1;
      const key = cacheKey(passphrase, salt, params);
      const stored = state.keys.get(key);
      if (stored !== undefined) return Buffer.from(stored);
      state.derived += 1;
      const derived = real.deriveKey(passphrase, salt, params);
      state.keys.set(key, Buffer.from(derived));
      return derived;
    },
    async deriveKeyAsync(
      passphrase: string,
      salt: Buffer,
      params: ScryptParams = real.SCRYPT_PARAMS,
    ) {
      state.requested += 1;
      const key = cacheKey(passphrase, salt, params);
      const stored = state.keys.get(key);
      if (stored !== undefined) return Buffer.from(stored);
      state.derived += 1;
      const derived = await real.deriveKeyAsync(passphrase, salt, params);
      state.keys.set(key, Buffer.from(derived));
      return derived;
    },
  };
}
