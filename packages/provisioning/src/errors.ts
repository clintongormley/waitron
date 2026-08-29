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
 * in this repository. `apps/server/src/provision-till.ts`'s `provisionNode` registers a NODE as a
 * Veri*Factu SIF, and that is provisioning too — of a node, not of a deployment. So the prefix is
 * not the unambiguous domain name the convention would ideally get; it is the accurate one for what
 * these codes are about, and the ambiguity is real. A future code about a NODE's provisioning should
 * not land here.
 *
 * Two of these are settled regardless of how that objection lands: `provisioning.invalid_identifier`
 * and `provisioning.key_generation_failed` SHIPPED in PR #8
 * (`git show main:packages/provisioning/src/errors.ts`), and codes are never renamed once shipped —
 * a wrong one is deprecated and a new one added beside it.
 *
 * **That is not why the others kept the prefix**, and an earlier version of this paragraph said it
 * was: it argued that splitting the file between a shipped `provisioning.*` and a newer prefix
 * "would be worse than either alone". The premise is false. A registry carrying several prefixes is
 * this repository's NORM: `apps/server/src/errors.ts` holds six prefixes in one file (`server.*`,
 * `tenant.*`, `node.*`, `sif.*`, `deployment.*` and `payment.*`; deliberately not line-numbered —
 * they drift on every edit, which is how this list went stale on the node_id rekey that dropped
 * `till.*` for `node.*`), `packages/core/src/errors.ts` holds `sale.*` and `chain.*`,
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
 *   `deployment.environment_mismatch` (`apps/server/src/errors.ts:120`) and
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
     * provisioning CLI is merely where it was typed. Both params ARE echoed: `environment` is
     * operator-typed configuration and `known` is the legal set, which is what lets the refusal be
     * acted on without reading the source.
     *
     * `environment`, not `value`, because that is the shape the sibling this comment cites actually
     * has: `credentials.unknown_purpose` is `{ purpose, known }`
     * (`packages/credentials/src/errors.ts:64`) — it names the CONCEPT. So do both `deployment.*`
     * siblings: `{stamped, requested}` (`packages/db/src/errors.ts:44`) and
     * `{databaseEnvironment, hostEnvironment}` (`apps/server/src/errors.ts:120`). Every param named
     * `value` in the whole registry belongs instead to a code about an input that failed a FORMAT
     * check — `shared.invalid_id`, `shared.invalid_decimal`, `shared.decimal_overflow`,
     * `server.config_invalid`, `sif.id_sistema_invalid`, and `provisioning.invalid_identifier`
     * below — where there is no concept left to name. `staging` is a well-formed string that names
     * no environment, which is the other case. Written as `value` here and renamed while renaming
     * was still free: this code has not shipped. */
    "deployment.unknown_environment": { environment: string; known: string[] };
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
    /** The admin connection string was supplied and is not a URL `new URL` can parse.
     *
     * Refused rather than accepted, because `pg` and `new URL` disagree about real, WORKING
     * connection strings and this tool needs both to agree. Run inside a `postgres:18-alpine`
     * container (PostgreSQL 18.4) with this repo's `pg@8.22.0` and the connection string
     * `/var/run/postgresql`: pg parsed it to `{host:"/var/run/postgresql",port:5432}`, `connect()`
     * succeeded, and `select inet_server_addr() is null` returned `t` — a live connection over the
     * cluster's Unix socket. `new URL("/var/run/postgresql")` threw `TypeError: Invalid URL` in the
     * same process.
     *
     * `pg` is not the only consumer here. This tool RE-POINTS the admin string at another database
     * three times — `withDatabase` for the state read and for the migrator's URL
     * (`instance-apply.ts`), `roleUri` for each printed connection string (`cli.ts`) — and each is a
     * `new URL`. With the socket path above, `withDatabase(uri, "waitron_prod")` and
     * `roleUri(uri, "waitron_app", "pw", "waitron_prod")` both threw `TypeError: Invalid URL`. On
     * the `instance` path that throw landed in `reportRoles`, i.e. AFTER `create database`,
     * `migrate` and `stamp` had run, and reached the operator as `unexpected failure (TypeError)`
     * (`bin.ts`'s catch-all) with three generated passwords lost.
     *
     * Supporting the non-URL forms properly was the alternative and was rejected: re-pointing a
     * libpq keyword/value string at a different database, user and password means parsing and
     * re-serialising conninfo (quoting, escaping, `host=` vs `hostaddr=`), and a mistake there
     * points `migrate` and `stamp` at the WRONG database — which one database per environment
     * makes unrecoverable. Refusing the form this tool cannot re-point is the honest answer.
     *
     * `variable` is our own declared environment-variable NAME — the same param
     * `provisioning.admin_uri_missing` carries, and named for the same reason: the string itself may
     * carry a password in every form `pg` accepts (`host=db.example password=hunter2` is one), so it
     * is never echoed. The variable is named even when this run read the string from the echo-off
     * prompt instead; it is where the tool reads it from, and the operator's fix goes in one of
     * those two places. */
    "provisioning.admin_uri_not_a_url": { variable: string };
    /** A database or role name outside `/^[a-z][a-z0-9_]{0,62}$/`. `value` IS echoed: it is
     * operator-typed configuration, never a secret, and a refusal that withheld it could not be
     * acted on. */
    "provisioning.invalid_identifier": { kind: "database" | "role"; value: string };
    /** The `venue --country` value is not two ASCII letters — the SHAPE of an ISO-3166-1 alpha-2
     * code such as `ES`, not a membership check against a country list. Refused in the CLI while
     * resolving options, before the admin credential is asked for (`cli.ts`'s `assertCountry`), so a
     * typo like `ESP` costs no connection — the same "validate before spending the credential"
     * ordering the database name and `planVenue` follow.
     *
     * `provisioning.*` and not a `location.*`/`tenant.*` prefix: it is a refusal of a provisioning
     * INPUT — standing a venue up — caught before any row exists to be about, the same activity the
     * header describes. `value` IS echoed, the same format-check family as
     * `provisioning.invalid_identifier` above: an operator's typo, never a secret. */
    "provisioning.invalid_country": { value: string };
    /** A venue was requested against a database with no environment stamp. `venue` reads the stamp
     * with `readDeploymentEnvironment` (`packages/db`) on the target BEFORE it applies anything; a
     * `null` result means the database was never stamped by `instance`, so there is no environment to
     * file its sales under. Refused here rather than stamped — stamping is `instance`'s job, and one
     * database per environment is a fiscal invariant a stamp cannot take back.
     *
     * `provisioning.*`: a refusal of standing a venue up, the same activity the header describes.
     * `database` is operator-typed configuration and never a secret. */
    "provisioning.database_unstamped": { database: string };
    /** `applyVenue` hit a unique-key violation (SQLSTATE 23505, detected by `isUniqueViolation`
     * from `packages/db`, which walks the `cause` chain). `applyVenue` guards the natural keys it
     * knows — the obligado `(country, tax_id)` and each series `(tenant_id, node_id, code)` — with
     * `ON CONFLICT DO NOTHING`, so this is the residual case those clauses do not absorb: most
     * plausibly a second `venue` run racing between this run's plan and its apply. Named here rather
     * than left to reach the operator as `unexpected failure` (`bin.ts`'s catch-all).
     *
     * `database` only, and never the driver's own error: a `DrizzleQueryError` can quote the failing
     * statement back in its message, and this file's header forbids a param that could carry one.
     * `database` is operator-typed configuration and never a secret. */
    "provisioning.venue_conflict": { database: string };
    /** `adoptVenue` finished its inserts but one of the five DESIGNATED ids the mirror bundle names
     * for `trading.env` is not present among the rows it inserted — a malformed or incomplete bundle
     * (spec §5). `adoptVenue` inserts the primary's tenant/location/node/till/series rows VERBATIM
     * with their explicit ids under `ON CONFLICT (id) DO NOTHING`, then reads each designated id back
     * (SELECT 1 per id); a `null` read means the bundle's row arrays did not carry a row with that
     * id, so the mirror would boot pointed at a till/series that does not exist. Refused loudly here
     * rather than left to fail confusingly at first sale.
     *
     * `provisioning.*` and not a `tenant.*`/`series.*` prefix: this is a refusal OF STANDING A MIRROR
     * VENUE UP — the same activity the header describes — not a fact about a row that exists.
     * `missing` is the ROLE LABEL of the absent parent (`tenant`|`location`|`node`|`till`|`series`),
     * never the uuid: the label is enough for the operator to see which part of the bundle was
     * short, and it echoes no id at all — the same discipline the secret-bearing codes above keep. */
    "provisioning.adopt_incomplete": {
      missing: "tenant" | "location" | "node" | "till" | "series";
    };
    /** A venue request named a number of invoice locales the schema will not accept: the
     * `invoice_locales` list must hold one or two entries. This is the same rule the DB CHECK
     * `locations_invoice_locales_len` enforces — `cardinality(invoice_locales) between 1 and 2` on
     * `locations` (`packages/db/src/schema/tenants.ts`) — refused in the pure planner (`planVenue`)
     * so the operator is not charged an admin connection before the request is even shaped right.
     *
     * `provisioning.*` and not a `location.*` or `tenant.*` prefix: this is a refusal OF STANDING A
     * VENUE UP, the same activity the header describes, caught before any location row exists to be
     * about. The DB CHECK is the general fact about a `locations` row; this is the CLI refusing an
     * input it can see is out of range without a database.
     *
     * `count` IS echoed — the length the operator supplied, operator-typed configuration and never a
     * secret, in the format-check family with `provisioning.invalid_identifier` above: a refusal
     * that withheld it could not be acted on. */
    "provisioning.invalid_locales": { count: number };
    /** A venue request gave its standard and rectificative series the SAME code. The two series
     * share the natural key `(tenant_id, node_id, code)`, so a venue built from such a request would
     * insert one series and silently drop the other on `ON CONFLICT DO NOTHING` — leaving a venue
     * that can ring sales but cannot issue a rectificative invoice (a correction). Refused in the
     * pure planner (`planVenue`), like the locale and territory refusals, so the operator is not
     * charged an admin connection before the request is even shaped right.
     *
     * `provisioning.*` and not a `series.*` prefix: this is a refusal OF STANDING A VENUE UP — the
     * same activity the header describes — caught before any series row exists to be about.
     * `series.*` (`packages/db/src/errors.ts`) is about a series that DOES exist; this is the CLI
     * refusing an input it can see is self-contradictory without a database.
     *
     * `code` IS echoed — the duplicated code the operator supplied, operator-typed configuration and
     * never a secret, in the format-check family with `provisioning.invalid_locales` and
     * `provisioning.invalid_identifier` above: a refusal that withheld it could not be acted on. */
    "provisioning.duplicate_series_code": { code: string };
    /** A venue's `fiscal_territory` names a country the tenant is NOT in. A location's territory must
     * belong to the tenant's `country`: the fiscal territories are country-prefixed (`ES-common`,
     * `ES-PV-bizkaia`, …), and the only implemented one, `ES-common` (Spain / Veri*Factu), therefore
     * requires `country` `ES`. The combination is load-bearing because `applyVenue` writes the
     * tenant's `tax_id` into `registro_sif.nif` — a Spanish-NIF field — so a request like
     * `country=PT` + `fiscalTerritory=ES-common` would stand up a venue whose SIF is stamped with a
     * non-NIF identity and file its sales under the wrong country, which a hash-chained fiscal record
     * cannot take back. Spec §8 assumes a location is in the tenant's country; this refuses the
     * incoherent request rather than assuming it.
     *
     * Refused in the pure planner (`planVenue`), AFTER `resolveFiscalModules` so an UNIMPLEMENTED
     * territory still fails first with `fiscal.regime_not_implemented` (the more specific error), and
     * before any admin connection is spent — the same D4 "validate before spending the credential"
     * ordering the locale and duplicate-series-code refusals follow. The check is case-insensitive on
     * the country-prefixed convention, so `es`/`ES` both match `ES-common`.
     *
     * `provisioning.*` and not a `location.*`/`tenant.*` prefix: this is a refusal OF STANDING A VENUE
     * UP — the same activity the header describes — caught before any location or tenant row exists to
     * be about. Both params ARE echoed: `country` and `fiscalTerritory` are operator-typed
     * configuration, the same format/coherence family as `provisioning.invalid_country` and
     * `provisioning.duplicate_series_code` above — neither is a secret, and a refusal that withheld
     * them could not be acted on. */
    "provisioning.territory_country_mismatch": { country: string; fiscalTerritory: string };
    /** Waitron's own AEAT software identifier — `WAITRON_ID_SISTEMA`, a product constant rather
     * than operator input — is empty or longer than its ≤ 2-char limit (FAQ §4). Thrown by
     * `assertUsableIdSistema` (`fiscal-modules.ts`), which `planVenue` calls before it builds the
     * `register-sif` action, so a wrong value is a programming error caught on the production path
     * before it can reach `registro_sif.id_sistema_informatico` and, through that, every registro a
     * node files, where it could only be superseded by re-registration, never corrected.
     *
     * `provisioning.*`, and the choice is forced as much as reasoned: `apps/server/src/errors.ts`
     * already registers `sif.id_sistema_invalid` with this exact shape, but `apps/server` cannot be
     * imported from a package, so that declaration is not in scope for `@waitron/provisioning`'s
     * type-checker — `throw new AppError("sif.id_sistema_invalid", …)` here fails `tsc` with
     * `error TS2345: Argument of type '"sif.id_sistema_invalid"' is not assignable to parameter of
     * type 'keyof ErrorParams'` (measured on this tree). It is not a NODE-provisioning code in the
     * sense the header above warns against: it validates Waitron's own global product constant, not
     * any one node's SIF row. Converging the two length rules onto a single code is a noted
     * follow-up (see the doc comment on `WAITRON_ID_SISTEMA`).
     *
     * `value` and `maxLength` mirror `sif.id_sistema_invalid` exactly so that follow-up changes only
     * the prefix. `value` IS echoed — the same format-check family as
     * `provisioning.invalid_identifier` above, `shared.invalid_id` and `server.config_invalid`: a
     * product id or an operator's typo, never a secret. */
    "provisioning.id_sistema_invalid": { value: string; maxLength: number };
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
     * This is not defensive: PostgreSQL answers a `GRANT` from a grantor that holds some privilege
     * on the object but no grant option with a **WARNING, not an error** — the command tag is still
     * `GRANT` and the driver reports success. Observed directly on `postgres:18-alpine`: as a
     * non-owning `login createdb createrole` admin, `grant create on database acl_db to r_app`
     * printed `WARNING: no privileges were granted for "acl_db"`, and `pg_database.datacl`
     * afterwards still read `{=Tc/owner_a,owner_a=CTc/owner_a,r_mig=C/owner_a}` — no `r_app` entry.
     * (A grantor holding nothing at all errors with 42501 instead; on a database that needs
     * `PUBLIC`'s default `CONNECT` revoked first, which is why the warning is the usual case.)
     * `GRANT ALL PRIVILEGES` is quieter still: when only part of the list is grantable it prints no
     * diagnostic whatsoever. Without this check
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
