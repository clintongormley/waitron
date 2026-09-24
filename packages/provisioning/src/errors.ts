import "@waitron/shared";

/**
 * `provisioning.*` is standing a DEPLOYMENT up, not this package's name. A code about a NODE's
 * provisioning (`apps/server/src/provision-till.ts`'s `provisionNode`) should not land here.
 *
 * NO PARAM HERE EVER CARRIES A GENERATED PASSWORD, A KEY, OR A CONNECTION STRING: `src/bin.ts` and
 * `src/cli.ts`'s `reportFailure` print `${error.code} ${JSON.stringify(error.params)}` to stderr,
 * straight into an operator's scrollback.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** Nothing supplied the venue directory: no `--venue-dir`, `WAITRON_VENUE_DIR` unset or empty,
     * AND the prompt answered nothing. `variable` is our own declared environment-variable NAME,
     * never a path an operator typed. */
    "provisioning.venue_dir_missing": { variable: string };
    /** `value` IS echoed: it is operator-typed configuration, never a secret, and a refusal that
     * withheld it could not be acted on. */
    "provisioning.invalid_identifier": { kind: "database"; value: string };
    /** Not two ASCII letters — the SHAPE of an ISO-3166-1 alpha-2 code such as `ES`, not a
     * membership check against a country list. `value` IS echoed: an operator's typo, never a
     * secret. */
    "provisioning.invalid_country": { value: string };
    /** `WAITRON_ENV` holds something that is not `production`, `preproduction` or `dev`. The
     * environment stamp derived from it is permanent, so an approximation of the word is refused
     * rather than rounded: `Production` and ` production` both land here. `value` IS echoed: it is
     * the operator's own deployment configuration, a word rather than a secret. */
    "provisioning.invalid_environment": { variable: string; value: string };
    /** The venue directory's venue file holds no `deployment` table: nothing has migrated it.
     * Opening a virgin directory SUCCEEDS — the store creates it — so this is where a mistyped path
     * is caught. `database` is the venue DIRECTORY — operator-typed configuration, never a secret. */
    "provisioning.database_unmigrated": { database: string };
    /** `applyVenue` hit a unique-key violation. `database` only, and never the driver's own error,
     * which can quote the failing statement back in its message. `database` is operator-typed
     * configuration and never a secret. */
    "provisioning.venue_conflict": { database: string };
    "provisioning.second_venue": Record<string, never>;
    /** A DIFFERENT tenant was asked to stand up in a database that already holds one. The same
     * identity and an empty database both pass (`assertNoForeignTenant`, `./tenant-guard.ts`).
     * `database` is operator-typed configuration and never a secret. */
    "provisioning.foreign_tenant": { database: string };
    /** `applyVenue` found the ONE taxpayer row (`id = 1`) naming a DIFFERENT country and tax id,
     * compared trimmed and upper-cased. `provisioning.foreign_tenant` is the refusal raised before
     * `applyVenue` by the callers that read the existing identities first. */
    "provisioning.tenant_identity_mismatch": Record<string, never>;
    /** DEPRECATED: nothing raises it. Kept registered because codes are never deleted once shipped
     * (CLAUDE.md §3). `missing` is the ROLE LABEL of the absent parent, never the uuid. */
    "provisioning.adopt_incomplete": {
      missing: "tenant" | "location" | "node" | "till" | "series";
    };
    /** The `invoice_locales` list must hold one or two entries — the rule the
     * `locations_invoice_locales_len` CHECK enforces (`packages/db/src/schema/tenants.ts`). `count`
     * IS echoed: operator-typed configuration, never a secret. */
    "provisioning.invalid_locales": { count: number };
    /** A venue request gave its standard and rectificative series the SAME code. The two share the
     * key `(node_id, code)`, so `applyVenue`'s `ON CONFLICT DO NOTHING` would silently drop one of
     * them. `code` IS echoed: operator-typed configuration, never a secret. */
    "provisioning.duplicate_series_code": { code: string };
    /** A venue's `fiscal_territory` is not prefixed by the tenant's `country` (`ES-common` requires
     * `ES`), case-insensitively. Checked after `resolveFiscalModules`, so an unimplemented
     * territory fails first with `fiscal.regime_not_implemented`. Both params ARE echoed:
     * operator-typed configuration, neither is a secret. */
    "provisioning.territory_country_mismatch": { country: string; fiscalTerritory: string };
    /** The CSPRNG returned the wrong number of bytes. `byteLength` is a size, never material. */
    "provisioning.key_generation_failed": { byteLength: number };
    /** Opening the venue directory, or reading its deployment stamp or table, failed with an error
     * carrying a string `code`; anything else is rethrown unchanged. `reason` is that `code` and
     * never the message: a driver message can quote the failing statement. `database` is the venue
     * directory — operator-typed configuration, never a secret. */
    "provisioning.state_unreadable": { database: string; reason: string };
    /** NOTHING IN THIS REPOSITORY RAISES THIS TODAY. `database` is operator-typed configuration and
     * `owner` is a role NAME — neither is a secret. */
    "provisioning.database_not_owned": { database: string; owner: string | null };
    /**
     * This database's journal carries a migration the installed image has no file for — a NEWER or
     * DIFFERENT image migrated it. Checked explicitly because drizzle cannot: it compares a
     * `created_at` watermark and never a hash (CLAUDE.md §3), so against an AHEAD database it
     * applies nothing and throws nothing (`schema-ahead.migrate.test.ts`).
     *
     * `unknownMigrations` carries drizzle's sha256 digests of migration FILES — public build
     * artefacts of this repository, not secrets.
     */
    "provisioning.database_ahead": { set: string; unknownMigrations: string[] };
  }
}
