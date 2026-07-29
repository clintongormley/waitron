// A bare side-effect import, not a value used here: it makes TypeScript treat "@waitron/shared" as
// a real module to augment rather than declaring a fresh ambient one — the same idiom
// packages/payments/src/errors.ts and packages/credentials/src/errors.ts use.
import "@waitron/shared";

/**
 * This host's contribution to the shared error registry, by declaration merging. The convention is
 * the DOMAIN CONCEPT, lowercase and dot-namespaced — `server.*` here because these are facts about
 * the process itself, not about a sale, a payment or a credential.
 *
 * Reachability: every file that throws one of these imports "./errors.js" directly, and this
 * package has no public barrel to keep them reachable from — it is an application, not a library.
 * `errors.reachability.test.ts` exists in library packages for consumers that only see `index.ts`;
 * there is no such consumer here.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** A required environment variable is absent or empty. `variable` is our own declared name. */
    "server.config_missing": { variable: string };
    /**
     * A supplied environment variable cannot be used. Carries the variable NAME and a reason CODE
     * and, for most reasons, never the value: an operator who pasted a secret into the wrong
     * variable must not have it land in an error's params, the same leak
     * `credentials.invalid_payload` avoids by reporting a count instead of field names.
     *
     * `value`/`otherVariable`/`otherValue` are the deliberate exception, used only by `config.ts`'s
     * three tick-cadence cross-checks (`minTickMs` vs `maxTickMs`, `skipRetryMs` vs each). Those
     * compare TWO variables, and either one may be the one the operator actually set — naming only
     * the one the guard happens to key off (F6 of the 2026-07-27 pre-merge review: an operator who
     * set only `WAITRON_MIN_TICK_MS` got an error naming `WAITRON_SKIP_RETRY_MS`, a variable they
     * never touched) leaves the message unreadable half the time. A millisecond integer is not a
     * secret the way an arbitrary env value can be, so both effective values travel too.
     */
    "server.config_invalid": {
      variable: string;
      reason: string;
      value?: number;
      otherVariable?: string;
      otherValue?: number;
    };
    /**
     * A tenant's credential exists but this host cannot use it — a field the purpose registry now
     * declares is absent from a row sealed under an older field list, or its value is not one of
     * the accepted ones. `field` is a name from `PURPOSES`, so it is ours to echo. Spec §5.1: this
     * is the read-side half of `rotate`'s coupling to the registry, and it fails one tenant loudly
     * rather than defaulting to a wrong AEAT host in silence.
     */
    "server.credential_unusable": { tenantId: string; purpose: string; field: string };
    /** A migration folder named by the manifest is absent or carries no Drizzle journal. */
    "server.migrations_missing": { name: string; folder: string };
    /**
     * Provisioning was pointed at a tenant or a till that this connection cannot see. `id` is
     * echoed because both are operator-supplied arguments and neither is a secret — an operator who
     * mistyped one needs to see which of the two ids was rejected, and a UUID identifies nothing on
     * its own.
     *
     * A till of ANOTHER tenant reports `till` rather than a distinct "wrong owner" code, and
     * deliberately: to a caller scoped to one tenant the two are the same fact, and RLS makes them
     * literally indistinguishable — a foreign till simply is not there. Reporting them separately
     * would mean a superuser (who sees the foreign row) got a different error than the deployment
     * role for the same mistake, and would confirm the existence of another tenant's till to
     * whoever asked.
     */
    "server.provision_target_missing": { target: "tenant" | "till"; id: string };
    /**
     * The HTTP listener's socket failed to bind. `code` is the raw OS error Node attaches to the
     * `'error'` event (`EADDRINUSE` for the common case of a fixed default port already taken,
     * `EACCES` for a privileged port with no permission) — never the `Error` itself, whose
     * `.message` can embed the bind address; this package's own convention is a structured code
     * over prose regardless of whether that particular detail would actually be sensitive.
     */
    "server.listen_failed": { port: number; code: string };
    /**
     * `StartedServer.close()` rejected during a signal-initiated shutdown. `errorCode` is
     * `codeOf`'s structured classification, never the caught value's `.message`: this path's most
     * likely source is `db.close()` (a `pg` pool `end()`), whose driver messages can carry the
     * connection string the pool was built from — and the same rule `pass.ts` and `loop.ts` follow
     * for every other caught value applies no less because this one happens on the way out.
     */
    "server.shutdown_failed": { errorCode: string };
  }
}
