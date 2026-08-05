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
     * A required `WAITRON_TILL_*` environment variable is unset — absent, or the empty string (an
     * `VAR=` line, which `till-config.ts` treats as unset for the same reason `config.ts`'s `isUnset`
     * does). `key` is the variable NAME, our own declared identifier, and is the ONLY field: the
     * value is never echoed, so an operator who pasted a secret into the wrong `WAITRON_TILL_*`
     * variable cannot have it land in an error's params — the same no-leak discipline
     * `server.credential_unusable` and `payment.webhook_signature_invalid` follow.
     *
     * `server.*`, not a fiscal-domain prefix, even though the values it guards ARE the till's four
     * fiscal ids: WHICH till this process is is a fact about the process's own configuration
     * (provisioning stamps the deployed till's identity into the environment; `till-config.ts` reads
     * it back), exactly the class `server.config_missing` above covers for the rest of the host's
     * config. A value that is present but malformed is `server.till_config_invalid` below; this code
     * is for one that is simply not there.
     */
    "server.till_config_missing": { key: string };
    /**
     * A `WAITRON_TILL_*` value is present but not usable — a branded-id constructor
     * (`@waitron/shared`'s `tenantId`/`tillId`/`nodeId`/`seriesId`/`locationId`) rejected it as not a
     * uuid. `key` names the variable and is again the only field; the rejected value is NOT carried,
     * for the same reason as `server.till_config_missing` above, and `server.*` for the same reason
     * too.
     */
    "server.till_config_invalid": { key: string };
    /**
     * A tenant's credential exists but this host cannot use it — a field the purpose registry now
     * declares is absent from a row sealed under an older field list, or its value is not one of
     * the accepted ones. `field` is a name from `PURPOSES`, so it is ours to echo. Spec §5.1: this
     * is the read-side half of `rotate`'s coupling to the registry, and it fails one tenant loudly
     * rather than defaulting to a wrong AEAT host in silence.
     */
    "server.credential_unusable": { tenantId: string; purpose: string; field: string };
    /**
     * No such tenant. `id` is echoed because it is an operator-supplied argument and not a secret —
     * a mistyped UUID identifies nothing on its own, so an error that withheld it would be
     * unactionable.
     *
     * Deliberately NOT `server.*`, unlike its neighbours here: the prefix names the DOMAIN CONCEPT,
     * never the package that happens to throw (packages/shared/src/errors.ts's design note, and
     * `series.not_found` — renamed twice to converge on exactly this rule). "There is no such
     * tenant" is a fact about a tenant. It is declared in this file rather than in packages/db,
     * which owns the table, only because `@waitron/db`'s exports map is enumerated and deliberately
     * publishes no path to its `errors.ts` — so a consumer cannot follow this repo's "the throwing
     * file imports the registry directly" convention across that boundary. Move both codes down if
     * a package ever needs to throw them.
     */
    "tenant.not_found": { id: string };
    /**
     * No such node *for this tenant*. The SIF is the compute node (#33), so provisioning registers a
     * node, not a till (node-id rekey, 2026-08-03). A node belonging to ANOTHER tenant reports this
     * same code rather than a distinct "wrong owner" one: to a caller scoped to one tenant the two are
     * the same fact, and a separate code would confirm the existence of another tenant's node to
     * whoever asked.
     *
     * Note this is enforced by comparing `nodes.tenant_id`, NOT by relying on RLS to hide the
     * foreign row — see `provisionNode`. The two agree for the deployment role; the explicit check
     * is what makes them agree for a superuser as well. `node.*`, not `server.*`: it is a fact about a
     * node, the rule `tenant.not_found`'s own note gives.
     *
     * (The former `till.not_found` was removed with the rekey — pre-production, no bwc — since its
     * only thrower, `provisionTill`'s ownership check, is now `provisionNode`'s and throws this.)
     */
    "node.not_found": { id: string; tenantId: string };
    /**
     * `IdSistemaInformatico` is not a usable software identifier. AEAT caps it at two characters —
     * `packages/verifactu`'s `validate` encodes exactly that rule as `ID_SISTEMA_LENGTH`, and every
     * fixture in this repo uses `"WT"`.
     *
     * Checked at provisioning because nothing else checks it anywhere: `validate` has no caller on
     * the production path, `registro_sif` carries no CHECK on the column, and `registerSif` takes a
     * bare `string`. Provisioning is the one moment a human types the value, and from then on it is
     * copied onto every registro the till files — where it cannot be corrected, only superseded by
     * re-registering onto a fresh chain.
     *
     * `sif.*` rather than `server.*` for the reason `tenant.not_found` gives; the namespace is
     * `packages/fiscal-verifactu`'s, and this code belongs there once that package validates its own
     * input (recorded as a follow-up in the plan).
     */
    "sif.id_sistema_invalid": { value: string; maxLength: number };
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
    /**
     * This host is configured for one environment and the database belongs to another. Thrown
     * before migrations run, so nothing is written.
     *
     * `deployment.*` rather than `server.*`: it is a fact about which deployment this database
     * belongs to, not about the process. Neither value is a secret — both are already in the
     * host's own configuration.
     */
    "deployment.environment_mismatch": { databaseEnvironment: string; hostEnvironment: string };
    /**
     * A tenant's Stripe key belongs to the other environment. A test key on a production
     * deployment takes payments that never settle, and `reconcile` then sweeps a test-mode account
     * against live rows and reports every one as missing upstream.
     *
     * Carries the key's ENVIRONMENT, never the key or any prefix of it — the same rule
     * `credentials.invalid_payload` follows by reporting a count rather than field values.
     */
    "payment.credential_environment_mismatch": {
      tenantId: string;
      keyEnvironment: string;
      hostEnvironment: string;
    };
    /**
     * An inbound hosted-payment webhook failed signature verification for the tenant named in the
     * path. The signature is the sole gate (design §2): the path tenant is attacker-controllable,
     * so nothing acts on the event until THAT tenant's own `webhookSecret` verifies the raw bytes.
     * A caller who names a real tenant but cannot produce a body signed by that tenant's secret gets
     * this and an HTTP 400.
     *
     * `payment.*`, not `server.*`: a signature failure is a fact about a payment event, not about
     * the process (`tenant.not_found`'s note above gives the rule). Carries ONLY the `tenantId` —
     * never the signature, the raw body or the secret, the same no-leak discipline
     * `server.credential_unusable` follows.
     */
    "payment.webhook_signature_invalid": { tenantId: string };
    /**
     * A webhook verified against the path tenant's secret, but the payment it settles resolves
     * (`resolve_payment_tenant`, the #26 seam) to a DIFFERENT tenant — reachable only when two
     * tenants share a Stripe account, i.e. a cross-tenant misconfiguration. Refused with HTTP 400
     * rather than settling a row across the tenant boundary. Defence-in-depth on top of the
     * signature gate, which keeps the seam load-bearing even though the path already names a tenant.
     */
    "payment.webhook_tenant_mismatch": {
      pathTenantId: string;
      resolvedTenantId: string;
      externalRef: string;
    };
    /**
     * A verified webhook whose `external_ref` resolves to no local `initiated` payment — a crash
     * between minting the Checkout Session and writing its row, or an event for a session this host
     * never minted. LOG-ONLY (a structured field, never thrown-and-caught): the route acks 2xx so
     * Stripe stops retrying, and `reconcile`'s `missing_local` class backstops the settlement
     * per-tenant. Not modelled on the credential-purpose key `payments.stripe` — that is a purpose,
     * not an error (design §4).
     */
    "payment.webhook_unresolved": { provider: string; externalRef: string };
    /**
     * A basket line named a product the till cannot sell at its location — it is not in the
     * location's assigned catalogue, is deactivated, or belongs to another tenant (RLS hides it, so
     * "not sellable here" and "another tenant's product" read identically, the same fail-closed shape
     * `sale.series_not_found` uses). `productId` is a uuid the caller already holds, not a secret, so
     * echoing it is what makes the error actionable.
     *
     * `sale.*`, not `server.*`: it is a fact about the SALE the till is ringing, not about the
     * process (`tenant.not_found`'s note above gives the rule). Registered here by the same
     * `declare module` this file uses for its other codes; `@waitron/core` owns the rest of the
     * `sale.*` family, and this adds to it by declaration merging rather than colliding with it.
     */
    "sale.unknown_product": { productId: string };
    /**
     * The till was asked to ring a sale with no lines. A sale must have at least one line to price
     * and to file, so this is refused before any catalogue read or fiscal write. No params: there is
     * nothing to carry beyond the code itself.
     */
    "sale.empty_basket": Record<string, never>;
    /**
     * A tender method this till does not support. Slice 1 of the counter POS is cash-only, so
     * anything but `"cash"` is refused before touching the database. `method` echoes the request so a
     * translator can name what was attempted; it is caller-supplied text, never a secret.
     */
    "sale.unsupported_tender": { method: string };
  }
}
