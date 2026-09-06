// A bare side-effect import, not a value used here: it makes TypeScript treat "@waitron/shared" as
// a real module to augment rather than declaring a fresh ambient one — the same idiom
// packages/core/src/errors.ts and packages/payments/src/errors.ts use.
import "@waitron/shared";

/**
 * packages/credentials's contribution to the shared error registry, by declaration merging — the
 * DOMAIN-CONCEPT, lowercase, dot-namespaced convention (`credentials.*`), never the package name.
 *
 * NO PARAM HERE EVER CARRIES A DECRYPTED VALUE. These are structured codes a display layer
 * localises; a credential's plaintext must not reach a log line, a stack trace, or a test name.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** The current-key environment variable is absent or empty. */
    "credentials.key_missing": { variable: string };
    /** Present but not 32 bytes once base64-decoded. `byteLength` is the decoded length — a size,
     * never key material. */
    "credentials.key_invalid": { variable: string; byteLength: number };
    /** A `_PREVIOUS` key was supplied without its version, or vice versa. Both or neither. */
    "credentials.key_ring_incomplete": { supplied: string; missing: string };
    /** The current and previous key versions are equal — distinct from
     * `credentials.key_ring_incomplete`, where something is absent; here both variables were
     * supplied and merely agree. `version` is the value they share; both variable names are given
     * so an operator knows which one to bump.
     *
     * What a collision actually does to `keyForVersion` and `rotateCredentials` is stated once, in
     * `loadKeyRing`'s own comment on the guard that raises this (`./keyring.ts`) — deliberately not
     * repeated here. It was repeated here, and the two copies then made and fixed the *same* wrong
     * claim independently, which is the argument for one home rather than two. */
    "credentials.key_ring_version_collision": {
      version: number;
      currentVariable: string;
      previousVariable: string;
    };
    /** A version number that is not a positive integer. `reason` is a SHAPE classification, never
     * the input: an operator's key material — base64, ~44 characters — pasted into the wrong
     * variable by a transposed `.env` line or a templated systemd unit is exactly the input this
     * code exists to reject, and this package's own `bin.ts` prints an AppError's params verbatim
     * to stderr. `"empty"` (blank, or unset with no fallback), `"not-an-integer"`, or `"below-1"` —
     * never `value`, which is what this code originally carried and which `bin.ts` then echoed. */
    "credentials.key_version_invalid": {
      variable: string;
      reason: "empty" | "not-an-integer" | "below-1";
    };
    /** A row was sealed by a key version the ring does not carry — the operator retired a key while
     * rows still referenced it. Recoverable: put the key back and re-run `rotate`. */
    "credentials.key_version_unknown": { tenantId: string; purpose: string; keyVersion: number };
    /** GCM authentication failed: the wrong key, a tampered ciphertext, or a row moved between
     * (tenant, purpose) pairs. The three are indistinguishable by design — an oracle that told them
     * apart would be a gift to whoever caused it. */
    "credentials.decrypt_failed": { tenantId: string; purpose: string };
    /** The row decrypted — GCM authentication passed — but the plaintext is not a JSON object of
     * string fields: not valid JSON at all, or valid JSON that is `null`, an array, or a scalar.
     * Distinct from `credentials.decrypt_failed`: authentication succeeded, so this is not a wrong
     * key or a tampered row, it is a row whose content was never a credential. Carries only
     * `{tenantId, purpose}` — never the plaintext itself, which is exactly what a raw
     * `JSON.parse` `SyntaxError` would otherwise embed. */
    "credentials.malformed_payload": { tenantId: string; purpose: string };
    /** No row for this (tenant, purpose). Not provisioned. */
    "credentials.missing": { tenantId: string; purpose: string };
    /** Not a purpose this package knows. `known` lets a CLI print the legal set. */
    "credentials.unknown_purpose": { purpose: string; known: string[] };
    /** The payload's field names do not exactly match the purpose's. `missing` and `expected` are
     * field names THIS PACKAGE declares in `PURPOSES` (`../purposes.ts`) — safe to echo.
     * `unexpectedCount` is a COUNT, never the supplied names themselves: an extra field's name is
     * arbitrary caller input, and could itself be a secret typed into the wrong slot
     * (`{"sk_live_51LEAKED": "x"}`) — the same class of leak `credentials.key_version_invalid`'s
     * `value` used to be. */
    "credentials.invalid_payload": {
      purpose: string;
      missing: string[];
      unexpectedCount: number;
      expected: string[];
    };
    /** A field is present but empty, or not a string. Names only. */
    "credentials.invalid_field": { purpose: string; field: string };
    /** `set` could not obtain the payload it was told to read: `--file <path>` named a path that
     * could not be read, or stdin itself failed (including the CLI refusing to wait on an
     * interactive terminal — see `bin.ts`'s `readStdin`). `path` is the argument the operator
     * typed, never file CONTENT; carries no payload and no underlying error message, since
     * neither is safe to print unexamined — a filesystem error can be platform-specific text, and
     * a raw `fs`/stream error is not this package's to format. */
    "credentials.payload_unreadable": { source: "file" | "stdin"; path: string | null };
  }
}
