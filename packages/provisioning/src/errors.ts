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
 * in this repository. `apps/server/src/provision-till.ts`'s `provisionNode` runs a node's module
 * seeds (the fiscal module's registers it as a SIF), and that is provisioning too — of a node, not
 * of a deployment. So the prefix is not the unambiguous domain name the convention would ideally
 * get; it is the accurate one for what these codes are about, and the ambiguity is real. A future
 * code about a NODE's provisioning should not land here.
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
 * `series.*` and `deployment.*` across two codes. Splitting was available, so each unshipped code
 * was re-decided on its own merits. Each kept `provisioning.*`, for these reasons:
 *
 * - `state_unreadable` is the one worth arguing, because its own text opens with "reading what a
 *   DEPLOYMENT already has" and it carries a `database` param, which makes `deployment.*` look
 *   natural. It is wrong on both counts. `deployment.*` here denotes the environment STAMP and
 *   nothing else — `deployment.already_stamped` (`packages/db/src/errors.ts:44`),
 *   and `deployment.environment_mismatch` (`apps/server/src/errors.ts:120`) are both about WHICH
 *   ENVIRONMENT a deployment belongs to, and this code is about none of that. Its refused-OPEN case
 *   fails before any deployment has been reached at all. Its structural sibling is
 *   `credentials.payload_unreadable`
 *   (`packages/credentials/src/errors.ts:79-85`): a CLI that could not read an input it needs,
 *   named for the domain of the CLI's work and carrying the thing it failed to read as a param,
 *   exactly as `database` is carried here.
 * - `venue_dir_missing` names an input THIS TOOL needs, at a moment when nothing has been reached:
 *   no deployment, no directory, no file. `credentials.key_missing`
 *   (`packages/credentials/src/errors.ts:16`) is the same fact under its own domain's prefix, and
 *   `server.config_missing` (`apps/server/src/errors.ts:19`) is the same fact under the process's.
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
    /** Nothing supplied the venue directory: no `--venue-dir`, `WAITRON_VENUE_DIR` unset or empty,
     * AND the prompt answered nothing — which is what an exhausted stdin or a Ctrl+D produces,
     * deliberately, in `bin.ts`'s `ask`.
     *
     * Refused rather than passed through, because an empty directory is not "no directory": every
     * path the store builds is `join(directory, …)`, and `join("", "venue.db")` is the RELATIVE
     * `venue.db`. So an unset variable plus a non-interactive stdin, which is exactly the shape
     * `README.md` documents for CI, would have `venue` mint a taxpayer, a node and its invoice
     * series into a pair of files in whatever directory the process happened to be started from.
     * A chain and a series number cannot be taken back (CLAUDE.md §5). `apps/server`'s `config.ts`
     * carries the same guard on the same variable, for the same reason.
     *
     * `variable` is our own declared environment-variable NAME, never a path an operator typed —
     * the shape `credentials.key_missing` and `server.config_missing` both carry. A directory is
     * not a secret, but there is nothing to echo here: the whole point of the refusal is that
     * nothing supplied one. */
    "provisioning.venue_dir_missing": { variable: string };
    /** A database or role name outside `/^[a-z][a-z0-9_]{0,62}$/`. `value` IS echoed: it is
     * operator-typed configuration, never a secret, and a refusal that withheld it could not be
     * acted on. */
    "provisioning.invalid_identifier": { kind: "database"; value: string };
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
    /** A venue was requested against a venue directory with no environment stamp. `venue` reads the
     * stamp with `readDeploymentEnvironment` (`packages/db`) BEFORE it applies anything; a `null`
     * result means it was never stamped — and that includes a directory with no schema at all,
     * because that reader asks `sqlite_master` first and answers `null` when the `deployment` table
     * is absent. So this is also what a VIRGIN directory gives: opening one succeeds (it is
     * created), which makes this, not a failed open, the refusal a mistyped path meets.
     *
     * Refused here rather than stamped — stamping belongs to whichever path stood the box up
     * (`provisionVenue`, `apps/server/src/provision.ts`), and one database per environment is a
     * fiscal invariant a stamp cannot take back.
     *
     * `provisioning.*`: a refusal of standing a venue up, the same activity the header describes.
     * `database` is the venue DIRECTORY — operator-typed configuration, never a secret. The param
     * keeps the name the whole family uses; `apps/server`'s boot made the same choice when the
     * directory became the database (`ownerDatabaseName = config.venueDir`). */
    "provisioning.database_unstamped": { database: string };
    /** `applyVenue` hit a unique-key violation (SQLSTATE 23505, detected by `isUniqueViolation`
     * from `packages/db`, which walks the `cause` chain). `applyVenue` guards the keys it knows —
     * the taxpayer row's `id` and each series `(node_id, code)` — with `ON CONFLICT DO NOTHING`, so
     * this is the residual case those clauses do not absorb: most plausibly a second `venue` run
     * racing between this run's plan and its apply. Named here rather than left to reach the
     * operator as `unexpected failure` (`bin.ts`'s catch-all).
     *
     * `database` only, and never the driver's own error: a `DrizzleQueryError` can quote the failing
     * statement back in its message, and this file's header forbids a param that could carry one.
     * `database` is operator-typed configuration and never a secret. */
    "provisioning.venue_conflict": { database: string };
    /** A database that already contains one operational venue was asked to create a different one.
     * Each venue has its own primary/fiscal cluster, while a cloud control plane may coordinate
     * several such databases. A byte-for-byte re-run of the existing venue remains idempotent. */
    "provisioning.second_venue": Record<string, never>;
    /** A SECOND, DIFFERENT tenant was asked to stand up in a database that already holds
     * one. Refused: one tenant per database is the isolation boundary. No query filters rows by
     * tenant and `withTransaction` (`packages/db/src/tenancy.ts`) isolates nothing, so a second
     * `(country, tax_id)` in the same database would expose one business's rows to the other — a cross-tenant
     * leak a hash-chained fiscal record (§5) cannot take back. The invariant is enforced at EVERY
     * tenant-creation entry point — the setup-api provision handler (`provisionVenue`,
     * `apps/server/src/provision.ts`), the `venue` CLI (`packages/provisioning/src/cli.ts`), and the
     * mirror adopt orchestrator (`adoptFromPrimary`, `apps/server/src/adopt.ts`) — through the shared
     * `assertNoForeignTenant` guard (`packages/provisioning/src/tenant-guard.ts`): each reads the
     * existing `(country, tax_id)` set before applying and refuses any identity but the one already
     * present. The SAME identity proceeds to the single-venue guard; an empty database proceeds as
     * the first tenant. This is NOT `venue_conflict` (a concurrent unique-key race on ONE identity);
     * it is a refusal of a FOREIGN identity.
     *
     * `database` only, and never the driver's own error: the same discipline `venue_conflict` keeps
     * — `database` is operator-typed configuration and never a secret. */
    "provisioning.foreign_tenant": { database: string };
    /** `applyVenue` was asked to stand a venue up in a database whose ONE taxpayer row already
     * names a DIFFERENT country and tax id. The taxpayer is a single row keyed `id = 1`
     * (`packages/db/src/schema/tenants.ts`), so the alternative to refusing is not "two taxpayers":
     * it is a primary-key violation reported as a driver error nobody can act on. Refused by name
     * instead, at the write boundary.
     *
     * NOT the refusal an operator meets after mistyping a NIF. That is
     * `provisioning.foreign_tenant`, raised by `assertNoForeignTenant`
     * (`packages/provisioning/src/tenant-guard.ts`) BEFORE `applyVenue` is entered, at every caller
     * that reads the existing identities first — the `venue` CLI, `provisionVenue` and
     * `adoptFromPrimary` (`cli.test.ts` pins that the CLI prints it and the apply is never
     * reached). This code catches what that pre-read cannot see: another run committing a different
     * taxpayer between the pre-read and this write, and the caller that does no pre-read at all.
     *
     * The write itself is `insert … on conflict do nothing` followed by a `for update` read of the
     * row, so the loser of that race waits for the winner's transaction and then reads the winner's
     * identity — landing here or on the idempotent path, never on a raw `23505`
     * (`venue-apply.race.pg.test.ts`). Comparison is on the canonical values — both sides trimmed
     * and upper-cased, the same normalisation `planVenue` applies — so a casing or
     * surrounding-space difference is the SAME identity and proceeds as an idempotent re-run.
     *
     * No params, the shape `provisioning.second_venue` above keeps: this is a refusal INSIDE
     * applyVenue's transaction, and the identity the operator supplied is the one they just typed.
     */
    "provisioning.tenant_identity_mismatch": Record<string, never>;
    /** A mirror-bundle adopt found one of the DESIGNATED ids for `trading.env` absent from the
     * inserted rows — a malformed or incomplete bundle. DEPRECATED: its former thrower `adoptVenue`
     * was deleted when the initial copy went native (a native tablesync COPY cannot coexist with
     * pre-inserted rows — swap S5). The code is kept registered per CLAUDE.md §3 (codes are never
     * deleted once shipped). `missing` is the ROLE LABEL of the absent parent
     * (`location`|`node`|`till`|`series`; `tenant` was a fifth until the tenant column went on
     * 2026-09-14), never the uuid. */
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
     * share the natural key `(node_id, code)`, so a venue built from such a request would
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
     * belong to the tenant's `country`: installed fiscal territories are country-prefixed
     * (`ES-common`, `GB-vat`, …), so `ES-common` (Spain / Veri*Factu) requires `country` `ES`.
     * The check matters because `applyVenue` writes the
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
    /** The CSPRNG returned the wrong number of bytes. `byteLength` is a size, never material. */
    "provisioning.key_generation_failed": { byteLength: number };
    /** Opening the venue directory, or reading the deployment stamp out of it, failed. `venue`
     * reads before it decides, so this is where a directory the tool cannot use surfaces.
     *
     * Measured on Node v26.7.0 against the real `openVenueDatabase`, which is what makes the two
     * reachable shapes concrete rather than defensive: a path running through a regular file gives
     * `code: "ENOTDIR"` from the `mkdir`, and a directory whose `venue.db` is not a database gives
     * `code: "ERR_SQLITE_ERROR"` (errcode 26, "file is not a database"). A VIRGIN directory is
     * neither — it is created and opened — so a mistyped path lands on
     * `provisioning.database_unstamped` instead. `cli.ts`'s `withVenueState` carries the same
     * receipt at the site that acts on it.
     *
     * Raised ONLY when the failure carries a string `code`. Anything else is a bug, not a fact
     * about this directory, and is rethrown unchanged rather than dressed up as one. `reason` is
     * that `code` and never the message: a driver message can quote the failing statement, which
     * this file's header forbids echoing. `database` is the venue directory — operator-typed
     * configuration, never a secret. */
    "provisioning.state_unreadable": { database: string; reason: string };
    /** A database being migrated is owned by a role other than `waitron_migrator`.
     *
     * **NOTHING IN THIS REPOSITORY RAISES THIS TODAY.** Both throwers lived on the
     * `waitron-provision instance` path, deleted when a venue became a directory of SQLite files
     * rather than a database on a PostgreSQL server. The declaration is kept because
     * `apps/server/src/recovery-surface.ts` still maps it to operator wording, and that map is
     * typed `Partial<Record<ErrorCode, …>>` — removing the code here fails that file's typecheck.
     * Retiring the pair is a change to the recovery page, not to this registry.
     *
     * `provisioning.*` because it is a fact about standing a deployment up; `database` is
     * operator-typed configuration and `owner` is a role NAME read from the catalog — neither is a
     * secret. */
    "provisioning.database_not_owned": { database: string; owner: string | null };
    /**
     * This deployment's database carries a migration the installed image has no file for — it was
     * migrated by a NEWER or DIFFERENT image. Detected explicitly, because drizzle cannot: it
     * compares a `created_at` watermark and never a hash (CLAUDE.md §3), so against an AHEAD
     * database it applies nothing, throws nothing, and the mismatch surfaces later as an
     * unclassified driver error in whatever query first touches the changed schema. Measured with a
     * control, 2026-09-10.
     *
     * `unknownMigrations` carries drizzle's own sha256 digests of migration FILES — public build
     * artefacts of this repository, not secrets — and they are what an installer greps for to find
     * which image did it. The operator never sees them: the recovery page renders fixed text keyed
     * on the code alone.
     *
     * There is no backward migration by decision (CLAUDE.md §3), so the action is restore or
     * reinstall, never an automatic repair.
     */
    "provisioning.database_ahead": { set: string; unknownMigrations: string[] };
  }
}
