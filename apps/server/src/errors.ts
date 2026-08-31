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
     * A write reached a node running as a read-only MIRROR. The mirror serves the dashboard read-only
     * and pulls + applies a primary's rows; it refuses every non-GET at the HTTP layer (the read-only
     * gate, `read-only-gate.ts`), because `deployment.mode = 'mirror'`. `node.*`, not `server.*`: it is a
     * fact about the node's role in the topology, not about the process. No params — the refusal names no
     * row, so a log line leaks nothing (the `sync.*`/`tunnel.*` discipline). Cleared by promotion
     * (`deployment.mode = 'primary'`), read live so no restart is needed.
     */
    "node.read_only": Record<string, never>;
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
     * A caught value that is NOT an AppError reached the till API's `run` wrapper — an unclassified
     * fault (a driver error, a request-body parse failure, a bug), surfaced to the client as an
     * opaque 500 so nothing internal leaks. `run` logs the structured `codeOf` classification under
     * `till.failed`; the RESPONSE carries only this code and no params, telling the client nothing
     * about the cause — the same no-message discipline `server.shutdown_failed` follows for its own
     * caught value.
     */
    "server.internal": Record<string, never>;
    /**
     * A MIRROR node was asked to bind its HTTP listener to a NON-loopback host without the explicit
     * `WAITRON_MIRROR_ALLOW_EXPOSED` opt-in. A mirror serves an UNAUTHENTICATED admin dashboard
     * (`ensureMirrorViewer` seeds a full-admin viewer, `mirrorSession` auto-injects its cookie), so
     * the ONLY thing keeping that surface off the network is the loopback default of
     * `WAITRON_HTTP_HOST`. The boot FAILS CLOSED here (`assertMirrorBindSafe`, before `serve`) rather
     * than expose it. `server.*` — a fact about the PROCESS refusing to bind, not about a sale,
     * payment or credential; the guard is a property of THIS host's configuration.
     *
     * `host` is the operator's own `WAITRON_HTTP_HOST` value, echoed to name the unsafe bind — it is
     * this host's own config, never attacker-supplied and never a secret, exactly as
     * `server.config_missing`'s `variable` and `server.listen_failed`'s `port` are. Never renamed
     * once shipped.
     */
    "server.mirror_bind_exposed": { host: string };
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
     * A tender method this till does not support. The counter POS supports `"cash"` (slice 1) and a
     * manual `"card"` tender (slice 3, the "datáfono" case); `"voucher"`/`"transfer"`/`"other"` are
     * refused before touching the database. `method` echoes the request so a translator can name what
     * was attempted; it is caller-supplied text, never a secret.
     */
    "sale.unsupported_tender": { method: string };
    /**
     * A ring-time modifier selection named an `option_group_item_id` that does not belong to any
     * ACTIVE option group attached to the product being ordered (ordering modifiers, Task 6). The
     * server resolves every selected option against the product's own resolved `optionGroups` (the
     * SAME read `listAvailableProducts` returns) and refuses one that resolves to nothing — the client
     * is never the gate, so a crafted or stale id is caught here before any line is priced or filed.
     * An id belonging to an INACTIVE group/item, to ANOTHER product's group, or to nothing at all all
     * report THIS one code — to a till pricing a basket they are the same fact ("that option is not
     * offered on this dish"), the fail-closed shape `sale.unknown_product` uses.
     *
     * `optionGroupItemId` and `productId` are caller-supplied uuids the till already holds, not
     * secrets — an id that matches nothing is unactionable if withheld (the rule `tenant.not_found`'s
     * note above gives). `option.*` names the DOMAIN CONCEPT (a menu option), never the throwing
     * package; SINGULAR because it names ONE option that was not found — the same singular/plural split
     * `options.selection_invalid` (about the whole selection) sits beside. `@waitron/catalogue` owns
     * the options domain, so this belongs there once a package other than this host throws it — the
     * same note `sale.unknown_product` carries about its own placement. Mapped to 404. Never renamed
     * once shipped.
     */
    "option.not_found": { optionGroupItemId: string; productId: string };
    /**
     * A ring-time modifier SELECTION violated one of its product's option-group constraints (ordering
     * modifiers, Task 6): a `required` group with nothing picked, fewer than `minSelect`, or more than
     * `maxSelect`. The server validates the whole selection per group against the product's resolved
     * `optionGroups` and refuses a basket the client should have caught — the client is never the gate.
     * `reason` is a stable CODE, never prose: `"required"` (a required group, nothing selected),
     * `"below_min"` (fewer than `minSelect`), or `"above_max"` (more than `maxSelect`); a translator
     * renders it. An EMPTY group (`items: []`, an authoring bug) carries no constraint and is skipped,
     * never a source of this — nothing may block a sale on a mis-authored group (CLAUDE.md §5).
     *
     * `productId` and `groupId` are caller-/catalogue-supplied uuids the till already holds, not
     * secrets; the offending count is NOT carried (the no-leak discipline this file keeps — echo names
     * and stable codes, never raw values). `options.*` names the DOMAIN CONCEPT (a menu-option
     * selection), never the throwing package; PLURAL because it is a fact about the whole SELECTION,
     * beside the singular `option.not_found` (one option). Destined for `@waitron/catalogue` once a
     * package other than this host throws it — the note `option.not_found` carries. A CLIENT
     * request-shape fault → mapped to 400. Never renamed once shipped.
     */
    "options.selection_invalid": { productId: string; groupId: string; reason: string };
    /**
     * A ring-time request attached modifier options to a product that cannot carry them (ordering
     * modifiers, Task 6): modifiers attach to `each` products only this slice, so options on a
     * `weight`-priced product (loose deli sold by the kilo) are refused before pricing. A crafted
     * request is the only way to reach it — the till never offers option groups on a weighed product —
     * and the server is the gate, so it fails loud here rather than pricing a nonsensical basket.
     *
     * `productId` is the caller-supplied uuid the till already holds, not a secret; `pricingUnit` is
     * the product's own `each`/`weight` classification (this file's config, never a secret), echoed so
     * the message can name why the attachment was refused. `options.*` names the DOMAIN CONCEPT (a
     * menu-option selection), never the throwing package, beside `options.selection_invalid`; destined
     * for `@waitron/catalogue` once a package other than this host throws it — the note
     * `option.not_found` carries. A CLIENT request-shape fault → mapped to 400. Never renamed once shipped.
     */
    "options.unsupported_product": { productId: string; pricingUnit: string };
    /**
     * An operation needed an open shift session and none was supplied — the till's session cookie was
     * absent or named no open session. A fact about the REQUEST, so the operator-scoped routes
     * Tasks 5/6 add (`GET /api/staff`, `POST /api/sales`) refuse with this before doing any work. No
     * params: there is nothing to carry beyond the code, and the missing cookie's value is never
     * echoed.
     *
     * `session.*`, not `server.*`, for the reason `tenant.not_found`'s note above gives (the prefix
     * names the DOMAIN CONCEPT, never the throwing package). `@waitron/identity` owns the rest of the
     * `session.*` family (`session.not_open`); this adds to it by declaration merging, and belongs
     * there once a package other than this host needs to throw it — the same note `tenant.not_found`
     * carries about its own placement.
     */
    "session.required": Record<string, never>;
    /**
     * No OPEN working order with this id that the caller may retrieve HERE. The id names none, or it
     * names one already `settled`/`abandoned`, or it belongs to another tenant (RLS hides it), or it
     * is a same-tenant order parked on ANOTHER node (the by-id lookups are node-scoped, like the held
     * list) — all report THIS one code. To a till that only wants to rebuild a parked basket they are
     * the same fact ("nothing to retrieve here"), and a distinct "it exists but is closed" code
     * would confirm a closed or foreign order exists — the same fail-closed reasoning
     * `node.not_found` and `sale.series_not_found` use.
     *
     * `workingOrderId` is echoed because it is a caller-supplied uuid the till already holds, not a
     * secret — an id that matches nothing is unactionable if withheld (the rule `tenant.not_found`'s
     * note gives). The field is QUALIFIED (`workingOrderId`, not a bare `id`) to match the
     * domain-record not_found family — `sale.not_found`'s `saleId`, `series.not_found`'s `seriesId`:
     * a working order is the mutable pre-sale record those sit beside, not an infrastructure object
     * like the `tenant`/`node` whose bare `id` this file's two other not_founds carry.
     *
     * `working_order.*`, not `server.*`: it is a fact about a working order, not the process
     * (`tenant.not_found`'s note gives the rule). `@waitron/core` owns the rest of the order/sale
     * domain, so this belongs there once a package other than this host throws it — the same note
     * `sale.unknown_product` carries about its own placement.
     */
    "working_order.not_found": { workingOrderId: string };
    /**
     * A working order this caller tried to MODIFY is not `open` HERE — it names one already
     * `settled`/`abandoned`, or it names none this node may reach (an absent id, another tenant's
     * order that RLS hides, or a same-tenant order parked on ANOTHER node — the by-id lookups are
     * node-scoped). All of those report THIS one code: to a till trying to edit or abandon a draft the
     * distinction between "closed" and "never existed" is the same fact ("there is no open draft here
     * to change"), and a distinct "it exists but is closed" code would confirm a closed or foreign
     * order exists — the same fail-closed reasoning `working_order.not_found` uses for the RETRIEVE
     * side. Mapped to HTTP 409 in Task 8, the mutation counterpart to `not_found`'s 404: the id may be
     * perfectly valid, but the order's state forbids the edit.
     *
     * The database is the backstop, not this code: `working_orders_enforce_transition` (0004) rejects
     * any UPDATE of a non-open row and `working_order_lines_require_open_parent` rejects a line
     * write under a non-open parent, so an update that slipped past the app check would still fail —
     * just with a raw trigger error instead of this actionable one. `updateHeldOrder` and
     * `abandonHeldOrder` throw this from the app side so the caller gets the domain code.
     *
     * `workingOrderId` is echoed and qualified for the same reasons `working_order.not_found` gives
     * (a caller-supplied uuid, not a secret; qualified to match the domain-record family). And
     * `working_order.*`, not `server.*`, and destined for `@waitron/core` once a package other than
     * this host throws it — the same note `working_order.not_found` and `sale.unknown_product` carry.
     */
    "working_order.not_open": { workingOrderId: string };
    /**
     * A working order this caller tried to CANCEL or AMEND is not `placed` — it names one still `open`
     * (edit it silently via updateHeldOrder instead), one already `settled`/`abandoned`, or none at all
     * (absent, or another tenant's, RLS-hidden). All report THIS one code, the same fail-closed shape
     * `working_order.not_open` uses for the modify side. Mapped to 409 (the state forbids the operation).
     * `working_order.*`, not `server.*`, and destined for @waitron/core once a package other than this
     * host throws it — the note `working_order.not_open` carries.
     */
    "working_order.not_placed": { workingOrderId: string };
    /**
     * A logged amendment (a cancel, art. 29.2.j) was requested with no reason — the field was absent,
     * empty, or whitespace-only. The app enforces it because `order_amendments` carries NO DB CHECK
     * forcing a reason on `order_cancelled` (that column is nullable, null being the genesis
     * `order_placed`'s legitimate value — see the schema comment), so nothing but this guard stops a
     * reasonless cancel from writing an accountability-empty entry. Its OWN code, deliberately NOT
     * `working_order.not_placed`: this guard fires BEFORE the order is locked and its status read
     * (`cancelPlacedOrder` checks the reason first), so the order's state is unknown at this point — it
     * may be open, settled, abandoned or absent. A missing reason is a client/request-shape error
     * independent of that state, so `not_placed` would mislabel it as a state conflict (CLAUDE.md §1).
     * Carried through 7c's carry-forward from Task 3's review, which required the reason-non-null
     * contract be enforced by the app.
     *
     * A client error (the request omitted a required field), distinct from `not_placed`'s state
     * conflict — a 400 to that code's 409, mapped in the route layer (Task 8+). `workingOrderId` is
     * echoed and qualified for the same reasons the family's other codes give (a caller-supplied uuid,
     * not a secret). `working_order.*`, not `server.*`, and destined for `@waitron/core` once a package
     * other than this host throws it — the note `working_order.not_open` carries.
     */
    "working_order.reason_required": { workingOrderId: string };
    /**
     * A working order this caller tried to SEND TO PREP (`sendToPrep`, the Mode-P pickup — design §5)
     * is not `settled`. It names one still `open` (never paid), one `placed` (Modes I/T enqueue their
     * OWN prep row at PLACING, via `placeOrder` — `sendToPrep` is never their route, so a `placed`
     * order here means the wrong path was called, not a legitimate double-enqueue), one `abandoned`,
     * or it names none at all (absent, or another tenant's order that RLS hides). All report THIS one
     * code, the same fail-closed shape `working_order.not_open`/`not_placed` use for their own state
     * guards — to a caller trying to enqueue a Mode-P pickup, "wrong status" and "doesn't exist" are
     * the same fact ("there is no settled order here to send to prep"). Mapped to 409: the id may be
     * valid, but the order's state forbids the move (fix round 1 — a valid-but-wrong-state or
     * valid-but-absent id was previously reaching a raw `order_prep_order_fk` violation, an opaque
     * 500). `working_order.*`, not `server.*`, for the reason `working_order.not_open`'s note gives.
     */
    "working_order.not_settled": { workingOrderId: string };
    /**
     * A working order this caller tried to hand to the customer (`markCollected`, the Mode-P counter
     * handover — KDS-1 §3e) is ALREADY collected: its order-level `collected_at` marker is set. The old
     * order-level `advancePrep('collected')` refused a repeat the same way; `markCollected` catches it
     * HERE, before the write, because `working_orders_enforce_transition` permits the collected_at stamp
     * only on a NULL → non-null transition (0056), so a second stamp would RAISE (P0001) and surface as an
     * opaque `server.internal` 500. This gives it a clean domain code instead. Distinct from
     * `working_order.not_settled`: an already-collected order IS settled, so that code would mislabel the
     * state (CLAUDE.md §1). Mapped to 409 (the id is valid, but the order's handover state forbids a
     * second collect) — the same fail-closed 409 shape the rest of the `working_order.*` state guards use.
     * `workingOrderId` is the caller-supplied uuid the display already holds, not a secret (the rule
     * `tenant.not_found`'s note gives). `working_order.*`, not `server.*`, for the reason
     * `working_order.not_open`'s note gives. Never renamed once shipped.
     */
    "working_order.already_collected": { workingOrderId: string };
    /**
     * A prep operation is not legal given the order's current prep state (design §5's prep surface):
     *  - `advancePrep`: the requested `to` is not the order's IMMEDIATE next state
     *    (queued → preparing → ready → collected — no skip, no repeat, no jump backwards), or the
     *    order has no prep record to advance at all (never sent to prep, or an absent/foreign id RLS
     *    hides — the same fail-closed shape `working_order.not_open` uses), or `to` is `"queued"`
     *    itself: no prep state legally advances TO queued — reaching `queued` is `sendToPrep`'s job
     *    (an INSERT), never a transition.
     *  - `sendToPrep`: the order is settled and ELIGIBLE (already past the `working_order.not_settled`
     *    guard above) but already has a prep record (`order_prep_pk`) — a double send-to-prep, not a
     *    fresh enqueue.
     * A fact about the order's PREP, not the process. Mapped to 409 (the id may be valid, but the
     * prep state forbids the move — the same shape `working_order.not_open`/`not_placed` use for their
     * own state machines). `order_prep.*` names the domain concept (order preparation), the rule
     * `tenant.not_found`'s note above gives.
     */
    "order_prep.invalid_transition": { workingOrderId: string };
    /**
     * No such dining table for this tenant. `tableId` is a caller-supplied uuid the till already holds,
     * not a secret — an id that matches nothing is unactionable if withheld (the rule `tenant.not_found`'s
     * note gives). Qualified `tableId` to match the domain-record not_found family
     * (`working_order.not_found`'s `workingOrderId`). `table.*` names the DOMAIN CONCEPT, never the
     * throwing package (`tenant.not_found`'s note); destined for @waitron/tables if that package is ever
     * extracted. An absent id, or another tenant's table (RLS hides it), both report THIS one code.
     * (A DEACTIVATED table is a different fact — `table.inactive` below — surfaced only where openTab
     * needs it; CRUD operates on a deactivated row by id regardless.)
     */
    "table.not_found": { tableId: string };
    /**
     * A dining table label already exists in this venue — the `(tenant_id, location_id, label)` unique
     * (`dining_tables_location_label_key`) rejected the insert/update. `label` is the operator-supplied
     * human id ("12", "Terraza 3"), not a secret, so echoing it is what makes the error actionable.
     * `table.*`, not `server.*`, for the reason `tenant.not_found`'s note gives.
     */
    "table.label_taken": { label: string };
    /**
     * A dining table exists but is deactivated, so no tab may be opened on it. `tableId` is the
     * caller-supplied uuid (not a secret). `table.*`, not `server.*`, for the reason `tenant.not_found`'s
     * note gives. Distinct from `table.not_found` (which covers a foreign/absent table): this one says
     * the table is real but closed for service. Mapped to 409 in the route layer.
     */
    "table.inactive": { tableId: string };
    /**
     * A move/join TARGET dining table already has an OPEN tab, so a party may not be relocated or
     * extended onto it — use `mergeTabs` to combine the two bills instead (design §3). A table is "free"
     * when its `tab_id` is null or points at a settled/abandoned order (a stale pointer, TS-1 §2b);
     * `table.occupied` fires only when it points at a STILL-OPEN order. `moveTab`/`joinTable` take the
     * target `dining_tables` row `FOR UPDATE`, so two concurrent moves onto one free table serialise and
     * the loser surfaces THIS code (the lock is the guard — there is no partial-unique). `tableId` — the
     * occupied target — is caller-supplied, not a secret. `table.*` names the DOMAIN CONCEPT (the dining
     * table), never the throwing package (the rule `tenant.not_found`'s note gives). Mapped to 409 (the
     * table's state forbids the move), the sibling of TS-1's `tab.already_open`.
     */
    "table.occupied": { tableId: string };
    /**
     * A table this caller tried to UN-JOIN is not part of the named tab — its `tab_id` points at a
     * different open tab, at a settled/abandoned one, or is NULL (a free table), or the id names none
     * at all (absent, or another tenant's table that RLS hides). All report THIS one code, the same
     * fail-closed shape `tab.not_open`/`table.occupied` use: to an operator un-joining a table, "not
     * joined to this tab" and "no such table here" are the same fact, and a distinct code would confirm
     * a foreign/other-tab table exists. Mapped to 409 in the route layer (the id may be valid, but the
     * table's join state forbids the un-join). `tableId`/`tabId` are caller-supplied uuids the till
     * already holds, not secrets. `table.*`, not `server.*`: it is a fact about a table, not the process
     * (the rule `tenant.not_found`'s note gives); destined for `@waitron/core` once a package other than
     * this host throws it, the note the `working_order.*` family carries.
     */
    "table.not_joined": { tableId: string; tabId: string };
    /**
     * A caller tried to un-join a table's items onto a new tab, but this table is the SOLE table anchoring
     * the named tab — it does not SHARE its tab with any other table, so there is no join to carve it out
     * of. An ordinary single-table tab is settled or moved, not un-joined; only a genuine ≥2-table join
     * splits. Rejecting here is honest: the WITH-items un-join would otherwise repoint this table away and
     * leave the tab anchorless, and the downstream back-pointer check would throw a MISLEADING
     * `tab.not_open` on a tab that is in fact open. `tableId`/`tabId` are caller-supplied uuids the till
     * already holds, not secrets. `table.*`, not `server.*`: it is a fact about a table's join state, not
     * the process (the rule `tenant.not_found`'s note gives); destined for `@waitron/core` once a package
     * other than this host throws it, the note the `table.not_joined` family carries. Mapped to 409 in the
     * route layer (the ids may be valid, but the table's un-shared state forbids the un-join), the sibling
     * of `table.not_joined`.
     */
    "table.not_shared": { tableId: string; tabId: string };
    /**
     * A table's `tab_id` already points at an OPEN working order, so a second tab may not be opened (at
     * most one open tab per table, design §2b). `openTab` takes the `dining_tables` row `FOR UPDATE` and
     * checks its `tab_id`; that per-table lock — there is NO partial-unique now — is the concurrency
     * guard, so two concurrent openTabs serialise and the second surfaces THIS code. A stale `tab_id`
     * (pointing at a settled/abandoned order) reads as free and is overwritten, so it does NOT trigger
     * this. `tab.*` names the DOMAIN CONCEPT (the running tab), never the throwing package. `tableId` —
     * the occupied table — is caller-supplied, not a secret. Mapped to 409 (the table's state forbids a
     * new tab).
     */
    "tab.already_open": { tableId: string };
    /**
     * No such reservation for this tenant. `bookingId` is a caller-supplied uuid the dashboard already
     * holds, not a secret — an id that matches nothing is unactionable if withheld (the rule
     * `tenant.not_found`'s note gives). Qualified `bookingId` to match the domain-record not_found family
     * (`table.not_found`'s `tableId`, `working_order.not_found`'s `workingOrderId`). `booking.*` names the
     * DOMAIN CONCEPT (a restaurant reservation), never the throwing package (the rule `tenant.not_found`'s
     * note gives); destined for @waitron/bookings if that package is ever extracted. An absent id, or
     * another tenant's booking (RLS hides it), both report THIS one code. Mapped to 404 in the route layer
     * (Task 5's booking-api.ts STATUS map). Never renamed once shipped.
     */
    "booking.not_found": { bookingId: string };
    /**
     * A reservation was created or edited with a party size that is not a positive integer — `party_size
     * ≤ 0` (design §3a validates `partySize > 0`). The offending `partySize` is echoed: a headcount is
     * not a secret and echoing it is what makes the error actionable, the same echo-the-offending-value
     * shape `tab.transfer_quantity_invalid`'s `quantity` uses. `booking.*` names the DOMAIN CONCEPT, never
     * the throwing package (`tenant.not_found`'s note gives the rule). A CLIENT request-shape fault (mapped
     * to 400 in Task 5's route STATUS map), distinct from the state-conflict `booking.invalid_transition`
     * (409). Never renamed once shipped.
     */
    "booking.invalid": { partySize: number };
    /**
     * A lifecycle verb (`cancel`/`no-show`/`complete`/`seat`) found the reservation is not in a state the
     * move is legal from — e.g. a cancel of an already-`cancelled`/`completed` booking, or a seat of a
     * booking that is not `booked` (design §3a). Carries the affected `bookingId`, NOT a from/to pair:
     * this matches the house `*.invalid_transition` convention — `order_prep.invalid_transition`
     * (`workingOrderId`) and `ticket.invalid_transition` (`ticketItemId`) both name the affected record's
     * own qualified id, the fail-closed shape `working_order.not_open` uses for its own state machine. An
     * absent/foreign id (RLS-hidden) surfaces `booking.not_found` before this. `bookingId` is a
     * caller-supplied uuid, not a secret. `booking.*` names the DOMAIN CONCEPT (`tenant.not_found`'s note
     * gives the rule). Mapped to 409 (the booking's state forbids the move). Never renamed once shipped.
     */
    "booking.invalid_transition": { bookingId: string };
    /**
     * `seatBooking` could not resolve a table to seat the party at — neither a `tableId` was passed nor
     * does the booking carry a `table_id` (design §3a step 2). No params: the seat request itself
     * identifies the booking (the route path carries its id), and the refusal names no row to echo — the
     * same no-row shape the `mirror.*` refusals use. `booking.*` names the DOMAIN CONCEPT, never the
     * throwing package (`tenant.not_found`'s note gives the rule). A CLIENT request-shape fault (mapped to
     * 400 in Task 5's route STATUS map): a table must be supplied, so the request is incomplete rather
     * than in a forbidden state. Never renamed once shipped.
     */
    "booking.table_required": Record<string, never>;
    /**
     * A tab verb found the working order it was asked to modify is not an OPEN tab — it is not `open`
     * (already settled/abandoned), no `dining_tables.tab_id` points at it (a walk-up or a counter
     * delivery — a tab is an OPEN order a table points at, design §2b), or it names none (absent, or
     * another tenant's, RLS-hidden). All the tab verbs share THIS one code for that state — the round/void
     * guard and the TS-3 move/join/merge family alike — the fail-closed shape `working_order.not_open`
     * uses for the held-order modify side. (A non-enumerating phrasing on purpose: the earlier
     * `addTabRound`/`voidTabLine` list went stale the moment the move/join/merge verbs began throwing it
     * too.) `tabId` — the caller-supplied uuid — is echoed and qualified to match the tab-verb
     * vocabulary. `tab.*`, not `server.*`, for the reason
     * `tenant.not_found`'s note gives. Mapped to 409 (the order's state forbids the tab edit).
     */
    "tab.not_open": { tabId: string };
    /**
     * A per-line void named no line on the OPEN tab — the `line_no` matches nothing on it (already
     * voided, or never existed). Pre-fiscal: nothing is filed for an open tab, so a void is a plain
     * delete with no fiscal record or amendment. `tabId` + `lineNo` are caller-supplied and echoed
     * (neither a secret). `tab.*`, not `server.*`, for the reason `tenant.not_found`'s note gives.
     * Mapped to 404 (the line named does not exist).
     */
    "tab.line_not_found": { tabId: string; lineNo: number };
    /**
     * A tab named as BOTH source and destination of a line-move — `mergeTabs(intoTabId === fromTabId)`,
     * or the shared `moveTabLines(fromTabId === toTabId)` primitive that `mergeTabs` and (later) TS-4
     * transfer call. Refused before any line move or lock: moving a tab's lines onto itself would move
     * them then abandon it (`mergeTabs`), or append duplicates the trailing delete then removes wholesale,
     * emptying the tab (`moveTabLines`). `tabId` is the caller-supplied uuid (not a secret). `tab.*` names
     * the DOMAIN CONCEPT (the running tab), never the throwing package (the rule `tenant.not_found`'s note
     * gives). A request-shape error — the two arguments are equal regardless of any tab's STATE — so it
     * is mapped to 400 (a bad request), distinct from the state-conflict `tab.not_open` (409).
     */
    "tab.merge_self": { tabId: string };
    /**
     * A transfer named the SAME tab as source and destination (`fromTabId === toTabId`). Refused
     * before any lock or line read — moving items from a tab to itself is a no-op the caller did not
     * mean, and letting it through would take the same tab's row `FOR UPDATE` twice. `tabId` is the
     * caller-supplied uuid (both ids are equal here), echoed because it is not a secret. A CLIENT
     * request-shape fault (400), distinct from the state conflict `tab.not_open` (409): the ids are
     * well-formed, they are just equal. `tab.*` names the DOMAIN CONCEPT, not the throwing package
     * (`tenant.not_found`'s note gives the rule); never renamed once shipped.
     */
    "tab.transfer_self": { tabId: string };
    /**
     * A transfer named a `quantity` outside `0 < quantity ≤ line.quantity` (design §3): zero, negative,
     * more than the line holds, or a malformed decimal literal. Refused before the split — a zero would
     * leave a zero-quantity remnant (violating `working_order_lines_quantity_ck`), an over-quantity would
     * invent stock, and a malformed value cannot be priced. `lineNo` and the offending `quantity` (the
     * caller's own text, not a secret) are echoed so a translator can name what was attempted. A CLIENT
     * request-shape fault (400), distinct from the state conflict `tab.not_open` (409). `tab.*` names the
     * DOMAIN CONCEPT (`tenant.not_found`'s note gives the rule); never renamed once shipped.
     */
    "tab.transfer_quantity_invalid": { tabId: string; lineNo: number; quantity: string };
    /**
     * A transfer batch named the SAME source `line_no` more than once (design §3). Refused BEFORE any
     * lock or write. A repeated line_no does not conserve quantity: every entry is validated against a
     * STATIC pre-batch snapshot of the line's quantity (never updated between entries) and the split
     * write sets the source to `original − q` rather than a cumulative decrement — so two partial "1"s
     * off a café×3 line both pass and the destination gains 1+1 while the source only drops to 2 (4
     * from 3). A whole-line + partial pair on one line is worse and contradictory ("move it all" AND
     * "move part"): the whole-line move DELETEs the source line and the split's UPDATE then matches
     * nothing while its INSERT still fabricates a destination line. Neither shape can be folded into a
     * cumulative decrement, so a duplicate line_no is simply refused. `lineNo` is the FIRST line_no that
     * repeats; `tabId` is the source tab. A CLIENT request-shape fault (400) — the batch is malformed
     * regardless of any tab's STATE — the same shape `tab.transfer_self`/`tab.transfer_quantity_invalid`
     * carry, distinct from the state conflict `tab.not_open` (409). `tab.*` names the DOMAIN CONCEPT
     * (`tenant.not_found`'s note gives the rule); never renamed once shipped.
     */
    "tab.transfer_duplicate_line": { tabId: string; lineNo: number };
    /**
     * A transfer would separate a modifier from its dish (ordering modifiers). Two shapes reach it,
     * both refused before any line is moved or split:
     *  - a transfer entry names a CHILD modifier line directly (its `line_no` carries a
     *    `parent_line_id`) — a modifier is part of its dish, so it moves only WITH the dish: naming the
     *    parent whole-line move cascades its children automatically, and naming the child on its own is
     *    refused here rather than orphaning it (the source child would reference a deleted parent →
     *    23503, an opaque 500; the destination child would land ungrouped);
     *  - a PARTIAL split (`quantity` < the line's quantity) names a PARENT dish that carries modifier
     *    children — there is no per-option quantity this slice, so splitting the dish would desync its
     *    modifiers' quantity from the dish; refused rather than filing an inconsistent draft.
     * The client is never the gate: the till's transfer picker offers whole dishes, but a crafted
     * request could name a child or split a modified dish, so the server refuses both here.
     *
     * `lineNo` is the offending source line (a child, or the parent asked to split); `tabId` the source
     * tab. Both caller-supplied and echoed (neither a secret). A CLIENT request-shape fault (400) — the
     * batch is malformed regardless of any tab's STATE — the same shape `tab.transfer_self`/
     * `tab.transfer_duplicate_line` carry, distinct from the state conflict `tab.not_open` (409). `tab.*`
     * names the DOMAIN CONCEPT (`tenant.not_found`'s note gives the rule); never renamed once shipped.
     */
    "tab.transfer_modifier_line": { tabId: string; lineNo: number };
    /**
     * No such service status for this tenant. `statusId` is a caller-supplied uuid the dashboard/till
     * already holds, not a secret — an id that matches nothing is unactionable if withheld (the rule
     * `tenant.not_found`'s note gives). `status.*` names the DOMAIN CONCEPT (a table's manual service
     * status), never the throwing package; destined for @waitron/tables if that package is extracted.
     * An absent id, or another tenant's status (RLS hides it), both report THIS one code. Mapped to 404.
     */
    "status.not_found": { statusId: string };
    /**
     * A service status exists but is deactivated (`active = false`), so a table may not be set to it —
     * `setTableStatus` refuses it. `statusId` is the caller-supplied uuid (not a secret). Distinct from
     * `status.not_found` (absent/foreign): this says the status is real but retired from service.
     * `status.*`, not `server.*`, for the reason `tenant.not_found`'s note gives. Mapped to 409 (the
     * status's state forbids the assignment).
     */
    "status.inactive": { statusId: string };
    /**
     * A service-status label already exists in this venue — the `(tenant_id, label)` unique
     * (`table_service_statuses_tenant_label_key`) rejected the insert/update. `label` is the
     * operator-supplied human name ("Bill requested"), not a secret, so echoing it is what makes the
     * error actionable. `status.*`, not `server.*`, for the reason `tenant.not_found`'s note gives.
     * Mapped to 409.
     */
    "status.label_taken": { label: string };
    /**
     * No such floor-plan zone (FP-1) for this tenant. `zoneId` is a caller-supplied uuid the
     * dashboard already holds, not a secret — an id that matches nothing is unactionable if
     * withheld (the rule `tenant.not_found`'s note gives). Qualified `zoneId` to match the
     * domain-record not_found family (`table.not_found`'s `tableId`, `status.not_found`'s
     * `statusId`). `zone.*` names the DOMAIN CONCEPT, never the throwing package
     * (`tenant.not_found`'s note). An absent id, or another tenant's zone (RLS hides it), both
     * report THIS one code — the same fail-closed shape `table.not_found`/`status.not_found` use.
     * Mapped to 404 by whichever route surface Task 3 wires the zone CRUD verbs into, matching
     * `table.not_found`/`status.not_found`. A DEACTIVATED-but-real zone is a different fact,
     * should Task 3 need one — `table.inactive`/`status.inactive`'s shape, not this code.
     */
    "zone.not_found": { zoneId: string };
    /**
     * A floor-plan zone (FP-1) name already exists in this venue — the
     * `(tenant_id, location_id, name)` unique (`floor_zones_name_key`, `floor-zones.ts`) rejects the
     * insert/update. `name` is the operator-supplied human label ("Comedor", "Terraza"), not a
     * secret, so echoing it is what makes the error actionable — the same shape `table.label_taken`'s
     * `label` and `status.label_taken`'s `label` use, renamed here to match the column
     * `floor_zones.name` actually carries. `zone.*`, not `server.*`, for the reason
     * `tenant.not_found`'s note gives. Mapped to 409 by whichever route surface Task 3 wires the
     * zone CRUD verbs into, matching `table.label_taken`/`status.label_taken`.
     */
    "zone.name_taken": { name: string };
    /**
     * A kitchen-station name already exists in this venue (KDS-1) — the `(tenant_id, location_id, name)`
     * unique (`kitchen_stations_name_key`) rejected the insert/update. `name` is the operator-supplied
     * human label ("Cocina", "Plancha", "Barra"), not a secret, so echoing it is what makes the error
     * actionable — the same shape `zone.name_taken`'s `name` and `table.label_taken`'s `label` use,
     * named `name` to match the column `kitchen_stations.name` actually carries. `station.*`, not
     * `server.*`, for the reason `tenant.not_found`'s note above gives (the prefix names the DOMAIN
     * CONCEPT — a kitchen station — never the throwing package). Mapped to 409 by the route surface
     * Task 7 wires the station config verbs into, matching `zone.name_taken`. Never renamed once shipped.
     */
    "station.name_taken": { name: string };
    /**
     * No such kitchen station for this tenant + venue (KDS-1), OR one that is DEACTIVATED. `createStation`
     * maps only a NAME collision (above); the by-id verbs — `updateStation`, `deactivateStation`,
     * `setDefaultStation`, and the routing verbs `setCategoryStation`/`setProductStation` — throw THIS when
     * the station id names none this venue may reach (absent, another tenant's that RLS hides, or another
     * VENUE's of the same tenant — the config verbs are `cfg.locationId`-scoped) or names a real but
     * `active = false` row. All of those fold into the one code, the same fail-closed shape
     * `zone.not_found`/`status.not_found`/`table.not_found` use — to a caller picking a routing/default
     * target, "gone", "foreign" and "retired" are the same fact ("there is no live station here to use").
     * The inactive case is deliberately folded in (not a distinct `station.inactive`): the spec enumerates
     * only name_taken/not_found/no_default for KDS-1, and a routing target that cannot be used reads the
     * same whether it is absent or retired — unlike `table.inactive`/`status.inactive`, which exist because
     * a deactivated row is still addressable by the CRUD editor there.
     *
     * `stationId` is echoed because it is a caller-supplied uuid the dashboard/till already holds, not a
     * secret — an id that matches nothing is unactionable if withheld (the rule `tenant.not_found`'s note
     * gives). Qualified `stationId` to match the domain-record not_found family (`table.not_found`'s
     * `tableId`, `zone.not_found`'s `zoneId`, `status.not_found`'s `statusId`). `station.*`, not `server.*`,
     * for the reason `tenant.not_found`'s note gives. Mapped to 404. Never renamed once shipped.
     */
    "station.not_found": { stationId: string };
    /**
     * A line was fired to the kitchen but its venue has NO default kitchen station (KDS-1, §2b). Station
     * resolution is `product.station_id ?? category.station_id ?? the location's default station`; when a
     * line resolves neither a product- nor category-level route AND the location has no `is_default`
     * station, there is nowhere to send the food. This is a MISCONFIGURATION the venue must fix, so firing
     * FAILS LOUD with this code rather than silently dropping the line from the kitchen (§2b: "fail loud,
     * do not silently drop food"). Declared here in Task 2 with the other `station.*` codes; the sole
     * thrower is Task 3's fire-time resolver (`fireLines`) — no verb in this task throws it yet.
     *
     * `locationId` names the misconfigured venue and is echoed because it is the venue's OWN id, already in
     * the till's config, not a secret — naming which location has no default is exactly what makes the
     * error actionable. `station.*` names the DOMAIN CONCEPT (a kitchen station, or here its absence),
     * never the throwing package (`tenant.not_found`'s note gives the rule). A configuration conflict that
     * blocks firing → mapped to 409 by the fire route's surface in Task 7. Never renamed once shipped.
     */
    "station.no_default": { locationId: string };
    /**
     * A per-line kitchen ticket-item bump is not legal given the item's current state (KDS-1 §3c) — the
     * `ticket_items` successor to `order_prep.invalid_transition` (which stays declared but loses its
     * throw sites with the KDS-1 rework, spec §6). Task 4's `advanceTicketItem` is the thrower: each bump
     * is a single conditional UPDATE `set state = to where id = … and state = <the one legal predecessor>`,
     * so the legality of the move IS the write — a skip, a repeat, a jump backwards, or an absent/foreign
     * item (RLS hides another tenant's) all match no row, and the empty `returning` throws THIS. `to =
     * 'queued'` is refused too: no state legally advances INTO queued (only firing reaches it). The same
     * fail-closed conditional-UPDATE shape `working_order.not_open`/the prep family use for their own state
     * machines.
     *
     * A fact about the ticket ITEM's state, not the process → mapped to 409 (the id may be valid, but the
     * item's state forbids the move). `ticketItemId` names the affected item's OWN id — a ticket item
     * advances per LINE, so the id that failed is the line's ticket item, not the order (unlike the
     * order-level `order_prep.invalid_transition`, which named the `workingOrderId` of a one-row-per-order
     * model). It is a caller-supplied uuid the display already holds, not a secret, so echoing it is what
     * makes the error actionable (the rule `tenant.not_found`'s note gives). `ticket.*` names the DOMAIN
     * CONCEPT (a kitchen ticket item), never the throwing package (that same note); destined for a
     * @waitron/kitchen package if one is ever extracted. Never renamed once shipped.
     */
    "ticket.invalid_transition": { ticketItemId: string };
    /**
     * A line was fired to the kitchen that ALREADY has a ticket item (KDS-1) — a re-fire. Every fire
     * point funnels through `fireLines` (`working-order.ts`), which inserts one `ticket_items` row per
     * line; a second fire of a line already sent collides on `ticket_items`' per-line
     * `(tenant_id, working_order_line_id)` unique (23505). `fireLines` catches that violation
     * (`isUniqueViolation`) and throws THIS instead of letting the raw constraint error surface as an
     * opaque `server.internal` 500. The reachable path is a double `sendToPrep` (Mode-P's pickup fires a
     * settled order's lines; sending the same order twice re-fires them); `placeOrder` can't re-fire (its
     * open→placed guard blocks a second call) and `addTabRound` fires only its freshly-inserted lines, so
     * neither reaches this in practice — but the catch lives at the shared `fireLines` choke point so ALL
     * fire paths are covered by construction.
     *
     * Deliberately NOT `ticket.invalid_transition`: that code is `advanceTicketItem`'s per-ITEM state-bump
     * refusal and carries the failed item's own `ticketItemId`, which a re-fire has no clean handle on (the
     * INSERT of N items fails atomically; the colliding row is a PRE-EXISTING item this catch never reads).
     * Broadening it would stretch a shipped code's documented meaning and force a wrong/looked-up param, the
     * §1 defect class — so a re-fire gets its own code. Nor is it the RETIRED `order_prep.invalid_transition`,
     * whose double-send throw site the KDS-1 rework removes (spec §6). `workingOrderId` names the order whose
     * fire was refused — the caller-supplied uuid `sendToPrep`'s route already holds, not a secret, so echoing
     * it is what makes the error actionable (the rule `tenant.not_found`'s note gives); an order-scoped param
     * on a `ticket.*` code exactly as `tab.already_open` carries a `tableId`. A state conflict (the order's
     * lines are already in the kitchen) → mapped to 409 by the fire route's surface (Task 7), the same 409
     * family `working_order.not_settled`/`tab.already_open` sit in. `ticket.*` names the DOMAIN CONCEPT (a
     * kitchen ticket item), never the throwing package (`tenant.not_found`'s note). Never renamed once shipped.
     */
    "ticket.already_fired": { workingOrderId: string };
    /**
     * A working order this caller tried to hand to the customer (`markCollected`, the Mode-P counter
     * handover — KDS-1 §3e) was NEVER fired to the kitchen: it has no `ticket_items`, so there is nothing
     * on any station display to hand over. A settled Mode-P order that has not yet been sent to prep is a
     * reachable state, and stamping `collected_at` on it would be worse than a no-op — a LATER `sendToPrep`
     * would fire lines that `listStationQueue`'s `collected_at IS NULL` filter immediately hides (food
     * silently dropped from the display). So `markCollected` refuses it rather than stamping. The inverse
     * of `ticket.already_fired` (which refuses a DOUBLE fire); `ticket.*` names the DOMAIN CONCEPT (the
     * kitchen ticket), never the throwing package (`tenant.not_found`'s note). `workingOrderId` names the
     * order whose handover was refused — a caller-supplied uuid the display already holds, not a secret,
     * and order-scoped on a `ticket.*` code exactly as `ticket.already_fired` carries a `workingOrderId`.
     * Mapped to 409 (the id is valid, but the order's kitchen state forbids the handover) — the same 409
     * family `ticket.already_fired`/`working_order.not_settled` sit in. Never renamed once shipped.
     */
    "ticket.not_fired": { workingOrderId: string };
    /**
     * A per-line ticket-item bump was refused because the line is still HELD (KDS-2 hold-and-fire) — its
     * course has not been fired to the kitchen yet (`ticket_items.fired_at IS NULL`, greyed on the station
     * display). A later KDS-2 task's `advanceTicketItem` adds a `fired_at IS NOT NULL` gate to its
     * conditional bump UPDATE: a held item is on no station's active queue, so there is nothing to advance,
     * and the bump throws THIS rather than silently matching no row (the same fail-loud shape the coursing
     * model uses — held food is displayed, not dropped). Distinct from `ticket.invalid_transition`, which
     * refuses an ILLEGAL move (a skip, a repeat, a jump backwards) on a line that HAS been fired: item_held
     * is the orthogonal fact that the line is not yet in the kitchen at all. Firing the line's course
     * (stamping `fired_at`) is the caller's remedy; only then does the bump become legal.
     *
     * A fact about the ticket ITEM's kitchen state, not the process → mapped to 409 by the till route's
     * surface in a later task (the same 409 the state-conflict `ticket.*` codes sit in); the id may be
     * valid, but the item's held state forbids the move. `ticketItemId` names the affected item's OWN id —
     * a ticket item is held/advanced per LINE, so the id that failed is the line's ticket item, not the
     * order — mirroring `ticket.invalid_transition`'s `ticketItemId` exactly. A caller-supplied uuid the
     * display already holds, not a secret, so echoing it is what makes the error actionable (the rule
     * `tenant.not_found`'s note gives). `ticket.*` names the DOMAIN CONCEPT (a kitchen ticket item), never
     * the throwing package (that same note). Never renamed once shipped.
     */
    "ticket.item_held": { ticketItemId: string };
    /**
     * A kitchen-course name already exists in this venue (KDS-2) — the `(tenant_id, location_id, name)`
     * unique (`kitchen_courses_name_key`) rejected the insert/update. `name` is the operator-supplied
     * human label ("Entrantes", "Principales", "Postres"), not a secret, so echoing it is what makes the
     * error actionable — the same shape `station.name_taken`'s `name` and `zone.name_taken`'s `name` use,
     * named `name` to match the column `kitchen_courses.name` actually carries. `course.*`, not `server.*`,
     * for the reason `tenant.not_found`'s note gives (the prefix names the DOMAIN CONCEPT — a kitchen
     * course — never the throwing package). Mapped to 409 by the management route surface a later KDS-2
     * task wires the course config verbs into, matching `station.name_taken`. Never renamed once shipped.
     */
    "course.name_taken": { name: string };
    /**
     * No such kitchen course for this tenant + venue (KDS-2), OR one that is DEACTIVATED. The by-id course
     * config verbs (update/deactivate, and the routing verb that sets a product's default course) throw
     * THIS when the course id names none this venue may reach (absent, another tenant's that RLS hides, or
     * another VENUE's of the same tenant — the config verbs are location-scoped) or names a real but
     * `active = false` row. All of those fold into the one code, the same fail-closed shape
     * `station.not_found`/`zone.not_found` use — to a caller picking a course, "gone", "foreign" and
     * "retired" are the same fact (there is no live course here to use). The inactive case is deliberately
     * folded in (not a distinct `course.inactive`), exactly as `station.not_found` folds its own.
     *
     * `courseId` is echoed because it is a caller-supplied uuid the dashboard/till already holds, not a
     * secret — an id that matches nothing is unactionable if withheld (the rule `tenant.not_found`'s note
     * gives). Qualified `courseId` to match the domain-record not_found family (`station.not_found`'s
     * `stationId`, `zone.not_found`'s `zoneId`). `course.*`, not `server.*`, for the reason
     * `tenant.not_found`'s note gives. Mapped to 404. Never renamed once shipped.
     */
    "course.not_found": { courseId: string };
    /**
     * A table-placement field failed validation (FP-2 spatial floor plan) — `setTablePlacement`'s
     * per-field guards: a `posX`/`posY` outside `0..1000`, a `rotation` outside `0..359`, or a
     * `shape` naming no `floor_table_shape` enum member. A missing/inactive table or zone is NOT this
     * code — those are checked first and surface `table.not_found`/`zone.not_found`.
     *
     * `field` carries the offending field NAME only — `"posX"`/`"posY"`/`"shape"`/`"rotation"` — and
     * NEVER the value behind it. An out-of-range coordinate is not itself a secret, but this file's
     * no-leak discipline is uniform (echo names, never values — `management.request_invalid`,
     * `server.till_config_missing`) precisely so no field becomes the exception where a value leaks
     * (CLAUDE.md §1).
     *
     * `placement.*` names the DOMAIN CONCEPT (a table's spatial placement), never the throwing
     * package (the rule `tenant.not_found`'s note gives); venue layout only, nowhere near the fiscal
     * huella. A request-shape fault → HTTP 400: it is listed explicitly as 400 in BOTH route `STATUS`
     * maps (`till-api.ts`, `management-api.ts`), beside `management.request_invalid`, per house style —
     * though 400 is also the DEFAULT a registered code takes when absent from a map (`till-api.ts`'s
     * `STATUS` note), so the mapping would hold either way. Never renamed once shipped.
     */
    "placement.invalid": { field: string };
    /**
     * A request to a gated server API surface carried a body/query whose SHAPE is wrong: a field
     * absent (where it is required) or present with the wrong declared type — a malformed date, a
     * non-string, a bad enum member. Originally the management-dashboard surface (the gated staff
     * routes in `management-api.ts` — create, patch, reset-pin, set-password), it is now the generic
     * request-shape code for EVERY gated API surface: `catalogue-api.ts`, `workforce-api.ts` and — via
     * the shared screens in `request-screens.ts` (`requirePeriod`/`requireBodyUuid`/… , extracted so no
     * two surfaces validate "subtly differently") — the till-session-gated staff schedule routes in
     * `schedule-api.ts`. The `management.*` prefix names the request-shape DOMAIN CONCEPT the code was
     * first minted for, kept because codes are never renamed once shipped; a malformed PATH `:id` is a
     * separate concern carried by `shared.invalid_id` (the branded-id family). The routes divide by
     * whether the field is required:
     *  - create (`displayName`/`role`/`pin`), reset-pin (`pin`), set-password (`password`) screen
     *    REQUIRED fields — absent OR non-string → 400.
     *  - patch (`role`/`status`) screens OPTIONAL fields — an ABSENT field is a legitimate no-op
     *    (the route answers 204), and only a field PRESENT with a non-string value is refused (400).
     * Refused with HTTP 400 before any DB work — the request-shape counterpart of the credential
     * codes those same routes surface (`pin.too_short`, `password.too_short`), which fire only once a
     * well-formed value reaches the identity layer. This screen is typeof-only: a well-formed STRING
     * that is out of range (a `role` naming no enum member, a `status` other than
     * "active"/"suspended") is NOT caught here — it flows on to the identity layer (`role` → the
     * `person_role` pgEnum, `status` → a silent no-op), a deliberately separate concern.
     *
     * `management.*` names the DOMAIN CONCEPT — a request to the management surface — not the package
     * that throws it. `server.*` is reserved for facts about the PROCESS itself (its config, its
     * listener, its shutdown); a malformed request body is a fact about the REQUEST, the rule
     * `tenant.not_found`'s note above gives. It is a DELIBERATELY DISTINCT namespace from
     * `@waitron/identity`'s `management_session.*`, which names the session LIFECYCLE
     * (`required`/`expired`); this names the request SHAPE, a separate concern, so the two do not share
     * a prefix even though both belong to the management dashboard.
     *
     * `field` carries a field NAME only — `"displayName|role|pin"` (create), `"pin"` (reset-pin),
     * `"password"` (set-password), or `"role"`/`"status"` (patch) — and NEVER the value behind it. A
     * PIN or a password is exactly the kind of secret a caller can mis-send, and it must not land in
     * an error's params: the same no-leak discipline `server.till_config_missing` and
     * `credentials.invalid_field` follow by echoing names, never values.
     */
    "management.request_invalid": { field: string };
    /**
     * A request to a device-authenticated route (a KDS station display, device-identity-1 §3c) carried
     * no usable device identity — the `waitron_device` cookie was absent, malformed (no `.` separator,
     * or a non-uuid selector), named no device, carried a token that did not `verifySecret` against the
     * row's `token_hash`, or named a device that has been REVOKED (`active = false`, instant revocation).
     * All of those fold into THIS one code: to the presenter "no such device", "wrong token" and
     * "revoked" are the same fact ("this cookie does not authenticate here"), and a distinct code for any
     * of them would confirm a device's existence or revocation state to whoever asked — the same
     * fail-closed reasoning `node.not_found` and `payment.webhook_signature_invalid` use. NO params: the
     * cookie's selector and token are a bearer secret and must never land in an error's params (the
     * no-leak discipline `session.required` and `payment.webhook_signature_invalid` follow), and there
     * is nothing non-secret left to carry.
     *
     * `device.*` names the DOMAIN CONCEPT (an enrolled device), never the throwing package
     * (`tenant.not_found`'s note above gives the rule); `server.*` is reserved for facts about the
     * process itself, and a failed device authentication is a fact about the request. Mapped to HTTP 401
     * by `device-api.ts`'s local STATUS map (Task 5), not here — this file only DECLARES the code, the
     * route layer owns the status, the same split every other code in this file follows. Never renamed
     * once shipped.
     */
    "device.unauthorized": Record<string, never>;
    /**
     * A device tried to advance a kitchen ticket item that belongs to a DIFFERENT station than the one
     * it is bound to (device-identity-1 §3d — least privilege: a device reads and bumps only its OWN
     * station). `device-api.ts`'s advance route fetches the item's `station_id` and asserts it equals the
     * requesting device's own `stationId` BEFORE calling `advanceTicketItem`; a mismatch throws THIS.
     * `stationId` names the ITEM's station — the station the device is not bound to and may not touch —
     * echoed because a station id is a within-tenant uuid this codebase treats as non-secret
     * (`station.not_found` echoes its own `stationId` the same way), and naming which station the item is
     * on is what makes the refusal actionable. Qualified `stationId` to match the domain-record family
     * (`station.not_found`'s `stationId`).
     *
     * `device.*` names the DOMAIN CONCEPT (an enrolled device), never the throwing package
     * (`tenant.not_found`'s note gives the rule). Mapped to HTTP 403 by `device-api.ts`'s local STATUS
     * map (Task 5), not here. Never renamed once shipped.
     */
    "device.forbidden_station": { stationId: string };
    /**
     * A handheld device tried a fiscal/cash action it may not perform. A handheld takes and fires orders,
     * and — since the owner reversal (2026-08-30, widened same day) — may SETTLE a sale on `POST /api/sales`
     * for cash OR a manual card tender, because the fiscal chain is keyed by the submitting NODE (`nodeId`),
     * not the till (record-sale.ts:79-82), so a handheld sale files under its node's SIF exactly like the
     * fixed till's (the manual card is the datáfono leg — a separate bank terminal the POS never talks to,
     * no reader). What a handheld may NOT do still throws THIS: the INTEGRATED card reader (`/api/pay`,
     * `pay`), reprint, drawer open, place, collect, cancel — every fiscal/cash route settled at the fixed
     * till other than the node-keyed sale. `assertNotHandheld` (`device-session.ts`) enforces this ON THE
     * SERVER, so the boundary holds even if the client were bypassed; it guards an UNRECOVERABLE fiscal
     * record (CLAUDE.md §5 — `registros_facturacion` is append-only and hash-chained). `action` names the
     * refused operation (e.g. `pay`, `reprint`) — a within-app symbol the caller passes, not a
     * secret, echoed so the refusal is actionable, the same non-secret-param shape
     * `device.forbidden_station` uses for its `stationId`.
     *
     * `device.*` names the DOMAIN CONCEPT (an enrolled device), never the throwing package
     * (`tenant.not_found`'s note gives the rule). Mapped to HTTP 403 by `till-api.ts`'s local STATUS map,
     * not here — the route layer owns the status, the split every other code in this file follows.
     * Distinct from `device.forbidden_station` (a device touching another station's item, KDS least
     * privilege): this is the fiscal boundary — a handheld is fenced on the integrated reader
     * (`/api/pay`), reprint, drawer, place, collect and cancel but may settle a cash or manual-card sale.
     * Never renamed once shipped.
     */
    "device.forbidden_action": { action: string };
    /**
     * A device enrolment (`POST /api/device/enrol`, device-identity-1 §3b) presented a pairing code that
     * redeemed nothing — the locking `DELETE FROM device_pairing_codes WHERE code_sha256 = sha256(code)
     * RETURNING` (the single-use `consumeChallenge` shape) matched no row: the code never existed, was
     * mistyped, or was ALREADY consumed (each code is single-use, and a concurrent redeem the row-lock
     * serialised loses here too). All fold into THIS one code. NO params: a pairing code is a bearer
     * SECRET a caller can mis-send, and it must never land in an error's params — the same no-leak
     * discipline `management.request_invalid` follows for a PIN and `session.required` for the session
     * cookie; there is nothing non-secret to carry.
     *
     * `device.*` names the DOMAIN CONCEPT (device enrolment), never the throwing package
     * (`tenant.not_found`'s note gives the rule). Mapped to HTTP 400 by `device-api.ts`'s local STATUS
     * map (Task 5), not here. Distinct from `device.pairing_expired`, where a row WAS found but has
     * lapsed. Never renamed once shipped.
     */
    "device.pairing_invalid": Record<string, never>;
    /**
     * A device enrolment presented a pairing code that redeemed a row, but the row is older than
     * `PAIRING_TTL_MS` (device-identity-1 §3b step 2 — the deleted row is rolled back with the tx so it
     * lapses by TTL rather than being burned, the WebAuthn `consumeChallenge` semantic). NO params, for
     * the same reason as `device.pairing_invalid`: the code is a bearer secret and is never echoed, and
     * there is nothing non-secret to carry. Distinct from `device.pairing_invalid` (which matched no row
     * at all): this says the code was real but has expired, so the remedy is to generate a fresh one.
     *
     * `device.*` names the DOMAIN CONCEPT (device enrolment), never the throwing package. Mapped to HTTP
     * 400 by `device-api.ts`'s local STATUS map (Task 5), not here. Never renamed once shipped.
     */
    "device.pairing_expired": Record<string, never>;
    /**
     * No such device for this tenant — the device management surface (`POST /management-api/devices/:id/
     * revoke` and the list, device-identity-1 §3e) named a device id that matches nothing: absent, or
     * another tenant's that RLS hides (both report THIS one code, the fail-closed shape
     * `node.not_found`/`station.not_found` use). Deliberately DISTINCT from `device.unauthorized`: this
     * is the MANAGER-facing surface (an authenticated `device.manage` holder acting on a device by id),
     * where echoing the id is safe and actionable — a mistyped uuid identifies nothing on its own;
     * `device.unauthorized` is the DEVICE-auth guard, which folds "unknown id" in and carries NO params
     * precisely so it cannot confirm a device's existence to an unauthenticated caller. `deviceId` is the
     * caller-supplied uuid the dashboard already holds, not a secret; qualified `deviceId` to match the
     * domain-record not_found family (`station.not_found`'s `stationId`).
     *
     * `device.*` names the DOMAIN CONCEPT (an enrolled device), never the throwing package
     * (`tenant.not_found`'s note gives the rule). Mapped to HTTP 404 by `device-api.ts`'s local STATUS
     * map (Task 5), not here. Never renamed once shipped.
     */
    "device.not_found": { deviceId: string };
    /**
     * Too many device-enrolment attempts reached `POST /api/device/enrol` in one fixed window — the
     * per-process, GLOBAL, in-memory rate limit (`enrol-rate-limit.ts`, device-identity-1 §8 open item)
     * refused this attempt at the TOP of the handler, BEFORE the body is parsed and BEFORE the
     * pairing-code DELETE runs. Defense-in-depth over the primary controls (the code is ~40-bit,
     * single-use, 15-min TTL, so brute-force over HTTP is already infeasible) PLUS DoS / connection-pool
     * protection: rejecting before any DB work is what keeps an enrol flood from exhausting the pool and
     * starving the sale path (the fiscal invariant "nothing may block a sale", CLAUDE.md §5). The limit is
     * GLOBAL rather than per-IP because the on-prem server sits behind the snitun tunnel / a reverse
     * proxy, so every client presents one address and a per-IP key would buy nothing.
     *
     * NO params: this is a blanket throttle, not a fact about the caller's code, and there is nothing
     * non-secret to carry (the pairing code is a bearer secret and is never echoed — the same no-leak
     * discipline `device.pairing_invalid`/`device.pairing_expired` follow). `device.pairing_*` names the
     * DOMAIN CONCEPT (device enrolment/redemption), never the throwing package (`tenant.not_found`'s note
     * gives the rule), and sits in the pairing-redemption family. Mapped to HTTP 429 by `device-api.ts`'s
     * local STATUS map (the FIRST 429 in `apps/server`), not here. Never renamed once shipped.
     */
    "device.pairing_rate_limited": Record<string, never>;
    /**
     * A pairing code could not be minted because its SHA-256 digest collided with an outstanding code's
     * — the `device_pairing_codes_lookup_idx` UNIQUE index on (tenant_id, code_sha256) rejected the
     * INSERT with 23505. That index (added for single-use safety, 385b6248, so the redeeming
     * `DELETE … RETURNING` can never consume a duplicate) makes a duplicate digest FAIL the mint rather
     * than silently minting a consumable duplicate. The pairing code is ~40-bit Crockford entropy, so a
     * fresh random code whose digest collides with an outstanding one is astronomically rare (~2^-40 per
     * mint × outstanding codes) — but real, and `generatePairingCode` maps it to THIS code rather than
     * letting the raw constraint error surface as an opaque `server.internal` 500. TRANSIENT: the remedy
     * is simply to retry the mint, which draws a fresh code.
     *
     * NO params: there is nothing non-secret to carry (the code itself is a bearer secret, never echoed —
     * the same no-leak discipline `device.pairing_invalid`/`device.pairing_expired`/
     * `device.pairing_rate_limited` follow), and a blanket "retry" needs none. Distinct from
     * `device.pairing_rate_limited` (a throttle refusing the enrol side before any DB work) and from the
     * redemption faults `device.pairing_invalid`/`device.pairing_expired` (the REDEEM side): this is the
     * GENERATE side failing to find a free code. `device.pairing_*` names the DOMAIN CONCEPT (device
     * pairing), never the throwing package (`tenant.not_found`'s note gives the rule), and sits in the
     * pairing family. Mapped to HTTP 409 by `device-api.ts`'s local STATUS map (a conflict on the digest,
     * the same 409 the `isUniqueViolation`-mapped `station.name_taken`/`table.label_taken` take), not
     * here. Never renamed once shipped.
     */
    "device.pairing_code_unavailable": Record<string, never>;
    /**
     * A pairing code for a STATION-BINDING kind (`kds_station`, {@link kindRequiresStation}) was minted
     * with NO station — `generatePairingCode`'s `stationId` was `null` for a kind that requires one. This
     * is a VALIDATION failure on the mint, not a lookup miss: nothing was looked up, so there is no
     * caller-supplied station id to echo. Distinct from `station.not_found`, which `requireLiveStation`
     * raises when a station WAS supplied but is unknown/foreign/retired (that path still throws
     * `station.not_found`, echoing the supplied uuid); the null case was previously folded into
     * `station.not_found` with an empty `stationId: ""`, which violated that code's contract (it echoes a
     * caller-supplied station uuid) — hence its own code here.
     *
     * NO params: there is no station id (it was null), and a "name a station" validation carries nothing
     * else non-secret. `device.*` names the DOMAIN CONCEPT (device pairing), never the throwing package
     * (`tenant.not_found`'s note gives the rule). Mapped to HTTP 400 by `device-api.ts`'s local STATUS map
     * (a request that named no station), not here — the route layer owns the status. Never renamed once
     * shipped.
     */
    "device.station_required": Record<string, never>;
    /**
     * A self-signed server certificate was asked for with no hostname to put on the leaf — the
     * `hostnames` list was empty. The box mints its own CA + server cert on first boot to serve
     * setup-mode HTTPS (onboarding slice 2a), and a leaf with no `dNSName` SAN authenticates no
     * request (a TLS client matches the name it dialled against the cert's SANs), so the minter
     * refuses it BEFORE generating any keypair rather than emitting a cert that can never complete a
     * handshake. NO params: an empty list carries nothing non-secret worth echoing, and the fix is
     * simply to supply at least one hostname — the same no-param shape `sale.empty_basket` uses for
     * its own "you gave me nothing to work with" guard.
     *
     * `setup.*` names the DOMAIN CONCEPT (the box's first-boot setup mode, the same concept the
     * `setup.mode_active` log event and `setup-api.ts` name), never the throwing file
     * (`tenant.not_found`'s note above gives the rule); `server.*` is reserved for facts about the
     * process itself, and "no hostname to certify" is a fact about the setup input, not the process.
     * Never renamed once shipped.
     */
    "setup.cert_hostnames_empty": Record<string, never>;
    /**
     * A setup-mode provision was asked to run on a box that ALREADY holds this tenant — a second
     * `provisionVenue` for the same obligado (country + NIF, which derives a deterministic tenant id).
     * `applyVenue`'s location/till/node/SIF carry no business key, so a re-run would ADD a shop and
     * mint a FRESH SIF/hash chain rather than resume the existing venue (venue-apply.ts's own header),
     * and a stray fiscal chain is unrecoverable (CLAUDE.md §5). So `provisionVenue` refuses here,
     * BEFORE stamping or minting anything — the double-POST guard the boot-mode flip only protects
     * across a restart, not within one setup session.
     *
     * `tenantId` is the DERIVED obligado id (a deterministic uuid, not a secret) and is echoed because
     * it is what makes the refusal actionable — it names exactly which tenant the box is already bound
     * to; the same non-leaking, id-echoing discipline `tenant.not_found` follows.
     *
     * `setup.*` names the DOMAIN CONCEPT (the box's first-boot setup/onboarding, the same concept
     * `setup.cert_hostnames_empty` and `setup-api.ts` name), never the throwing file — `server.*` is
     * reserved for facts about the process itself, and "this box is already provisioned" is a fact
     * about the setup, not the process (the rule `tenant.not_found`'s note above gives). Never renamed
     * once shipped.
     */
    "setup.already_provisioned": { tenantId: string };
    /**
     * A setup-mode provisioning request carried a field whose VALUE is not usable — currently the
     * AEAT certificate seal (onboarding slice 2b): a `certKind` that is neither `"sello"` nor
     * `"representante"`, or a `pfxBase64` that is empty or not valid base64. Refused BEFORE the seal
     * runs, so `putCredential`'s own `validatePayload` never sees the payload and no row is written.
     *
     * `field` carries the offending field NAME only — `"certKind"` or `"pfxBase64"` — and NEVER the
     * value behind it: a PFX blob and its passphrase are exactly the kind of secret a caller can
     * mis-send, and echoing the value would land it straight in an error's params. The same no-leak,
     * echo-the-name discipline `management.request_invalid` and `placement.invalid` follow for their
     * own request-shape faults.
     *
     * `setup.*` names the DOMAIN CONCEPT (the box's first-boot setup/onboarding, the same concept
     * `setup.cert_hostnames_empty` and `setup.already_provisioned` name), never the throwing file;
     * `server.*` is reserved for facts about the process itself, and a malformed setup request is a
     * fact about the REQUEST, the rule `tenant.not_found`'s note above gives. A request-shape fault
     * → HTTP 400 by whichever route surface 2b wires the setup POST endpoints into, matching
     * `management.request_invalid`. Never renamed once shipped.
     */
    "setup.request_invalid": { field: string };
    /**
     * A LIVE provision of an `ES-common` venue arrived with no AEAT certificate (onboarding slice 2b,
     * spec §10). A production ES-common till files its registros to the real AEAT and cannot do so
     * without a sealed `fiscal.aeat` credential, so the provision is refused BEFORE `provisionVenue`
     * runs — nothing is stamped and no SIF/chain is minted (an unrecoverable write, CLAUDE.md §5). A
     * DEMO provision (preproduction) is exempt: it records its chain locally and never submits, so the
     * cert is optional there.
     *
     * NO params: the fix is simply to supply the certificate, and there is nothing non-secret to
     * carry — the same no-param shape `setup.cert_hostnames_empty` uses for its own "you gave me
     * nothing to certify" guard. Never echoes the PFX or passphrase (they are not even present here).
     *
     * `setup.*` names the DOMAIN CONCEPT (the box's first-boot setup/onboarding, the same concept
     * `setup.request_invalid` and `setup-api.ts` name), never the throwing file; `server.*` is
     * reserved for facts about the process itself, and "this venue needs a cert to go live" is a fact
     * about the setup request, the rule `tenant.not_found`'s note above gives. A request-shape fault
     * → HTTP 400 by `setup-api.ts`'s provision route, matching `setup.request_invalid`. Never renamed
     * once shipped.
     */
    "setup.aeat_cert_required": Record<string, never>;
    /**
     * A first-boot setup POST arrived while another is still in flight (onboarding slice 2b). One
     * one-shot latch is SHARED across the provision and adopt (C2b Task 9) routes — a box is set up
     * EITHER as a primary (provision) OR as a mirror (adopt), never both — and each route sets it
     * SYNCHRONOUSLY before its first `await`, so two near-simultaneous starts of EITHER action cannot
     * both pass it (provision-in-flight blocks adopt and vice-versa) — the loser gets THIS. The latch
     * is the fiscal footgun guard's inner ring: `applyVenue` mints a fresh SIF/hash chain on every run
     * (venue-apply.ts's own header) and the `provisionVenue` tenant-exists check is NOT atomic with
     * `applyVenue`, so two concurrent first-boot actions on the same box could each pass that check and
     * mint a second chain. The single setup process + this latch prevent the concurrent case; the
     * tenant-exists check backstops the sequential re-POST.
     *
     * NO params: there is nothing non-secret to carry beyond the code, and the fix is simply to wait
     * for the in-flight action to finish (on success the box restarts out of setup mode; on failure
     * the latch resets and a corrected retry is accepted).
     *
     * `setup.*` names the DOMAIN CONCEPT (the box's first-boot setup/onboarding), never the throwing
     * file; `server.*` is reserved for facts about the process itself, and "a first-boot action is
     * already running" is a fact about the setup, the rule `tenant.not_found`'s note above gives. A
     * state conflict → HTTP 409 by `setup-api.ts`'s provision and adopt routes (the same 409
     * `setup.already_provisioned` takes). Never renamed once shipped.
     */
    "setup.already_provisioning": Record<string, never>;
    /**
     * A first-boot setup POST arrived before the box wired the dependencies that action needs
     * (onboarding slice 2b). BOTH first-boot routes have a synchronous deps gate that returns THIS,
     * and `mountSetup` makes those deps OPTIONAL so the slice-1b setup surface still mounts without
     * them: the provision route needs the `provisionVenue` binding, the trading-config persister, the
     * restart trigger and the composed DB URLs; the adopt route (the mirror-side sibling, C2b Task 9)
     * needs the `adopt` binding and the restart trigger. A POST to either route when its deps are
     * absent is answered with THIS rather than an opaque `server.internal` 500 — the box is up but not
     * ready to run that action.
     *
     * NO params: naming which dep is missing would leak nothing useful to a wizard that cannot wire it
     * anyway, and the fix is an operator/boot concern, not a request one — the same no-param shape the
     * other "nothing to work with" setup guards use.
     *
     * `setup.*` names the DOMAIN CONCEPT (the box's first-boot setup/onboarding), never the throwing
     * file. A service-not-ready fault → HTTP 503 by `setup-api.ts`'s provision and adopt routes
     * (deliberately not a 4xx: the request is well-formed; the box simply cannot serve it yet). Never
     * renamed once shipped.
     */
    "setup.not_ready": Record<string, never>;
    /**
     * A session-gated open-drawer request (`POST /api/drawer/open`, counter receipt/drawer printing
     * design §5/§6) has no printer to kick the drawer through: `tills.receipt_printer_id` is unset for
     * the requesting till. There is no ESC/POS device to send the kick command to, so the request is
     * refused before any outbox enqueue — the same "nothing to work with" shape `sale.empty_basket`
     * and the `setup.*` no-param guards use, except this one DOES have something non-secret to name.
     *
     * `tillId` names the MISCONFIGURED till, not a printer id — there is no printer id to echo, only
     * the till that lacks one. Mirrors `station.no_default`'s `locationId`, which names the venue that
     * lacks a default station rather than any station id, for exactly the same "the failure is an
     * absence, so name the entity missing the resource" reason. `tillId` is the till's own id, already
     * in its config (`till-config.ts`'s `TillConfig.tillId`), not a secret — the same non-leak
     * discipline every id-echoing code in this file follows (`tenant.not_found`'s note).
     *
     * `drawer.*` names the DOMAIN CONCEPT — the physical cash drawer, kicked through a receipt
     * printer — never the throwing package (`tenant.not_found`'s note above gives the rule). Not
     * `printer.*`: that family is `printer.not_found` (an absent/inactive PRINTER id, reused unchanged
     * from Slice A), a different fact from "this till has no printer configured at all". Not `till.*`
     * either: that prefix was retired with the node-id rekey (`node.not_found`'s note above) and is not
     * revived here. Not `server.*`: which till lacks a printer is a fact about the till's OWN
     * configuration, not about this process (the rule `tenant.not_found`'s note gives).
     *
     * Mapped to HTTP 400 (binding spec, design §6) — a configuration gap the operator must fix via the
     * dashboard's printer picker before a manual kick can work, not a state conflict on any record, so
     * it takes the request-shape 400 `placement.invalid`/`setup.request_invalid` use rather than a 409.
     * The route surface Task 6 wires `POST /api/drawer/open` into may list it explicitly in its own
     * STATUS map (matching `placement.invalid`'s BOTH-maps precedent) or rely on `createErrorBoundary`'s
     * `status[code] ?? 400` default (`error-boundary.ts`) — the mapping holds either way, and this file
     * only DECLARES the code; the route layer owns the status, the same split every other code here
     * follows. This task registers the code only; the throw site is Task 6, not this one. Never renamed
     * once shipped.
     */
    "drawer.no_printer": { tillId: string };
    /**
     * A promote was requested without an operator attestation that the OLD node is physically
     * neutralised (promotion runbook design §6). Software cannot verify a partitioned peer, so the promote
     * action REFUSES to claim the singleton duties — two submitters under one NIF would race the AEAT
     * flow-control budget (#33 §6). Thrown BEFORE any state change (before the point-of-no-return), so the
     * node is left exactly as it was. No params: the refusal names nothing, and there is nothing non-secret
     * to carry. `promotion.*` names the DOMAIN CONCEPT (a node promotion), never the throwing package —
     * the rule `tenant.not_found`'s note above gives; `server.*` is reserved for facts about the process.
     * Never renamed once shipped.
     */
    "promotion.fence_not_attested": Record<string, never>;
    /**
     * A local-secondary promote (promotion runbook design §5a) was called on a node that is a read-only
     * MIRROR (`deployment.mode='mirror'`). A mirror holds no SIF and cannot become the submitter by a bare
     * `singleton_role` flip — it needs the mirror→primary path (fresh-SIF mint from the pre-reserved
     * identity, §5b), a later slice. Refused with THIS code BEFORE the write, giving a clean domain error
     * rather than the raw `deployment_role_valid_ck` CHECK violation the `(mirror, primary)` write would
     * otherwise raise (the CHECK is the backstop). `mode` is the node's own configured role, already in its
     * config and not a secret — echoing it is what tells the operator which path to use, the same shape
     * `deployment.environment_mismatch` follows. `promotion.*`, not `server.*`, for the reason
     * `promotion.fence_not_attested` gives. Never renamed once shipped.
     */
    "promotion.not_a_local_secondary": { mode: string };
    /**
     * A mirror could not be assembled because the PRIMARY it was pointed at has no stamped environment
     * (sync cloud-mirror C2b — the read-only mirror pulls + applies a primary's rows, the topology
     * `node.read_only` describes). The operator's assemble flow asks the primary for a bundle; a primary
     * whose `deployment` row carries no environment has never been provisioned, so there is nothing to
     * mirror and the assemble is refused BEFORE any bundle fetch or apply. A primary-side PRECONDITION,
     * so it is reported to the operator as HTTP 409 (the resource is not in a state that can serve the
     * request) by the assemble route's local STATUS map in a later C2b task, not here — the same
     * declare-here / status-in-route split every code in this file follows.
     *
     * NO params: the refusal names no row, so a log line leaks nothing — the same `sync.*`/`tunnel.*`
     * no-leak discipline `node.read_only` follows, and there is nothing non-secret to carry beyond the
     * code (the fix is to provision the primary first). `mirror.*` names the DOMAIN CONCEPT — a read-only
     * mirror node — never the throwing package (`tenant.not_found`'s note above gives the rule); `server.*`
     * is reserved for facts about the process itself, and "the primary is not provisioned" is a fact about
     * the mirror-assembly precondition. Never renamed once shipped.
     */
    "mirror.not_provisioned": Record<string, never>;
    /**
     * A mirror could not fetch a bundle because the PRIMARY has no tunnel/relay configured (sync
     * cloud-mirror C2b). The bundle endpoint the mirror pulls from reaches the primary through the
     * outbound snitun tunnel / relay (the on-prem box always dials outbound); a primary with no relay
     * endpoint has nowhere for the mirror to fetch from, so the bundle request is refused. A primary-side
     * PRECONDITION on a well-formed request, reported to the operator as HTTP 400 by the bundle route's
     * local STATUS map in a later C2b task, not here (the declare-here / status-in-route split).
     *
     * NO params: the refusal names no row, the same `sync.*`/`tunnel.*` no-leak discipline
     * `mirror.not_provisioned`/`node.read_only` follow; the relay endpoint is infrastructure config, not
     * echoed, and the fix is to configure the relay. `mirror.*` names the DOMAIN CONCEPT — a read-only
     * mirror node — never the throwing package (`tenant.not_found`'s note gives the rule). Never renamed
     * once shipped.
     */
    "mirror.no_relay": Record<string, never>;
    /**
     * A mirror could not FETCH or PARSE the bundle from the primary (sync cloud-mirror C2b) — the pull
     * over the tunnel/relay failed (a network error, a non-2xx from the primary's bundle endpoint) or the
     * bytes it returned were not a bundle the mirror could parse. This is a MIRROR-SIDE upstream failure,
     * not a fault in the operator's request, so it is reported as HTTP 502 (the mirror is a gateway and
     * its upstream — the primary — failed) by the assemble route's local STATUS map in a later C2b task,
     * not here. Distinct from `mirror.no_relay` (the primary has no endpoint to fetch from at all) and
     * `mirror.not_provisioned` (the primary exists but has nothing to mirror): this is the fetch/parse of
     * a configured, provisioned primary FAILING in flight.
     *
     * NO params: the refusal names no row and never echoes the upstream error's `.message` (which can
     * embed a URL or connection detail — the same no-leak discipline `server.shutdown_failed` and
     * `node.read_only` follow for their own caught values); the structured cause is logged, not put on the
     * wire, so there is nothing non-secret to carry. `mirror.*` names the DOMAIN CONCEPT — a read-only
     * mirror node — never the throwing package (`tenant.not_found`'s note gives the rule). Never renamed
     * once shipped.
     */
    "mirror.bundle_fetch_failed": Record<string, never>;
    /** The recovery-bundle download request carried no `passphrase` string (or an empty one). A
     * client error — the operator must supply the passphrase the bundle will be encrypted under. */
    "recovery.passphrase_required": Record<string, never>;
    /** A recovery-bundle passphrase shorter than the minimum. `min` is `MIN_PASSPHRASE_LENGTH`. */
    "recovery.passphrase_too_short": { min: number };
    /** Recovery-bundle decryption failed its GCM auth tag — a wrong passphrase OR a tampered
     * bundle, deliberately indistinguishable (revealing which would help an attacker). */
    "recovery.passphrase_invalid": Record<string, never>;
    /** A recovery-bundle envelope that is not the expected JSON shape/version, or whose KDF
     * parameters are out of the accepted bounds. `reason` is a coarse cause, never bundle contents. */
    "recovery.bundle_invalid": { reason: string };
    /** The box is missing one of its own persisted secret files, so a complete recovery bundle
     * cannot be built. `missing` is the state-dir-relative path (e.g. `secrets.env`). A server
     * fault, not a client error: the box has lost part of its own unrecoverable state. */
    "recovery.state_incomplete": { missing: string };
    /** The configured backup connection is neither superuser nor BYPASSRLS, so it cannot read the
     * FORCE-RLS fiscal tables: under `pg_dump`'s default `row_security = off` the dump ERRORS loudly,
     * and only WITH `--enable-row-security` (which our runner does not pass) would it instead silently
     * emit a per-tenant-truncated (empty) dump. Refused at boot so a recurring per-run `pg_dump`
     * failure surfaces as one clear boot-time cause and no silently-truncated fiscal backup can ship.
     * No params. */
    "backup.role_rls_fenced": Record<string, never>;
    /**
     * The operator-supplied `primaryUrl` a mirror was pointed at is not a URL the mirror may fetch from
     * (sync cloud-mirror hardening) — it fails to parse, uses a scheme other than http/https, or names a
     * host the SSRF policy refuses (a private/link-local/CGNAT/metadata literal IP over ANY scheme, or a
     * non-loopback host over plain http). `POST /setup-api/adopt` is UNAUTHENTICATED, so this validation
     * is the choke point that stops an attacker driving the mirror to POST its admin credential at a
     * private/metadata literal IP (e.g. `169.254.169.254`) or a non-https target. It covers LITERAL-IP
     * SSRF only: a public DNS hostname over https is still trusted (no resolve-time IP pinning), so
     * DNS-rebinding to an internal address is NOT blocked here — that is the deferred first-contact
     * trust-bootstrap concern (C2b #4; the adjacent TRUST BOOTSTRAP note in `mirror-bundle-fetch.ts`
     * carries the same caveat), out of scope until real hosting. A CLIENT fault — the request is malformed —
     * so it is reported as HTTP 400 by the adopt route's local STATUS map (`ADOPT_STATUS` in setup-api.ts),
     * the declare-here / status-in-route split every code in this file follows. Distinct from
     * `mirror.bundle_fetch_failed` (a well-formed request whose UPSTREAM primary then failed, a 502).
     *
     * NO params: the URL is attacker-controlled and is NEVER echoed — it can carry a credential in its
     * userinfo or an internal host that a log line would leak — the same `sync.*`/`tunnel.*` no-leak
     * discipline `mirror.bundle_fetch_failed`/`node.read_only` follow. `mirror.*` names the DOMAIN CONCEPT
     * — a read-only mirror node — never the throwing package (`tenant.not_found`'s note gives the rule);
     * `server.*` is reserved for facts about the process itself, and "the primary URL is invalid" is a
     * fact about the adopt request, not the process. Never renamed once shipped.
     */
    "mirror.primary_url_invalid": Record<string, never>;
  }
}
