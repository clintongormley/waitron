import { hashPassword, hashPin } from "@waitron/identity";

// A fixture needs only the stored value; sign-in still runs the real check against it.
const pinHashes = new Map<string, string>();
const passwordHashes = new Map<string, string>();

function remembered(cache: Map<string, string>, secret: string, hash: (s: string) => string) {
  let stored = cache.get(secret);
  if (stored === undefined) {
    stored = hash(secret);
    cache.set(secret, stored);
  }
  return stored;
}

export function fixturePinHash(pin: string): string {
  return remembered(pinHashes, pin, hashPin);
}

export function fixturePasswordHash(password: string): string {
  return remembered(passwordHashes, password, hashPassword);
}
