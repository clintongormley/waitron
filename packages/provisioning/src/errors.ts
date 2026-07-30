import "@waitron/shared";

/**
 * `packages/provisioning`'s contribution to the shared error registry.
 *
 * NO PARAM HERE EVER CARRIES A GENERATED PASSWORD, A KEY, OR A CONNECTION STRING.
 *
 * The receipt is the SIBLING CLI, not this package's own entry point: `src/bin.ts` does not exist
 * yet — it arrives with `instance`, and is already listed ahead of existing in this package's
 * `vitest.config.ts` coverage exclusions for that reason. The shape it will follow is
 * `packages/credentials/src/cli.ts:277`, which prints `${error.code} ${JSON.stringify(error.params)}`
 * to stderr, i.e. into an operator's scrollback. So this is the constraint on every param added
 * here from now on, stated before the printer lands rather than after — nothing under `src/` prints
 * params today.
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
