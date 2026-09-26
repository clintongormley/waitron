// A bare side-effect import: it makes TypeScript augment "@waitron/shared" rather than declare a
// fresh ambient module.
import "@waitron/shared";
import type { VerifyFailure } from "@waitron/membership";
import type { ProbeFailure } from "@waitron/stream";

/**
 * This host's contribution to the shared error registry, by declaration merging. A code names the
 * DOMAIN CONCEPT, lowercase and dot-namespaced, never the throwing package; `server.*` is reserved
 * for facts about the process itself. Codes are never renamed once shipped, and a code nothing
 * raises any more keeps its entry.
 *
 * No code's params may carry a secret: the shared error boundary
 * (`packages/server-kit/src/error-boundary.ts`) writes them into the response and the log, and the
 * unauthenticated recovery page shows the log's tail.
 *
 * Reachability: every file that throws one of these imports "./errors.js" directly, and this
 * package has no public barrel — it is an application, not a library.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    "cloud.unavailable": Record<string, never>;
    "cloud.request_unavailable": Record<string, never>;
    "cloud.state_invalid": Record<string, never>;
    "cloud.binding_conflict": Record<string, never>;
    "cloud.busy": Record<string, never>;
    "cloud.not_primary": Record<string, never>;
    "cloud.not_configured": Record<string, never>;
    "cloud.request_invalid": Record<string, never>;
    "cloud.replacement_not_restored": Record<string, never>;
    "cloud.replacement_state_invalid": Record<string, never>;
    "cloud.replacement_refused": Record<string, never>;

    /** This server owns the transient printer-discovery queue; the printing module owns persisted printers.
     * No free probe slot; retry after a request expires. */
    "printer.probe_busy": Record<string, never>;
    "password.throttled": { retryAfterSeconds: number };
    /** Too many public invitation/reset attempts reached this process in the current window. */
    "account_action.rate_limited": Record<string, never>;
    /** The local capture inbox was requested while email uses SMTP or is not configured. */
    "email.test_inbox_unavailable": Record<string, never>;
    /** A required environment variable is absent or empty. `variable` is our own declared name. */
    "server.config_missing": { variable: string };
    /**
     * A supplied environment variable cannot be used. Carries the variable NAME and a reason CODE,
     * never the value: an operator who pasted a secret into the wrong variable must not have it land
     * in an error's params.
     *
     * `value`/`otherVariable`/`otherValue` are the one exception, used only by `config.ts`'s
     * tick-cadence cross-checks: those compare TWO variables, either of which may be the one the
     * operator set, and a millisecond integer is not a secret.
     */
    "server.config_invalid": {
      variable: string;
      reason: string;
      value?: number;
      otherVariable?: string;
      otherValue?: number;
    };
    /**
     * A required `WAITRON_TILL_*` environment variable is unset (absent, or the empty string). `key`
     * is the variable NAME and is the only field: the value is never echoed, so a secret pasted into
     * the wrong variable cannot land in an error's params.
     */
    "server.till_config_missing": { key: string };
    /**
     * A `WAITRON_TILL_*` value is present but a branded-id constructor rejected it. `key` names the
     * variable and is the only field; the rejected value is not carried, for the reason
     * `server.till_config_missing` gives.
     */
    "server.till_config_invalid": { key: string };
    /**
     * A tenant's credential exists but this host cannot use it — a field the purpose registry
     * declares is absent from the sealed row, or its value is not one of the accepted ones. `field`
     * is a name from `PURPOSES`, so it is ours to echo.
     */
    "server.credential_unusable": { purpose: string; field: string };
    /**
     * No such tenant. `id` is an operator-supplied argument, not a secret. Nothing in production
     * raises it today.
     */
    "tenant.not_found": { id: string };
    /** No node with this id. The id is a caller-supplied uuid, not a secret. */
    "node.not_found": { id: string };
    /**
     * A write reached a node running as a read-only MIRROR (`node_roles.mode = 'mirror'`): the
     * read-only gate (`read-only-gate.ts`) refuses every non-GET. Cleared by promotion, read live.
     */
    "node.read_only": Record<string, never>;
    /**
     * A node booting as primary found, by reconciling with its cloud peer, a higher-term membership
     * document that fences it, so it boots read-only rather than sell beside the promoted primary
     * (two nodes filing under one NIF — CLAUDE.md §5). Logged, never thrown: a fenced boot is a
     * state, not a crash.
     */
    "node.membership_superseded_on_boot": Record<string, never>;
    /** `POST /api/node/enrol-self` reached from a non-loopback address. Self-enrol is a
     * loopback-only trust gate: anything that can reach the box's loopback can already read its
     * vault, so enrolling a loopback caller grants nothing new; a LAN caller must not. */
    "node.enrol_not_local": Record<string, never>;
    /** This node cannot self-enrol a print agent because it is not the primary (`node-enrol-api.ts`).
     * A real mirror's POST is refused earlier by the read-only gate with `node.read_only`; this
     * covers a non-primary node that gate does not. */
    "node.enrol_unavailable": Record<string, never>;
    /**
     * The HTTP listener's socket failed to bind. `code` is the raw OS error code (`EADDRINUSE`,
     * `EACCES`) — never the `Error` itself, whose `.message` can embed the bind address.
     */
    "server.listen_failed": { port: number; code: string };
    /**
     * `StartedServer.close()` rejected during a signal-initiated shutdown. `errorCode` is `codeOf`'s
     * structured classification, never the caught value's `.message`.
     */
    "server.shutdown_failed": { errorCode: string };
    /**
     * Shutdown did not finish within the deadline, so the process is exiting anyway (a box restarts
     * by SIGTERM → shutdown → exit → Docker restart, so a shutdown that never finishes is a box that
     * never comes back). Logged only. Not logged when `close()` has already rejected: that exit is
     * `server.shutdown_failed`.
     */
    "server.shutdown_timeout": { deadlineMs: number };
    /**
     * A caught value that is NOT an AppError reached the till API's `run` wrapper — an unclassified
     * fault. The response carries only this code and no params, so nothing internal leaks; `run`
     * logs the `codeOf` classification under `till.failed`.
     */
    "server.internal": Record<string, never>;
    /**
     * A MIRROR node was asked to bind its HTTP listener to a NON-loopback host without the
     * `WAITRON_MIRROR_ALLOW_EXPOSED` opt-in. A mirror serves an UNAUTHENTICATED admin dashboard, so
     * the loopback default of `WAITRON_HTTP_HOST` is the only thing keeping it off the network; boot
     * fails closed here (`assertMirrorBindSafe`) rather than expose it. `host` is the operator's own
     * `WAITRON_HTTP_HOST` value, not a secret.
     */
    "server.mirror_bind_exposed": { host: string };
    /**
     * The container's start-up program was given arguments, which it never takes: `docker compose
     * run app <command>` appends `<command>` to it. No params: the arguments are operator input.
     * `runEntry` (`node-entry.ts`) prints the first and a count of the rest on stdout, and never
     * writes them to the recovery state.
     */
    "server.entry_arguments_refused": Record<string, never>;
    /**
     * The database could not be reached. Nothing constructs it; `classifyBootFailure`
     * (`boot-failure.ts`) returns it and the recovery page has wording for it.
     */
    "provisioning.database_unreachable": { attempts: number };
    /**
     * A driver failure whose message says the database lacks a table or column this image expects.
     * A classification by `classifyBootFailure` (`boot-failure.ts`) of an already-thrown error;
     * nothing constructs it with params, and the recovery page renders fixed text keyed on the code.
     */
    "provisioning.schema_mismatch": { errcode: number | null };
    /**
     * This host is configured for one environment and the database belongs to another. Thrown
     * before migrations run, so nothing is written. Neither value is a secret — both are already in
     * the host's own configuration.
     */
    "deployment.environment_mismatch": { databaseEnvironment: string; hostEnvironment: string };
    /**
     * The demo seed was asked to write sample data — catalogue, staff and back-dated fiscal
     * records — under a production stamp. Refused before anything is written: a production chain
     * can never be corrected (CLAUDE.md §5). `environment` is the resolved host value — always
     * `production`, the only value refused — and not a secret.
     */
    "deployment.demo_data_refused": { environment: string };
    /**
     * An inbound hosted-payment webhook failed signature verification; nothing acts on the event
     * until the `payments.stripe` `webhookSecret` verifies the raw bytes. Carries NOTHING — never the
     * signature, the raw body or the secret.
     */
    "payment.webhook_signature_invalid": Record<string, never>;
    /**
     * A verified webhook whose `external_ref` resolves to no local `initiated` payment. Log-only,
     * never thrown: the route acks 2xx so Stripe stops retrying, and `reconcile`'s `missing_local`
     * class backstops the settlement.
     */
    "payment.webhook_unresolved": { provider: string; externalRef: string };
    /**
     * A card provider cannot be disconnected while a card reader that uses it is still active.
     * `activeReaders` is a COUNT; never a reader id or a secret.
     */
    "payment.provider_in_use": { activeReaders: number };
    /** No card reader with this id. `id` is the reader uuid the caller already holds, not a secret. */
    "reader.not_found": { id: string };
    /** Adoption names a reference absent from the provider account. Public provider id only. */
    "reader.not_listed": { providerId: string };
    /**
     * A reader operation was asked for a provider that has no sealed credential. `providerId` is the
     * public provider token (`"sumup"`/`"stripe"`), never a credential.
     */
    "reader.provider_disconnected": { providerId: string };
    /**
     * An active card reader's battery is at or below the warning floor — a dashboard alert, not a
     * thrown request error (`alert-sources.ts`). `reader` is the display name, `percent` a whole
     * percentage; neither is a secret.
     */
    "reader.battery_low": { reader: string; percent: number };
    /**
     * NOTHING RAISES THIS ANY MORE: a basket line named a product the catalogue did not sell. A line
     * not offered in its zone is now `service_zone.offer_not_allowed` (`priceOrderLines`).
     */
    "sale.unknown_product": { productId: string };
    /** The till was asked to ring a sale with no lines; refused before any catalogue read or fiscal write. */
    "sale.empty_basket": Record<string, never>;
    /**
     * A tender method this till does not support. `method` echoes the request so a translator can
     * name what was attempted; it is caller-supplied text, never a secret.
     */
    "sale.unsupported_tender": { method: string };
    /**
     * NOTHING RAISES THIS ANY MORE: an option-group item that belonged to no active option group of
     * the product. The table `optionGroupItemId` named no longer exists.
     */
    "option.not_found": { optionGroupItemId: string; productId: string };
    /** NOTHING RAISES THIS ANY MORE — the legacy option payload it validated is gone. An unanswered
     *  options list is now `options.label_required` and a pick outside a list's limits is
     *  `extras.limit_exceeded`, both from the contracts in `@waitron/catalogue`. */
    "options.selection_invalid": { productId: string; groupId: string; reason: string };
    /** NOTHING RAISES THIS ANY MORE: the `options.`-prefixed twin of `extras.unsupported_product`. */
    "options.unsupported_product": { productId: string; pricingUnit: string };
    /** An extras pick on a dish that is not priced `each`. A child line is priced at the dish's
     *  quantity times the pick count, so a dish sold by weight would bill a fraction of an extra.
     *  Raised by `priceOrderLines` (working-order.ts); `pricingUnit` echoes what the dish resolved
     *  to. */
    "extras.unsupported_product": { productId: string; pricingUnit: string };
    /**
     * A line's free-text kitchen `note`, after trimming, is longer than the limit. `length` is the
     * trimmed length and `limit` the cap.
     */
    "working_order.note_too_long": { length: number; limit: number };
    /**
     * An operation needed an open shift session and none was supplied — the till's session cookie was
     * absent or named no open session. The cookie's value is never echoed.
     */
    "session.required": Record<string, never>;
    // `working_order.not_found` is declared in @waitron/db's errors.ts.
    /**
     * A working order this caller tried to MODIFY is not `open` (settled, abandoned, or absent — one
     * code for all). The triggers `working_orders_enforce_transition` and
     * `working_order_lines_require_open_parent` are the database backstop; this code gives the
     * caller a domain answer instead of a raw trigger error.
     */
    "working_order.not_open": { workingOrderId: string };
    /**
     * An edit was made from a copy of an OPEN order that another write has since changed: the
     * `revision` the edit carried is not the order's. `revision` is the order's current one; the
     * caller reloads the order and edits again.
     */
    "working_order.out_of_date": { workingOrderId: string; revision: number };
    /**
     * A write reached an OPEN order an integrated card payment is between pricing and filing
     * (`working_orders.payment_attempt_at` is set, plan D22): the payment files what it priced, so the
     * order is not changed under it. The caller waits for the payment to settle or fail.
     */
    "order.payment_in_flight": { workingOrderId: string };
    /**
     * A working order this caller tried to CANCEL or AMEND is not `placed` (still open, settled,
     * abandoned, or absent — one code for all).
     */
    "working_order.not_placed": { workingOrderId: string };
    /**
     * A cancel was requested with no reason (absent, empty or whitespace-only). The app enforces it
     * because `order_amendments`' reason column is nullable. Its own code, not `not_placed`: the
     * reason is checked before the order's status is read, so the order's state is unknown here.
     */
    "working_order.reason_required": { workingOrderId: string };
    /**
     * A working order this caller tried to send to prep (`sendToPrep`, the pickup mode) is not
     * `settled` (open, placed, abandoned, or absent — one code for all). A placed order enqueues its
     * own prep at placing, so reaching here with one means the wrong path was called.
     */
    "working_order.not_settled": { workingOrderId: string };
    /**
     * `markCollected` found the order ALREADY collected. Caught before the write because
     * `working_orders_enforce_transition` permits the `collected_at` stamp only from NULL, so a
     * second stamp would surface as a raw trigger error. Not `not_settled`: a collected order is
     * settled.
     */
    "working_order.already_collected": { workingOrderId: string };
    /** NOTHING RAISES THIS ANY MORE: an order-level prep move that was not legal. */
    "order_prep.invalid_transition": { workingOrderId: string };
    // `table.not_found` is declared in @waitron/db's errors.ts.
    /** A dining table label already exists in this venue. `label` is the operator's own text. */
    "table.label_taken": { label: string };
    /** A dining table exists but is deactivated, so no tab may be opened on it. */
    "table.inactive": { tableId: string };
    /**
     * A move/join TARGET table already has an OPEN tab; `mergeTabs` combines two bills instead. A
     * table whose `tab_id` points at a settled/abandoned order is free. No unique index backs the
     * rule: two concurrent moves cannot overlap because one write transaction runs on the venue
     * file at a time (`withTransaction`, `packages/db/src/tenancy.ts`).
     */
    "table.occupied": { tableId: string };
    /**
     * A table this caller tried to UN-JOIN is not part of the named tab — it points at another tab,
     * at a closed one, at none, or the id names no table. One code for all, so the answer does not
     * confirm another tab's table exists.
     */
    "table.not_joined": { tableId: string; tabId: string };
    /**
     * An un-join named the SOLE table anchoring the tab, so there is no join to carve it out of.
     * Refused because the un-join would otherwise leave the tab with no table.
     */
    "table.not_shared": { tableId: string; tabId: string };
    /**
     * A table's `tab_id` already points at an OPEN working order, so a second tab may not be opened.
     * No unique index backs the rule: two concurrent `openTab`s cannot overlap because one write
     * transaction runs on the venue file at a time (`openTab` in `working-order.ts`). A stale
     * `tab_id` (a settled/abandoned order) reads as free and is overwritten.
     */
    "tab.already_open": { tableId: string };
    // The four `booking.*` codes are declared in @waitron/bookings/src/errors.ts.
    /**
     * A tab verb found the order it was asked to modify is not an OPEN tab — not `open`, not pointed
     * at by any `dining_tables.tab_id`, or absent. Every tab verb shares this code for that state.
     */
    "tab.not_open": { tabId: string };
    /** A per-line void named no line on the open tab. Pre-fiscal: a void of an open tab files nothing. */
    "tab.line_not_found": { tabId: string; lineNo: number };
    /**
     * A tab named as BOTH source and destination of a line-move (`mergeTabs`, or `moveOrderLines`
     * behind `moveTabLines`). Refused first: moving a tab's lines onto itself would abandon it or
     * empty it.
     */
    "tab.merge_self": { tabId: string };
    /** A transfer named the SAME tab as source and destination. */
    "tab.transfer_self": { tabId: string };
    /**
     * A transfer named a `quantity` outside `0 < quantity ≤ line.quantity`, not a valid decimal, with
     * more integer digits than a quantity holds, or finer than the line's unit counts. `quantity` is
     * the caller's own text.
     */
    "tab.transfer_quantity_invalid": { tabId: string; lineNo: number; quantity: string };
    /**
     * A void named a `quantity` outside `0 < quantity ≤ line.quantity`, not a valid decimal, with
     * more integer digits than a quantity holds, finer than the line's unit counts, or less than the
     * whole of an extras line, whose quantity follows its dish. `quantity` is the caller's own text.
     */
    "tab.void_quantity_invalid": { tabId: string; lineNo: number; quantity: string };
    /**
     * A transfer batch named the same source `line_no` more than once. Refused because each entry is
     * checked against the line's quantity before the batch, so repeats would not conserve quantity.
     * `lineNo` is the first that repeats.
     */
    "tab.transfer_duplicate_line": { tabId: string; lineNo: number };
    /**
     * A transfer would separate a modifier from its dish: an entry names a CHILD modifier line (it
     * moves only with its dish), or a PARTIAL split names a dish that carries modifier children
     * (their quantity would no longer match the dish's). `lineNo` is the offending source line.
     */
    "tab.transfer_modifier_line": { tabId: string; lineNo: number };
    /**
     * A split onto a new check named a line whose kitchen ticket is still held (not fired). A check
     * cannot be sent, so the held work would never reach the kitchen. `lineNo` is the offending
     * source line.
     */
    "tab.split_held_line": { tabId: string; lineNo: number };
    /** No service status with this id. */
    "status.not_found": { statusId: string };
    /** A service status exists but is deactivated, so a table may not be set to it. */
    "status.inactive": { statusId: string };
    /** A service-status label already exists. `label` is the operator's own text. */
    "status.label_taken": { label: string };
    /** No floor-plan zone with this id. */
    "zone.not_found": { zoneId: string };
    /** A floor-plan zone name already exists in this venue. `name` is the operator's own text. */
    "zone.name_taken": { name: string };
    /** A kitchen-station name already exists in this venue. `name` is the operator's own text. */
    "station.name_taken": { name: string };
    // `station.not_found` is declared in @waitron/db's errors.ts.
    /**
     * No kitchen notice with this id in this venue (for a station's own display, at its station).
     * Declared by `@waitron/venue-service` too, with the same params: it throws it for an unknown
     * notice, and the acknowledge routes here for an id that is not a UUID.
     */
    "kitchen_notice.not_found": { noticeId: string };
    /**
     * A line was fired but resolves no product- or category-level station and the venue has no
     * default station. Firing fails loud rather than silently dropping food from the kitchen.
     * `locationId` names the misconfigured venue.
     */
    "station.no_default": { locationId: string };
    /**
     * A per-line kitchen ticket-item bump is not legal from the item's current state (a skip, a
     * repeat, backwards, INTO `queued`, or an absent item). `advanceTicketItem` refuses a target the
     * transition table does not hold (`queued`, or a non-string) before any write; otherwise its
     * conditional UPDATE is the check: an illegal move matches no row.
     */
    "ticket.invalid_transition": { ticketItemId: string };
    /**
     * The line has already gone to the kitchen, so this write is refused: a re-fire (`fireLines`
     * catches the per-line unique violation on `ticket_items`, so every fire path is covered), a
     * re-course of a fired line (`setLineCourse`), and, when the venue has switched off changes to
     * sent items (`edit_sent_lines`), a recall (`recallLines`) or an edit (`applyLineEdits`) of a
     * line that was sent to a station. It names the order, not a ticket item, because the re-fire
     * never reads the colliding item.
     */
    "ticket.already_fired": { workingOrderId: string };
    /**
     * `markCollected` found an order that was never fired to the kitchen. Refused rather than
     * stamped: a later `sendToPrep` would fire lines the station queue hides for a collected order.
     */
    "ticket.not_fired": { workingOrderId: string };
    /**
     * A ticket-item bump was refused because the line is still HELD (`fired_at IS NULL`): its course
     * has not been fired. Distinct from `ticket.invalid_transition`, an illegal move on a fired line.
     */
    "ticket.item_held": { ticketItemId: string };
    /**
     * A recall was asked for a line the kitchen has already started (`preparing`/`ready`, not
     * `queued`). Recalling un-fires a line back to held, which is clean only while nothing is
     * cooking; the correction for a started line is a cancel.
     */
    "ticket.already_started": { ticketItemId: string };
    /** A kitchen-course name already exists in this venue. `name` is the operator's own text. */
    "course.name_taken": { name: string };
    /**
     * No kitchen course with this id in this venue, or one that is DEACTIVATED — folded into one
     * code as `station.not_found` folds its own.
     */
    "course.not_found": { courseId: string };
    /**
     * A table-placement field failed validation (`setTablePlacement`): a coordinate or rotation out
     * of range, or an unknown shape. `field` carries the field NAME only, never the value.
     */
    "placement.invalid": { field: string };
    // `management.request_invalid` is declared in `@waitron/server-kit` (`src/errors.ts`) with the
    // request screens that throw it, and reaches this program through their package barrel.
    /**
     * A request to a device-authenticated route carried no usable device identity — the
     * `waitron_device` cookie was absent, malformed, named no device, carried a wrong token, or
     * named a revoked device. One code for all, so the answer does not confirm a device's existence
     * or revocation. NO params: the cookie is a bearer secret.
     */
    "device.unauthorized": Record<string, never>;
    /**
     * A device tried to advance a ticket item on a station it is not bound to. `stationId` names the
     * ITEM's station.
     */
    "device.forbidden_station": { stationId: string };
    /**
     * A device tried an action it may not perform: a handheld (`assertNotHandheld`) or a device whose
     * profile lacks the capability (`assertDeviceCapability`), both in `device-session.ts` and both
     * enforced on the server. `action` names the refused operation, a symbol the route passes.
     */
    "device.forbidden_action": { action: string };
    /**
     * The device-management surface named a device id that matches nothing. Unlike
     * `device.unauthorized`, this surface is for an authenticated manager, so the id is echoed.
     */
    "device.not_found": { deviceId: string };
    /**
     * A join request was accepted under a station-binding profile (`kds_station`) with NO station.
     * Distinct from `station.not_found`, raised when a station WAS supplied but is unusable.
     */
    "device.station_required": Record<string, never>;
    /**
     * A device whose binding carries no `till_id` reached a path that requires one
     * (`requireSaleTillId` in `device-session.ts`, and the roster-login guard in `till-api.ts`). In
     * practice a `kds_station`: the `device_binding_rule_insert`/`_update` triggers refuse a null
     * `till_id` for every other form factor.
     */
    "device.till_required": Record<string, never>;
    /**
     * A join request was accepted under a register-binding (handheld) profile with NO register. A
     * handheld must name the `tills` row it files against; a `till`-form-factor device mints its own.
     */
    "device.register_required": Record<string, never>;
    /**
     * Accepting a `till`-form-factor device tried to create its register under a name another
     * register at the venue already uses (`tills_tenant_location_name_key`). The admin renames the
     * device.
     */
    "device.register_name_taken": Record<string, never>;
    /**
     * A request named a device binding id that matches no row. Checked by a read before the write in
     * `device.ts`, because this engine's foreign-key refusal does not say which key failed.
     * `device.ts` states that reasoning where the read is taken. `field` carries the FIELD NAME
     * only, never the id value.
     */
    "device.binding_invalid": {
      field: "tillId" | "receiptPrinterId" | "deviceProfileId";
    };
    /** NOTHING RAISES THIS ANY MORE: a missing profile on accept is now `device_profile.not_found`. */
    "device.profile_missing": Record<string, never>;
    /**
     * A knock arrived at `POST /api/device/join` while pairing mode is shut — the ordinary state, not
     * an anomaly. NO params: nothing about the window is the joiner's business.
     */
    "device.pairing_closed": Record<string, never>;
    /**
     * This node already holds the cap of pending DEVICE join requests; an uncapped list is a
     * denial-of-service on the admin's attention. Per kind, so agents mid-install cannot lock
     * devices out.
     */
    "device.join_full": Record<string, never>;
    /**
     * Too many knocks in one fixed window — the per-process, global, in-memory limiter
     * (`enrol-rate-limit.ts`) refused this one before any database work. NO params: a blanket
     * throttle is not a fact about the caller.
     */
    "device.join_rate_limited": Record<string, never>;
    /**
     * The admin tapped a number that is not this request's. The request is DELETED, not offered
     * again: a wrong tap denies, which is what makes one-in-three an acceptable guess rate.
     */
    "device.join_mismatch": Record<string, never>;
    /**
     * A node's own print agent asked to self-enrol against a row that was deliberately revoked;
     * self-enrol refuses rather than reactivating it, so a revoke sticks until an admin re-allows it.
     */
    "device.join_revoked": Record<string, never>;
    /**
     * No pending join request with that id — never existed, already accepted or denied, or lapsed.
     * One code for all: the admin's recovery is the same, and the joiner must knock again.
     */
    "join_request.not_found": Record<string, never>;
    /**
     * A self-signed server certificate was asked for with an empty `hostnames` list. The minter
     * refuses before generating a key.
     */
    "setup.cert_hostnames_empty": Record<string, never>;
    /**
     * A setup-mode provision was asked to run on a box that already holds this tenant. A re-run would
     * add a shop and mint a fresh fiscal chain rather than resume the venue, and a stray chain is
     * unrecoverable (CLAUDE.md §5), so `provisionVenue` refuses before writing anything.
     */
    "setup.already_provisioned": Record<string, never>;
    /** A setup or provisioning field cannot be used. Fiscal venue validators also raise this code;
     * editing routes translate it to their own request error. `field` carries only the field name,
     * never its value, because certificate fields can contain credentials. */
    "setup.request_invalid": { field: string };
    /**
     * A provision of an environment for which the fiscal regime demands its provisioning secret
     * (`provisioningSecret.required(environment)`) arrived without it; refused before
     * `provisionVenue` runs. `module` is the fiscal module's id. The secret itself is never echoed.
     */
    "setup.provisioning_secret_required": { module: string };
    /** First production activation lacks an accepted test submission bound to its fiscal inputs. */
    "setup.fiscal_test_required": { module: string };
    /** Another handler currently holds the persistent first-boot operation lease. */
    "setup.already_provisioning": Record<string, never>;
    /** A different request owns the box's persisted incomplete first-boot operation. */
    "setup.operation_conflict": Record<string, never>;
    /**
     * The same adopt request was sent again after an earlier attempt failed past its first write to
     * this node. Adopt has no resume path, and running it again mints a second standby identity, so
     * the request is refused and the saved operation left as it is.
     */
    "setup.adopt_incomplete": Record<string, never>;
    /**
     * A reset from the setup wizard was asked for, but no adopt stopped partway on this box: there
     * is no saved operation, it is not an adopt, or that adopt never wrote here or finished.
     */
    "setup.reset_unavailable": Record<string, never>;
    /**
     * A first-boot setup POST arrived before the box wired the dependencies that action needs; the
     * box is up but cannot serve it yet.
     */
    "setup.not_ready": Record<string, never>;
    /**
     * A manual open-drawer request found no receipt printer set for the requesting till, so there is
     * nothing to send the kick through. `tillId` names the misconfigured till.
     */
    "drawer.no_printer": { tillId: string };
    "drawer.not_attached": { printerId: string };
    /**
     * A promote was requested without the operator attesting that the OLD node is physically
     * neutralised. Software cannot verify a partitioned peer, and two submitters under one NIF is
     * unrecoverable, so the promote refuses before any state change.
     */
    "promotion.fence_not_attested": Record<string, never>;
    /**
     * A local-secondary promote was called on a read-only MIRROR, which needs the mirror→primary
     * path (`promoteMirrorToPrimary`) instead. `mode` is the node's own configured role.
     */
    "promotion.not_a_local_secondary": { mode: string };
    /**
     * A mirror→primary promote minted a membership document at term N+1 over the held N, but a
     * document at term ≥ N+1 had landed meanwhile; the term-guarded write
     * (`persistNodeMembershipIfNewerTx`) refused it, so the whole promote transaction aborts and the
     * node stays a mirror. A re-run recovers.
     */
    "promotion.membership_superseded": { heldTerm: number; mintedTerm: number };
    /**
     * A promote was refused because this node's held membership document marks it fenced
     * (`sell-only`/`evicted`). Promoting it would resume fiscal submission on a superseded chain —
     * two submitters under one NIF (CLAUDE.md §5). Thrown from both promote paths
     * (`assertNotFenced`, `promote.ts`) before any state change.
     */
    "promotion.node_fenced": { standing: "sell-only" | "evicted" };
    /**
     * The break-glass secret for a promote was wrong or absent; refused before any state change. No
     * params: a wrong credential has nothing to echo safely.
     */
    "promotion.break_glass_invalid": Record<string, never>;
    /**
     * `retireSelf` was invoked on a node that is NOT fenced (serving, absent from the chart, or with
     * no membership document). Only a fenced node leaves for good.
     */
    "node.retire_not_fenced": Record<string, never>;
    /**
     * `retireSelf` found the node fenced but its held document names no serving-primary carrier, so
     * there is no survivor to hand over to.
     */
    "node.retire_no_carrier": Record<string, never>;
    /**
     * `retireSelf`'s eviction document lost its term race to a newer one
     * (`persistNodeMembershipIfNewer`), so the eviction was not applied. A re-run recovers.
     */
    "node.retire_superseded": { heldTerm: number; mintedTerm: number };
    /**
     * `rejoinAsSecondary` was invoked on a node that is NOT fenced. A serving node must never be
     * wiped (its own tail could still be unshipped); refused before any irreversible step.
     */
    "rejoin.not_fenced": Record<string, never>;
    /**
     * `rejoinAsSecondary` found the node fenced but its held document names no serving-primary
     * carrier, so there is nothing to re-adopt from after the wipe.
     */
    "rejoin.no_carrier": Record<string, never>;
    /**
     * A mirror could not be assembled because the primary has no stamped environment — it was never
     * provisioned, so there is nothing to mirror.
     */
    "mirror.not_provisioned": Record<string, never>;
    /**
     * A mirror was pointed at a primary of a different deployment environment. One database serves
     * one environment (CLAUDE.md §5); refused before adopt writes anything. `expected` is this box's
     * environment and `actual` the primary's.
     */
    "mirror.environment_mismatch": { expected: string; actual: string };
    /** A mirror bundle was requested from a primary that has no relay configured to reach it through. */
    "mirror.no_relay": Record<string, never>;
    /**
     * A mirror-bundle request carried a malformed STANDBY identity: `standbyNodeId` absent or not a
     * UUID, `standbyPublicKey` absent or empty, or `standbyContactUrl` absent, not a string, or a
     * non-empty value that is not a bare http(s) origin (`""` is accepted). Not
     * `password.invalid`: a bad identity is not a bad credential. The standby's key is not echoed.
     */
    "mirror.standby_invalid": Record<string, never>;
    /**
     * A mirror could not fetch or parse the bundle from the primary. Never carries the upstream
     * error's `.message`, which can embed a URL or connection detail.
     */
    "mirror.bundle_fetch_failed": Record<string, never>;
    /**
     * The membership document could not be written because every read-mint-write round lost its
     * term race. The mirror-bundle adopt handshake refuses rather than force a write that would drop
     * the winner's node from the chart; transient, so the caller retries. `attempts` is the round
     * bound, a constant of this process.
     */
    "membership.write_contended": { attempts: number };
    /** The recovery-bundle download request carried no `passphrase` string (or an empty one). */
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
    /** A `reload()` on `BackupSupervisor` or `StreamHost` was called while another reload on the
     * same object was still in flight; the second is refused rather than allowed to interleave its
     * teardown with the first. */
    "backup.reload_in_progress": Record<string, never>;
    /** A backup artifact's binary frame is malformed (bad magic, version, or truncated header)
     * before decryption is even attempted. `reason` is a short machine tag. */
    "backup.artifact_invalid": { reason: string };
    /** The backup ARCHIVE container — the inner pack of named entries the encrypted frame decrypts
     * to — is malformed: bad magic, unsupported version, or a declared length that would read past
     * the buffer. `reason` is a short machine tag, never the offending bytes. */
    "backup.archive_invalid": { reason: string };
    /** WAITRON_BACKUP_RECOVERY_KEY is unset where one is needed: a backup destination is configured
     * (refused at load so an unattended backup can never write an unencrypted or box-key-encrypted
     * artifact), or a recovery kit is asked for (`GET /api/backup/stream/kit`). */
    "backup.recovery_key_missing": Record<string, never>;
    /** WAITRON_BACKUP_RECOVERY_KEY is shorter than `min` characters. */
    "backup.recovery_key_too_short": { min: number };
    /** WAITRON_BACKUP_DESTINATIONS is not a valid JSON array of destination descriptors. */
    "backup.destinations_invalid": { reason: string };
    /** The backup schedule env vars are inconsistent or malformed: an interval AND a wall-clock
     * schedule both set, or a bad weekday token or `WAITRON_BACKUP_AT` time. `reason` is a short
     * machine tag. */
    "backup.schedule_invalid": { reason: string };
    /**
     * A module declared a `backup.nonDbState` `source` the resolver map carries no entry for. Fails
     * the backup loudly rather than skip that state. `source` is the module's own identifier.
     */
    "backup.source_unresolved": { source: string };
    /**
     * A module declared a `backup.nonDbState` source whose `kind` `collectModuleNonDbState` has no
     * branch for. Fails the backup loudly rather than treat a new kind as a flat directory.
     */
    "backup.source_kind_unsupported": { kind: string };
    /**
     * A backup admin route (`apply`/`rotate`), or the bucket copy's Save on a box holding no
     * recovery key, was refused because a variable `BACKUP_ENV_KEYS` (`boot.ts`) lists is set in the
     * environment. The environment then owns this box's backup settings, and the server
     * does not write `backup.env` beside it. No params: an env var could hold the recovery key. */
    "backup.managed_by_environment": Record<string, never>;
    /**
     * A backup admin route (`apply`/`rotate`) or the bucket copy's Save or switch-off was refused
     * because this node is not the primary; only the primary runs the backup duty. */
    "backup.not_primary": Record<string, never>;
    /**
     * A supplied recovery key cannot be stored verbatim in `backup.env`: it carries a control
     * character or leading/trailing whitespace, or does not survive the env-file round-trip
     * byte-for-byte. A key that round-trips to a different string would encrypt archives under one
     * the operator never recorded — unrecoverable (CLAUDE.md §5). `reason` is a short machine tag,
     * never the key. */
    "backup.recovery_key_unstorable": { reason: string };
    /**
     * After `apply`/`rotate`, the EFFECTIVE recovery key the box will encrypt under does not equal
     * the key that was written. The route fails loud rather than let the operator record a key the
     * box will not use. No params — the keys are secrets. */
    "backup.effective_mismatch": Record<string, never>;
    /**
     * A backup admin route body failed shape validation before any write; or `field: "config"` when
     * `rotate` finds no destination loaded and no key held. `field` names the offending field, never
     * the value, which could be the recovery key. */
    "backup.request_invalid": { field: string };
    /** The stream settings' Test, or the same check Save runs first, refused the owner's bucket.
     * `reason` is `probeBucket`'s short reason (`@waitron/stream`), naming which check failed. */
    "backup.stream_test_failed": { reason: ProbeFailure };
    /** A recovery kit was asked for while no bucket is configured. */
    "backup.stream_not_configured": Record<string, never>;
    /** A recovery kit was asked for on a node with no membership public key (`nodes.public_key`),
     * so a rebuild could not verify the pointer this node signs. */
    "backup.stream_signer_missing": Record<string, never>;
    /**
     * `apply` was given a recovery key different from the usable key this box already holds (a held
     * key under the length floor is replaced instead). One recovery key per venue; `rotate` is the
     * way to change a usable one. No params — the keys are secrets. */
    "backup.recovery_key_exists": Record<string, never>;
    /**
     * The `primaryUrl` a mirror was pointed at fails to parse, uses a scheme other than http/https,
     * or names a host the SSRF policy refuses (a private/link-local/CGNAT/metadata literal IP over
     * any scheme, or a non-loopback host over plain http). `POST /setup-api/adopt` is
     * UNAUTHENTICATED, so this is what stops an attacker driving the mirror to send its admin
     * credential to such a target. It covers LITERAL-IP SSRF only: a public DNS hostname over https
     * is trusted, so DNS rebinding to an internal address is NOT blocked here.
     *
     * NO params: the URL is attacker-controlled and is never echoed — it can carry a credential in
     * its userinfo or an internal host.
     */
    "mirror.primary_url_invalid": Record<string, never>;
    // `reason` is a fixed enum string, never a raw input value.
    "diagnostics.invalid_verbosity": { reason: "level" | "ttl" };
    /** No incident with this id exists in this venue. Also answered for a malformed id and to a
     * session that can see no alerts. */
    "alert.not_found": { id: string };
    /** An alert source failed while being read. Its alerts are replaced by this one, under the
     * source's own area and permission. Built as data, never thrown. */
    "alert.source_unavailable": { area: string };
    /** A backup destination's newest good backup is older than the stale threshold. `destination` is
     * the backend id (never a secret). Built as data by the backups alert source, never thrown. */
    "backup.destination_overdue": { destination: string };
    /** A backup destination's most recent attempt failed. `destination` is the backend id (never a
     * secret). Built as data by the backups alert source, never thrown. */
    "backup.destination_failed": { destination: string };
    /** Neither an archive destination nor a bucket copy that is on and current: no copy of the data
     * is being kept. Built as data by the backups alert source, never thrown. */
    "backup.disabled": Record<string, never>;
    /** The bucket copy's oldest change not yet in the bucket has waited `STREAM_BEHIND_AFTER_MS`
     * (`alert-sources.ts`) or more. `minutes` is that wait, whole. Built as data by the backups
     * alert source, never thrown. */
    "backup.stream_behind": { minutes: number };
    /** The bucket copy stopped Litestream at the side-file limit. Built as data by the backups alert
     * source, never thrown. */
    "backup.stream_paused": Record<string, never>;
    /** The bucket copy stopped because the pointer changed under it, or names a newer term: usually
     * another box writing this venue; it can also be a late pointer write by this box from before a
     * restart, or, on a bucket that refuses a conditional write to a missing object with 412, a
     * pointer that was deleted. Built as data by the backups alert source, never
     * thrown. */
    "backup.stream_refused": Record<string, never>;
    /** The bucket copy refused to start because a value bound for Litestream could not be written
     * into its configuration safely. Built as data by the backups alert source, never thrown. */
    "backup.stream_settings_unusable": Record<string, never>;
    /** The bucket refuses this box's key, or fails the bucket check. Built as data by the backups
     * alert source, never thrown. */
    "backup.stream_bucket_unusable": Record<string, never>;
    /** The bucket copy is set up but not running, and nobody stopped it: its supervisor failed, the
     * pinned Litestream cannot run, it could not start, or it refused for a reason with no wording
     * of its own. `reason` is the status's short tag. Built as data by the backups alert source,
     * never thrown. */
    "backup.stream_stopped": { reason: string | null };
    /** This node's last attempt to rewrite its sealed state row failed, so the row a rebuild reads
     * is out of date or missing. Built as data by the sealed-state alert source, never thrown. */
    "backup.sealed_state_failed": Record<string, never>;
    /** A restored box's first start (a certificate for this machine, the next membership term)
     * failed, so the box sells but does not copy to the bucket. Built as data by
     * `firstStartAlertSource`, never thrown. */
    "restore.first_start_failed": Record<string, never>;
    /** A restored box's first start found bucket settings but could not learn the term the
     * bucket's pointer names: the bucket did not answer within the bound, or opening or reading it
     * failed with no code of its own. The first start fails rather than sign a term the pointer may
     * be above. Logged, never shown. */
    "restore.pointer_unreadable": Record<string, never>;
    /** After a restore, the held membership document cannot be read or is not shaped as a
     * document (`reason` is `malformed`; on any restored start not finishing an adoption), or, at the
     * start that finishes the restore, fails its check against the copy's own node keys (`reason` is
     * the check's own failure). The start is refused and nothing is signed over it. */
    "restore.membership_invalid": { reason: VerifyFailure };
    /**
     * The restore gate (`restore-gate.ts`) refused: the backup's environment differs from the
     * restoring binary's. One database per environment (CLAUDE.md §5): a cross-environment restore
     * would carry the wrong series' `next_number`, a permanent hole once real sales resume.
     */
    "restore.environment_mismatch": { backup: string; target: string };
    /**
     * The restore gate refused: for some module the backup's applied schema version is NEWER than
     * this binary's. A module the target does not run at all is ignored, not refused.
     */
    "restore.schema_too_new": { module: string; backup: number; target: number };
    /**
     * An archive entry name is unsafe or repeats a destination already named in the archive.
     * Duplicates are refused by `validateArtifact`; escapes by `restore-entry-guard.ts`, before any
     * write, both lexically (an absolute name or a `../` escape) and through symlinks (a parent
     * directory that is a pre-existing symlink out of the target). The archive's integrity check
     * proves its bytes are authentic, not that its entry names are safe. `name` is
     * attacker-influenced but not a secret.
     */
    "restore.unsafe_entry_path": { name: string };
    /**
     * The decrypted archive lacks `manifest.json` or `db.dump`, without which nothing can be
     * restored. `missing` is the fixed entry name.
     */
    "restore.archive_incomplete": { missing: string };
    /**
     * The restore met a top-level archive entry it does not know how to route. Fails loud rather
     * than drop data on the cold-recovery path (CLAUDE.md §5); the fix is to teach the restore to
     * route the new entry, never to widen this. `name` is attacker-influenced but not a secret.
     */
    "restore.unexpected_entry": { name: string };
    /** The artifact's `secrets/trading.env` is absent or lacks one of the identity keys the restore
     * hooks need (`WAITRON_TILL_NODE_ID`/`LOCATION_ID`/`SERIES_ID`; an empty value is
     * missing). Validation refuses with the target intact, before identity set-aside or database
     * restore. `missing` is the fixed key or file name. */
    "restore.identity_incomplete": { missing: string };
    /** The artifact's identity names a node the restored database does not hold. */
    "restore.identity_unknown": { nodeId: string };
    /** More than one module's restore hook returned replacement series; only one may own the node's
     * numbering. `modules` is the comma-joined list of their names. */
    "restore.series_conflict": { modules: string };
    /** A module's restore hook, or the series work its outcome led to, threw an `AppError`: `module`
     * is the module's name (`core` when the node's own series contract failed with no module
     * returning series) and `code` the inner code, so the CLI's `restore.*` reporting shows both
     * without learning any module's namespaces. A non-`AppError` throw is not wrapped. */
    "restore.hook_failed": { module: string; code: string };
    /** Placing the restored database failed after part of the old one had been moved aside
     * (`restoreDatabase`, restore.ts). `previous`: every part was put back, so the server's old
     * database is unchanged. `set_aside`: a part could not be put back, and what was not is in
     * `folder`, a folder inside the venue folder, which must be moved back before the server starts.
     * Carries no filesystem error text, which can name paths. */
    "restore.placement_failed": { kept: "previous" } | { kept: "set_aside"; folder: string };
    /** A start found no `venue.db` but a folder inside the venue folder, `folder`, into which a
     * restore moved the old database and which still holds files (`clearReplacedDatabases`,
     * restore.ts). They may be the venue's only copy, so the folder is kept and the start refused
     * until they are moved back or a restore is run again. */
    "restore.database_set_aside": { folder: string };
    /** The owner's bucket holds no `current.json` for the kit's venue: nothing to rebuild from. */
    "restore.stream_pointer_missing": Record<string, never>;
    /** `current.json` was not signed by the key the recovery kit carries (`signature`), or names a
     * different venue (`venue_mismatch`). The key in the bucket is never the one trusted (slice-2
     * spec §5.1). */
    "restore.stream_pointer_unverified": { reason: "signature" | "venue_mismatch" };
    /** The live generation received a change within the last ten minutes on the bucket's own
     * clock, so the old box may still be selling; refused until the operator confirms it is gone
     * (slice-2 spec §5.1). `lastChangeAt` is an ISO time on the bucket's clock. */
    "restore.stream_source_live": { lastChangeAt: string };
    /** Whether the old box is still writing could not be checked: the difference between this
     * box's clock and the bucket's could not be measured (`clock`), or — an archive whose database
     * holds bucket settings — the bucket could not be read (`bucket`). Refused until the operator
     * confirms the old box is gone. */
    "restore.stream_source_unchecked": { reason: "clock" | "bucket" };
    /** The restored copy is a venue the operator has not confirmed: its legal name, tax id and
     * location name, which the operator must recognise before anything is staged. */
    "restore.stream_venue_unconfirmed": { legalName: string; taxId: string; locationName: string };
    /** SQLite's `integrity_check` found the restored copy damaged, or could not open it. Carries no
     * SQLite text, which can name paths. */
    "restore.stream_integrity_failed": Record<string, never>;
    /** The restored copy holds no sealed state row for the node the pointer names, so the box's
     * vault key and certificate authority cannot come back with it. */
    "restore.stream_state_missing": { nodeId: string };
    /** The disk filled while the copy was being downloaded from the bucket. */
    "restore.stream_disk_full": Record<string, never>;
    // The server's working-order paths throw these contributed venue-service codes directly.
    "order.service_context_missing": { workingOrderId: string };
    "service_zone.mode_incompatible": {
      zoneId: string;
      expected: string;
      actual: string;
    };
    /** A joined tab has one ordering context, so every covered table must belong to that zone. */
    "service_zone.join_mismatch": { orderZoneId: string; tableZoneId: string };
  }
}
