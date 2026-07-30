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
    /** A role this tool would use already exists carrying SUPERUSER or BYPASSRLS. Refused rather
     * than adopted: every grant `instance` is about to make sits behind an RLS policy that such a
     * role ignores outright — the same refusal `0001_tenancy_rls.sql` makes for `app_user`. */
    "provisioning.role_over_privileged": { role: string; superuser: boolean; bypassRls: boolean };
    /** A role exists but cannot log in, or lacks an attribute it needs. Refused rather than
     * altered: this tool did not create it, does not know its password, and `ALTER ROLE` on
     * something an operator made by hand is not its call. */
    "provisioning.role_unusable": { role: string; missing: string[] };
    /** `CREATE ROLE` failed. `role` and the SQLSTATE only — never the underlying driver error, and
     * never a `cause`: the failing statement carries a generated password in its literal text, and
     * both Drizzle's own wrapped error and Postgres's own error message quote the statement back
     * verbatim. See `instance-apply.ts`'s `create-role` case for the receipt.
     *
     * `sqlstate` is `sqlstateOf`'s output (instance-apply.ts) — five characters of `[0-9A-Z]`, or
     * `null`. It is what tells an operator which of "already exists" (42710), "the membership
     * target does not exist" (42704) and "this admin is not allowed to" (42501) they hit; `role`
     * alone sent them to the Postgres log for that. Safe by SHAPE rather than by promise: a
     * generated password is 32 base64url characters (identifiers.ts) and a connection string is
     * longer still, so neither can satisfy five `[0-9A-Z]`. */
    "provisioning.role_creation_failed": { role: string; sqlstate: string | null };
    /** `GRANT <of> TO <role>` failed — the repair path for a membership that drifted, or that a
     * hand-made role never had. Same `sqlstate` treatment and same reasoning as
     * `provisioning.role_creation_failed` above, minus the password: this statement embeds no
     * secret, and the catch exists because the driver's raw error otherwise escaped `applyInstance`
     * unformatted on a path a real operator reaches (an admin holding CREATEROLE but no ADMIN
     * OPTION on `app_user` — 42501, proven in `instance-apply.rls.test.ts`). */
    "provisioning.membership_grant_failed": { role: string; of: string; sqlstate: string | null };
  }
}
