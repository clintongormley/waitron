import "@waitron/shared";

/**
 * `packages/provisioning`'s contribution to the shared error registry, by declaration merging — the
 * DOMAIN-CONCEPT, lowercase, dot-namespaced convention, never the throwing package's name.
 *
 * **Why `provisioning.*` is the domain concept and not the package name**, since the two spell the
 * same here and every sibling that keeps such a prefix defends it in the file (`server.*` at
 * `apps/server/src/errors.ts:7-9`, `credentials.*` at `packages/credentials/src/errors.ts:7-8`):
 * these are facts about STANDING A DEPLOYMENT UP — a database that does not exist, a role that
 * cannot be adopted, a grant that did not take — and that activity is the domain. A code here would
 * keep its name if this package were merged into another, which is the test the convention is
 * actually asking.
 *
 * The honest objection, stated rather than skirted: "provisioning" already denotes something ELSE
 * in this repository. `apps/server/src/provision-till.ts`'s `provisionTill` (line 119) registers a
 * till as a Veri*Factu SIF, and that is provisioning too — of a till, not of a deployment. So the
 * prefix is not the unambiguous domain name the convention would ideally get; it is the accurate
 * one for what these codes are about, and the ambiguity is real. A future code about a TILL's
 * provisioning should not land here.
 *
 * Two of these are settled regardless of how that objection lands: `provisioning.invalid_identifier`
 * and `provisioning.key_generation_failed` SHIPPED in PR #8
 * (`git show main:packages/provisioning/src/errors.ts`), and codes are never renamed once shipped —
 * a wrong one is deprecated and a new one added beside it.
 *
 * **That is not why the others kept the prefix**, and an earlier version of this paragraph said it
 * was: it argued that splitting the file between a shipped `provisioning.*` and a newer prefix
 * "would be worse than either alone". The premise is false. A registry carrying several prefixes is
 * this repository's NORM: `apps/server/src/errors.ts` holds six in one file (`server.*` at :19,
 * :34, :48, :98, :106; `tenant.*` :63; `till.*` :74; `sif.*` :90; `deployment.*` :115; `payment.*`
 * :124), `packages/core/src/errors.ts` holds `sale.*` and `chain.*`,
 * `packages/fiscal/src/errors.ts` holds `clock.*` and `fiscal.*`, `packages/db/src/errors.ts` holds
 * `series.*` and `deployment.*` across two codes — and this very file mixes, at
 * `deployment.unknown_environment` below. Splitting was available, so each unshipped code was
 * re-decided on its own merits. Each kept `provisioning.*`, for these reasons:
 *
 * - `role_over_privileged`, `role_unusable`, `role_creation_failed`, `membership_grant_failed`,
 *   `grant_ineffective`: none is a general fact about a role or about a grant. Each is a refusal or
 *   a failure OF THIS ACTIVITY — "a role this tool would adopt carries BYPASSRLS", "a grant this
 *   run issued did not take". A `role.*` or `grant.*` code should be true of any role or grant
 *   anywhere, and none of these is.
 * - `state_unreadable` is the one worth arguing, because its own text opens with "reading what a
 *   DEPLOYMENT already has" and it carries a `database` param, which makes `deployment.*` look
 *   natural. It is wrong on both counts. `deployment.*` here denotes the environment STAMP and
 *   nothing else — `deployment.already_stamped` (`packages/db/src/errors.ts:44`),
 *   `deployment.environment_mismatch` (`apps/server/src/errors.ts:115`) and
 *   `deployment.unknown_environment` below are all about WHICH ENVIRONMENT a deployment belongs to,
 *   and this code is about none of that. Two of the four things it covers are `pg_database` and
 *   `pg_roles`, which are cluster-global and readable with no deployment in existence
 *   (`instance-state.ts:45-46`), and its 28P01 case fails at the CONNECT, before any deployment has
 *   been reached at all. Its structural sibling is `credentials.payload_unreadable`
 *   (`packages/credentials/src/errors.ts:79-85`): a CLI that could not read an input it needs,
 *   named for the domain of the CLI's work and carrying the thing it failed to read as a param,
 *   exactly as `database` is carried here.
 * - `admin_uri_missing` names an input THIS TOOL needs, at a moment when nothing has been reached:
 *   no deployment, no database, no role. `credentials.key_missing`
 *   (`packages/credentials/src/errors.ts:16`) is the same fact under its own domain's prefix, and
 *   `server.config_missing` (`apps/server/src/errors.ts:19`) is the same fact under the process's.
 *
 * `deployment.unknown_environment` is the one that does NOT take the prefix: the fact is about a
 * deployment environment, so it sits beside `deployment.already_stamped` (`packages/db`) and
 * `deployment.environment_mismatch` (`apps/server`) instead.
 *
 * NO PARAM HERE EVER CARRIES A GENERATED PASSWORD, A KEY, OR A CONNECTION STRING.
 *
 * That constraint now has a receipt in this package rather than only in a sibling: `src/bin.ts:74`
 * and `src/cli.ts`'s `reportFailure` both print `${error.code} ${JSON.stringify(error.params)}` to
 * stderr, i.e. straight into an operator's scrollback. Until this task they did not exist, and an
 * earlier version of this paragraph said so ("`src/bin.ts` does not exist yet … nothing under
 * `src/` prints params today"); that premise was made false by the change that added the printer,
 * and the sentence outlived it by exactly one commit. The constraint it guarded was always the
 * point and is unchanged.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** An operator typed something that is not a deployment environment. Named for the DOMAIN
     * concept, not for this package — it sits beside `deployment.already_stamped`
     * (`packages/db/src/errors.ts`) and `deployment.environment_mismatch`
     * (`apps/server/src/errors.ts`), because the fact is about a deployment environment and the
     * provisioning CLI is merely where it was typed. Both params ARE echoed: `value` is
     * operator-typed configuration and `known` is the legal set, which is what lets the refusal be
     * acted on without reading the source. Shaped after `credentials.unknown_purpose`. */
    "deployment.unknown_environment": { value: string; known: string[] };
    /** Nothing supplied the admin connection string: `WAITRON_ADMIN_DATABASE_URL` was unset or
     * empty AND the echo-off prompt answered nothing — which is what an exhausted stdin or a Ctrl+D
     * produces, deliberately, in `bin.ts`'s `ask`.
     *
     * Refused rather than passed through, because `pg` does not refuse it either. Run against this
     * repo's `pg@8.22.0`: `new Client({ connectionString: "" })` resolved to
     * `{host:"localhost",port:5432,user:"<OS user>",database:"<OS user>"}` — an empty string is
     * falsy, so nothing is parsed and every default applies — and `pg-pool@3.14.0` builds each
     * client with `new this.Client(this.options)` (`index.js:241`) off the same options object. So
     * an unset or misspelled variable plus a non-interactive stdin, which is exactly the shape
     * `README.md` documents for CI, had `instance` create, migrate and STAMP a database on whatever
     * cluster answers on localhost:5432. One database per environment is a fiscal invariant and a
     * stamp cannot be taken back.
     *
     * `variable` is our own declared environment-variable NAME, never its value — the shape
     * `credentials.key_missing` and `server.config_missing` both carry, for the same reason. The
     * value it names is the one secret this tool takes as INPUT, and printing it is the thing this
     * whole file forbids. */
    "provisioning.admin_uri_missing": { variable: string };
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
    /** Every action ran without error, and at least one privilege is still not there afterwards.
     *
     * This is not defensive: PostgreSQL answers a `GRANT` from a role holding no grant option with a
     * **WARNING, not an error** — the command tag is still `GRANT` and the driver reports success.
     * Observed directly on `postgres:18-alpine`: as a non-owning `login createdb createrole` admin,
     * `grant create on database acl_db to r_app` printed `WARNING: no privileges were granted for
     * "acl_db"`, and `pg_database.datacl` afterwards still read
     * `{=Tc/owner_a,owner_a=CTc/owner_a,r_mig=C/owner_a}` — no `r_app` entry. Without this check
     * `instance` reported success and left a deployment whose migrator cannot migrate at the next
     * boot, which is the worst available failure shape.
     *
     * `missing` names each privilege that did not take, in the same words the plan summary used, so
     * the line an operator reads on failure is the line they approved. That is structural, not a
     * convention someone has to maintain: both call `describeAction` (instance-plan.ts). An earlier
     * version of this sentence was simply false — `verifyGrants` formatted its own strings and
     * dropped the leading `grant` the summary carries. Database names, role names and privilege
     * words only, the same class of value `provisioning.role_unusable`'s own `missing` already
     * carries. */
    "provisioning.grant_ineffective": { database: string; missing: string[] };
    /** Reading what a deployment already has — `pg_database`, `pg_roles`, the journal tables, the
     * deployment stamp — failed at the database. Every command here reads before it decides, so
     * this is where an admin connection that cannot see the target database surfaces, and it is a
     * REACHABLE case rather than a defensive one: an admin that did not create the database holds
     * no privilege on the tables inside it, and `select environment from deployment` fails with
     * 42501. Observed directly against `postgres:18-alpine` — see `README.md`'s "When the admin did
     * not create the database" for the transcript and the remedy. 28P01 (a wrong password in the
     * admin connection string) arrives here too, from the CONNECT rather than from a read: `pg`
     * authenticates when the pool hands out its first connection. An earlier version of this
     * sentence claimed the opposite — that `pg` authenticates lazily on first use, so a bad password
     * would surface at the first read — and the container disproved it, printing
     * `unexpected failure (error)` while the connect sat outside the guard. `cli.ts`'s `withState`
     * carries the same receipt at the site that acts on it.
     *
     * Raised ONLY when the failure carries a SQLSTATE. Anything else is a bug or a broken socket,
     * not a fact about this database, and is rethrown unchanged rather than dressed up as one.
     * `database` is operator-typed and `sqlState` is five `[0-9A-Z]` characters (sql-state.ts);
     * neither can carry the admin connection string that produced it. */
    "provisioning.state_unreadable": { database: string; sqlState: string };
    /** `CREATE ROLE` failed. `role` and the SQLSTATE only — never the underlying driver error, and
     * never a `cause`: the failing statement carries a generated password in its literal text, and
     * both Drizzle's own wrapped error and Postgres's own error message quote the statement back
     * verbatim. See `instance-apply.ts`'s `create-role` case for the receipt.
     *
     * `sqlState` is `sqlStateOf`'s output (sql-state.ts) — five characters of `[0-9A-Z]`, or
     * `null`. It is what tells an operator which of "already exists" (42710), "the membership
     * target does not exist" (42704) and "this admin is not allowed to" (42501) they hit; `role`
     * alone sent them to the Postgres log for that. Safe by SHAPE rather than by promise: a
     * generated password is 32 base64url characters (identifiers.ts) and a connection string is
     * longer still, so neither can satisfy five `[0-9A-Z]`. */
    "provisioning.role_creation_failed": { role: string; sqlState: string | null };
    /** `GRANT <memberOf> TO <role>` failed — the repair path for a membership that drifted, or that
     * a hand-made role never had. `memberOf` rather than `of`: this package already names the
     * concept that way in four places (`instance-state.ts`'s `RoleFacts.memberOf`,
     * `instance-plan.ts`'s `create-role` action and `REQUIREMENTS`, `status-command.ts`'s report),
     * and a relational preposition would have been the only one among every code in the registry.
     * Same `sqlState` treatment and same reasoning as
     * `provisioning.role_creation_failed` above, minus the password: this statement embeds no
     * secret, and the catch exists because the driver's raw error otherwise escaped `applyInstance`
     * unformatted on a path a real operator reaches (an admin holding CREATEROLE but no ADMIN
     * OPTION on `app_user` — 42501, proven in `instance-apply.rls.test.ts`). */
    "provisioning.membership_grant_failed": {
      role: string;
      memberOf: string;
      sqlState: string | null;
    };
  }
}
