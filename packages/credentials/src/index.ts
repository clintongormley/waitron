// The entire public surface of @waitron/credentials. Re-exports only — no logic here.
//
// The CLI is NOT re-exported: cli.ts and bin.ts are the provisioning tool's own entry points,
// reached through the bin, and a host that imported `runCli` by autocomplete would be reaching for
// an operator command rather than the vault. index.test.ts pins its absence.
export { CREDENTIALS_MIGRATIONS } from "./migrations.js";
export { tenantCredentials } from "./schema/tenant-credentials.js";

// The purpose registry: field-name-only knowledge of what each provisioned purpose's payload
// looks like. Never an import of a provider package — see purposes.ts's own doc comment.
export { PURPOSES, isPurpose, validatePayload } from "./purposes.js";
export type { Purpose } from "./purposes.js";

// The key ring. A host builds ONE of these at boot — `loadKeyRing(process.env)` — and passes it
// into every call below that needs one; that is the ONLY sanctioned way to get one, so it must be
// reachable from here even though `KeyRing` is otherwise a keyring.ts-internal shape. Unlike
// cipher.ts below, keyring.ts is not entirely a store-only primitive: `getCredential`,
// `tryGetCredential`, `putCredential` and `rotateCredentials` all take `ring: KeyRing` as a
// parameter, so a caller who could reach those four functions through this barrel but not
// `KeyRing`/`loadKeyRing` would have no supported way to construct the one argument all of them
// require. `keyForVersion` stays UNexported: it is the store's own per-row key lookup, needed by
// nothing outside it.
export { loadKeyRing } from "./keyring.js";
export type { KeyEntry, KeyRing } from "./keyring.js";

// The sealed read/write path. cipher.ts stays entirely UNexported: `seal`/`open`/`aadFor`/`Sealed`
// are primitives the store alone wraps — no function below takes or returns one, unlike KeyRing
// above — so a caller reaching for them directly would be bypassing `putCredential`/`getCredential`
// rather than using the vault.
export {
  credentialTenants,
  deleteCredential,
  getCredential,
  listCredentials,
  putCredential,
  rotateCredentials,
  tryGetCredential,
} from "./store.js";
export type { CredentialMeta, CredentialRef, RotationResult } from "./store.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable
// from this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts.
// See errors.reachability.test.ts.
import "./errors.js";
