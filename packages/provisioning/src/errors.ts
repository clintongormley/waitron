import "@waitron/shared";

/**
 * `packages/provisioning`'s contribution to the shared error registry.
 *
 * NO PARAM HERE EVER CARRIES A GENERATED PASSWORD, A KEY, OR A CONNECTION STRING. `bin.ts` prints
 * an AppError's params verbatim to stderr, which is an operator's scrollback.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** A database or role name outside `/^[a-z][a-z0-9_]{0,62}$/`. `value` IS echoed: it is
     * operator-typed configuration, never a secret, and a refusal that withheld it could not be
     * acted on. */
    "provisioning.invalid_identifier": { kind: "database" | "role"; value: string };
    /** The CSPRNG returned the wrong number of bytes. `byteLength` is a size, never material. */
    "provisioning.key_generation_failed": { byteLength: number };
  }
}
