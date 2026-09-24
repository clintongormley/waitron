// Makes TypeScript augment the real "@waitron/shared" module rather than declare a fresh ambient one.
import "@waitron/shared";

/**
 * NO PARAM HERE EVER CARRIES A SECRET: `bin.ts` prints params to stderr, and a credential's
 * plaintext must not reach a log line, a stack trace, or a test name.
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
    /** The current and previous key versions are equal. Why that is refused: `loadKeyRing`
     * (`./keyring.ts`). */
    "credentials.key_ring_version_collision": {
      version: number;
      currentVariable: string;
      previousVariable: string;
    };
    /** A version number that is not a positive integer. `reason` is a SHAPE classification, never
     * the input: key material pasted into the wrong variable is exactly the input this rejects. */
    "credentials.key_version_invalid": {
      variable: string;
      reason: "empty" | "not-an-integer" | "below-1";
    };
    /** A row was sealed by a key version the ring does not carry — the operator retired a key while
     * rows still referenced it. Recoverable: put the key back and re-run `rotate`. */
    "credentials.key_version_unknown": { purpose: string; keyVersion: number };
    /** The row did not open: the wrong key, a tampered ciphertext, or a row moved between purposes,
     * indistinguishable by design (`open` in `./cipher.ts`). */
    "credentials.decrypt_failed": { purpose: string };
    /** The row decrypted, but the plaintext is not a JSON object. Never carries the plaintext. */
    "credentials.malformed_payload": { purpose: string };
    /** No row for this purpose. Not provisioned. */
    "credentials.missing": { purpose: string };
    /** Not a purpose this package knows. `known` lets a CLI print the legal set. */
    "credentials.unknown_purpose": { purpose: string; known: string[] };
    /** The payload's field names do not exactly match the purpose's. `unexpectedCount` is a COUNT,
     * never the names: an extra field's name is caller input and could be a secret. */
    "credentials.invalid_payload": {
      purpose: string;
      missing: string[];
      unexpectedCount: number;
      expected: string[];
    };
    /** A field is present but empty, or not a string. Names only. */
    "credentials.invalid_field": { purpose: string; field: string };
    /** `set` could not read its payload from `--file` or stdin. `path` is the argument the operator
     * typed, never file CONTENT, and no underlying error message is carried. */
    "credentials.payload_unreadable": { source: "file" | "stdin"; path: string | null };
  }
}
