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

// Undefined when the inputs are of a kind whose spelling here could match another input that
// scrypt treats differently; such a call is derived for real and not stored.
function cacheKey(passphrase: string, salt: Buffer, params: ScryptParams): string | undefined {
  const { N, r, p, keylen, maxmem } = params;
  const numbers: unknown[] = [N, r, p, keylen, maxmem];
  const plain = numbers.every((value) => typeof value === "number" || value === undefined);
  if (typeof passphrase !== "string" || !Buffer.isBuffer(salt) || !plain) return undefined;
  return JSON.stringify([passphrase, salt.toString("hex"), ...numbers.map(String)]);
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
      const stored = key === undefined ? undefined : state.keys.get(key);
      if (stored !== undefined) return Buffer.from(stored);
      state.derived += 1;
      const derived = real.deriveKey(passphrase, salt, params);
      if (key !== undefined) state.keys.set(key, Buffer.from(derived));
      return derived;
    },
    async deriveKeyAsync(
      passphrase: string,
      salt: Buffer,
      params: ScryptParams = real.SCRYPT_PARAMS,
    ) {
      state.requested += 1;
      const key = cacheKey(passphrase, salt, params);
      const stored = key === undefined ? undefined : state.keys.get(key);
      if (stored !== undefined) return Buffer.from(stored);
      state.derived += 1;
      const derived = await real.deriveKeyAsync(passphrase, salt, params);
      if (key !== undefined) state.keys.set(key, Buffer.from(derived));
      return derived;
    },
  };
}

type SecretVerifier = typeof import("@waitron/identity").verifySecretAsync;

export function cachedSecretVerification(
  verify: SecretVerifier,
  yieldTurn: () => Promise<void>,
): SecretVerifier {
  const answers = new Map<string, Map<string, Promise<boolean>>>();
  return async (secret, stored) => {
    let bySecret = answers.get(stored);
    if (bySecret === undefined) answers.set(stored, (bySecret = new Map()));
    const remembered = bySecret.get(secret);
    if (remembered !== undefined) {
      // A real verification lets waiting work run before returning its answer.
      await yieldTurn();
      return remembered;
    }
    const answer = verify(secret, stored);
    bySecret.set(secret, answer);
    try {
      return await answer;
    } catch (error) {
      bySecret.delete(secret);
      throw error;
    }
  };
}
