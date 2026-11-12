// A bare side-effect import: it makes TypeScript augment "@waitron/shared" rather than declare a
// fresh ambient module.
import "@waitron/shared";
import type { VerifyFailure } from "@waitron/membership";
import type { ProbeFailure } from "@waitron/stream";
import type { AllocationPreview } from "./bill-allocation.js";
import type { CancellationContext } from "./line-cancel-context.js";
import type { BillEditState } from "./order-drafts.js";
import type { UnservedDish } from "./finish-party-service.js";

/**
 * This host's contribution to the shared error registry, by declaration merging. A code names the
 * DOMAIN CONCEPT, lowercase and dot-namespaced, never the throwing package; `server.*` is reserved
 * for facts about the process itself.
 *
 * No code's params may carry a secret: the shared error boundary
 * (`packages/server-kit/src/error-boundary.ts`) writes them into the response and the log, and the
 * unauthenticated recovery page shows the log's tail. A param holding a person's name, email or tax
 * number uses a name on `PERSONAL_LOG_KEYS` (`./log-personal-data.ts`), which the log masks, named
 * for whose it is (`guestName`, never a bare `name`).
 *
 * Reachability: every file that throws one of these imports "./errors.js" directly, and this
 * package has no public barrel — it is an application, not a library.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    "handover.return_refused": { reason: string };
    "handover.return_clash_not_found": { clashId: string };
    "attendance.state_changed": Record<string, never>;
    "sale.department_missing": Record<string, never>;
    "department.operation_description_required": { departmentId: string | null };
    "table.delivery_in_progress": { tableId: string; workingOrderId: string };
    "invoice_delivery.email_unavailable": Record<string, never>;
    "invoice_delivery.printer_invalid": Record<string, never>;
    "invoice_delivery.receipt_invalid": Record<string, never>;
    "invoice_delivery.active": Record<string, never>;
    "invoice_delivery.not_found": Record<string, never>;
    /** The invoice customer download's tax number is on no issued invoice. */
    "invoice_customer.not_found": Record<string, never>;
    "invoice_delivery.full_invoice_required": Record<string, never>;
    /** Paper instead of A4 would print nowhere: the till resolves no receipt printer. */
    "invoice_delivery.receipt_unavailable": Record<string, never>;
    /** The agent's A4 claim is no longer the delivery's current one, or this process never handed it out. */
    "invoice_delivery.claim_lost": Record<string, never>;
    /** No page printer with that id, or no discovery entry an agent reported
     * recently enough for the discovered list to show it. */
    "page_printer.not_found": Record<string, never>;
    /** The discovery entry carries no office report, or one whose printer cannot print an A4 invoice. */
    "page_printer.not_printable": Record<string, never>;
    /** The page printer has no print agent to send it a test page; adding it again re-points it. */
    "page_printer.no_agent": Record<string, never>;
    "venue.business_day_invalid": {
      field: string;
      reason: string;
      clocksChangeOn?: string;
      saveFrom?: string | null;
    };
    "venue.time_zone_repair_not_needed": Record<string, never>;
    "venue.time_zone_repaired": {
      nodeId: string;
      timeZone: string;
      previousRevision: number;
      clockRevision: number;
      oldCategory: "missing" | "invalid";
      oldFingerprint: string;
    };
    "venue.business_day_changed": Record<string, never>;
    "venue.business_day_locked": { reason: string };
    "venue.detail_invalid": { field: string; reason: string };
    "venue.detail_read_only": { field: string };
    "venue.detail_locked": {
      field: string;
      reason: "sales" | "orders" | "daily_close" | "geography_context" | "business_day_history";
    };
    "venue.detail_changed": { field: string };
    "fiscal.clock_drift": { seconds: number };
    "fiscal.certificate_not_used": Record<string, never>;
    "fiscal.certificate_too_large": Record<string, never>;
    "fiscal.certificate_diagnosis_busy": Record<string, never>;
    "fiscal.certificate_diagnosis_unavailable": Record<string, never>;
    "cloud.unavailable": Record<string, never>;
    "cloud.tunnel_unavailable": Record<string, never>;
    "cloud.tunnel_conflict": Record<string, never>;
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

    /** Only a receipt, full invoice, kitchen ticket or refund receipt reprints on another printer. */
    "print_job.own_printer_only": { id: string };
    /** The reprint's printer is disabled, deleted or narrower than the printout. */
    "print_job.printer_unsuitable": { id: string; printerId: string };
    /** This server owns the transient printer-discovery queue; the printing module owns persisted printers.
     * No free probe slot; retry after a request expires. */
    "printer.probe_busy": Record<string, never>;
    /** A ninth distinct Bluetooth address would be queued for one print agent. */
    "printer.bluetooth_command_busy": Record<string, never>;
    /** Pair names an address the named print agent has not reported in a fresh Bluetooth scan. */
    "printer.bluetooth_not_discovered": { address: string };
    /** Forget names an address the named print agent does not currently report as paired. */
    "printer.bluetooth_not_paired": { address: string };
    /**
     * A receipt printer was asked for at an address a print agent reported as an office printer.
     * Weaker than its name: it matches only the host text (ignoring case) and port an agent
     * reported recently (`isListed`, `print-api.ts`); a different port, a name instead of an
     * address, or an edit through PATCH is accepted.
     */
    "printer.office_printer": Record<string, never>;
    /** Too many public invitation/reset attempts reached this process in the current window. */
    "account_action.rate_limited": Record<string, never>;
    /** A captured message was asked for while email uses SMTP or is not configured. */
    "email.test_inbox_unavailable": Record<string, never>;
    /** The local capture inbox holds no message with the requested id. */
    "email.message_not_found": Record<string, never>;
    "email.settings_not_allowed": Record<string, never>;
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
     * A required node identity environment variable is unset (absent, or the empty string). `key`
     * is the variable NAME and is the only field: the value is never echoed, so a secret pasted into
     * the wrong variable cannot land in an error's params.
     */
    "server.node_config_missing": { key: string };
    /**
     * The node identity is malformed or names no node row in the venue database. `key` names the
     * variable and is the only field; the rejected value is not carried, for the reason
     * `server.node_config_missing` gives.
     */
    "server.node_config_invalid": { key: string };
    /**
     * A tenant's credential exists but this host cannot use it — a field the purpose registry
     * declares is absent from the sealed row, or its value is not one of the accepted ones. `field`
     * is a name from `PURPOSES`, so it is ours to echo.
     */
    "server.credential_unusable": { purpose: string; field: string };
    /** No node with this id. The id is a caller-supplied uuid, not a secret. */
    "node.not_found": { id: string };
    "node.read_only": Record<string, never>;
    "node.spare": Record<string, never>;
    /** A change carrying the dashboard's sign-in cookie was sent by a page other than the box's
     * own (`Origin` or `Sec-Fetch-Site`), so it was not run. */
    "management.origin_refused": Record<string, never>;
    /** The box is stepping down: it takes no new request beyond the few that report its state. */
    "handover.stepping_down": Record<string, never>;
    /**
     * A box that holds a restriction, or is the source of an open handover, was asked to carry on
     * as the main box: it cannot undo a handover it knows of.
     */
    "handover.known_handover": { successorNodeId: string };
    /**
     * A box's signed query or handover offer came from a key this box's stored keys and held chart
     * do not vouch for; on the handover source routes, also a box it vouches for that is not the operation's
     * destination.
     */
    "handover.peer_unknown": Record<string, never>;
    /**
     * A final copy was asked of a box that has not stepped down for this operation: its
     * restriction is missing, is not a handed-over one, or names another operation, successor or
     * membership term; or this box holds no source record of the operation, or that record's
     * binding names another operation, another source or another destination.
     */
    "handover.not_stepped_down": { operationId: string };
    /**
     * A caller asked for the status, the final copy or the indicator of a handover operation this
     * box holds no record of.
     */
    "handover.operation_unknown": { operationId: string };
    /**
     * The final copy's file was missing or differed from the indicator, and a copy taken again
     * from venue.db does not match the indicator either: venue.db changed after the indicator was
     * signed.
     */
    "handover.final_copy_changed": { operationId: string };
    /**
     * The spare could not reach the box handing over to it, or what that box answered was not
     * something the spare can act on. The spare asks again by itself.
     */
    "handover.source_unreachable": Record<string, never>;
    /** A handover offer reached a box that is not a mirror, so it has no way to take over. */
    "handover.not_a_spare": Record<string, never>;
    /** A handover offer reached a box while an ordinary promotion of it was running. */
    "handover.promotion_running": Record<string, never>;
    /**
     * A handover offer's taxpayer, environment, chart term or chart digest differs from this box's
     * own, this box holds no chart, or its chart does not name the offer's source `serving-primary`.
     */
    "handover.membership_mismatch": { operationId: string };
    /** A handover was started on a box whose held chart does not name it the serving main box. */
    "handover.not_main_box": Record<string, never>;
    /** A handover was started in a venue where no enabled module can prepare a promotion. */
    "handover.venue_not_supported": Record<string, never>;
    /**
     * A handover named a box the held chart does not list as a spare, or a spare answered that the
     * operation is no longer waiting for the offer.
     */
    "handover.destination_not_spare": { destinationNodeId: string };
    /**
     * This box's own `nodes` lacks a row for the chosen spare holding the key the chart vouches
     * for, so the copy it would send could not start that spare.
     */
    "handover.destination_not_joined": { destinationNodeId: string };
    /** A handover named a spare whose chart address is empty or is this box's own. */
    "handover.destination_unaddressable": { destinationNodeId: string };
    /** A handover's spare did not answer in time, or gave an answer this box could not verify. */
    "handover.destination_unreachable": { destinationNodeId: string };
    /** A start request repeats a handover this box closed at a restart, before it stepped down. */
    "handover.restarted_before_stepdown": Record<string, never>;
    /**
     * A newer chart stepped this box down while a handover was starting, so the handover did not
     * go ahead. Also the refusal stored when the restricted start closes that handover.
     */
    "handover.superseded_during_start": Record<string, never>;
    /**
     * A start request repeats a handover whose taxpayer, environment, chart term or chart digest
     * differ from this box's own now, so this box closed it rather than offer it again.
     */
    "handover.membership_changed": Record<string, never>;
    /** A handover's two boxes hold different values in `backup.env`. */
    "handover.backup_settings_differ": Record<string, never>;
    /**
     * A handover's two boxes switch off different modules in `modules.json`, or run images shipping
     * different migrations, or the copy's journal stands behind the receiving box's image.
     */
    "handover.modules_differ": Record<string, never>;
    /** The box handing over lists a credentials key version the receiving box does not hold. */
    "handover.key_ring_mismatch": Record<string, never>;
    /** The box handing over could not read `file`, one of its own files a handover needs. */
    "handover.settings_unreadable": { file: string };
    /** A handover's spare could not read `file`, one of its own files a handover needs. */
    "handover.destination_settings_unreadable": { file: string };
    /**
     * A start request repeats a handover whose settings on this box differ from those its stored
     * offer signed, so this box closed it rather than offer it again.
     */
    "handover.settings_changed": Record<string, never>;
    /** A final-state indicator's signature is not the handing-over box's own. */
    "handover.indicator_untrusted": Record<string, never>;
    /** The copy has no matching confirmation for this handover. */
    "handover.copy_mismatch": Record<string, never>;
    /** The copy fails the database's own integrity check. */
    "handover.copy_damaged": Record<string, never>;
    /** A declaration got an answer, or activation got no restriction naming this successor. */
    "handover.source_still_answering": { sourceServersUrl?: string };
    /** Neither a verified answer nor one of the allowed silence reasons was obtained. */
    "handover.source_not_established": Record<string, never>;
    /** Only this source's prepared controlled destination may be replaced. */
    "handover.controlled_unresolved": { operationId?: string };
    /** `module`'s records in the copy a spare received fail that module's own check. */
    "handover.chain_broken": { module: string };
    /** The old box's retained selections and the spare's own would leave their file too little room. */
    "handover.preparation_state_too_large": Record<string, never>;
    /**
     * At the start that places the accepted copy, this box's own preparation file could not be read
     * or could not take the old box's retained selections, so the copy was not placed.
     */
    "handover.preparation_state_unusable": Record<string, never>;
    /**
     * At the start that places the accepted copy, a file step failed with `errno`. The copy is kept
     * and pressing Retry on the recovery page tries again.
     */
    "handover.placement_failed": { errno: string };
    /**
     * At the start that places the accepted copy, the disk ran out of room with the copy needing
     * `neededBytes`. The copy is kept and pressing Retry on the recovery page tries again.
     */
    "handover.placement_no_room": { neededBytes: number };
    /**
     * The spare has too little room to place the copy it accepted. It asks the old box to give up
     * filing once there is room.
     */
    "handover.no_room_to_place": Record<string, never>;
    /** `module`'s summary, worked out from the received copy, is not the one the old box signed. */
    "handover.summary_mismatch": { module: string };
    /** The spare could not work out `module`'s summary from the copy it received. */
    "handover.summary_unreadable": { module: string };
    /** The copy has no usable record of the spare that would have to start from it. */
    "handover.copy_lacks_destination": Record<string, never>;
    /** The person who authorised the handover may not move the venue, according to the copy. */
    "handover.authoriser_not_permitted": Record<string, never>;
    /**
     * The old box answered this box's acceptance with something other than a relinquishment of
     * exactly what it accepted, so this box has not taken over filing and keeps asking.
     */
    "handover.relinquishment_invalid": Record<string, never>;
    /**
     * This box's held chart no longer has the operation's source as the main box, so this box asks
     * the old box for nothing more and does not take over from it. A chart naming the old box again
     * clears it.
     */
    "handover.source_no_longer_main": { operationId: string };
    /**
     * The file this box accepted is missing, so it does not ask the old box to give up filing: that
     * would leave neither box able to go forward.
     */
    "handover.accepted_copy_missing": Record<string, never>;
    /**
     * A node booting as primary found, by reconciling with its cloud peer, a higher-term membership
     * document that fences it, so it boots read-only rather than sell beside the promoted primary
     * (two nodes filing under one NIF — CLAUDE.md §5). Logged, never thrown: a fenced boot is a
     * state, not a crash.
     */
    "node.membership_superseded_on_boot": Record<string, never>;
    /**
     * A booting box refused the chart its cloud peer returned because the chart failed its check
     * (`failure` says which), so the chart was not adopted. Logged, never thrown, and no alert is
     * raised.
     */
    "node.membership_refused_on_boot": { failure: VerifyFailure };
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
     * `EACCES`) — never the `Error` itself, whose `.message` can embed the bind address. `listener`
     * names any listener but the main one.
     */
    "server.listen_failed": { port: number; code: string; listener?: string };
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
     * An append-only trigger is absent or carries other text: found after migrating, the start is
     * refused; found while trading, the server stops. Both lists hold trigger names, never a secret.
     */
    "append_only.triggers_changed": { missing: string[]; altered: string[] };
    /**
     * A start found an append-only trigger missing before migrating, and migrating put it back.
     * Built as data by `appendOnlyRestoredAlertSource`, never thrown.
     */
    "append_only.triggers_restored": Record<string, never>;
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
    "payment.provider_in_use": { activeReaders: number; readerNames?: string[] };
    "payment.provider_disabled": { providerId: string };
    "payment.not_stuck": { paymentId: string };
    "stuck_payment.not_found": { paymentId: string };
    "payment.resolve_unsupported": { providerId: string };
    /** The processor could not say what became of the payment; the row and the order's mark are
     * left as they were. */
    "payment.outcome_unknown": {
      paymentId: string;
      reason: "unreachable" | "ambiguous";
      providerStatus?: string;
    };
    /** No card reader with this id. `id` is the reader uuid the caller already holds, not a secret. */
    "reader.not_found": { id: string };
    /**
     * Adoption names a reference absent from the provider account, or one an Unpair or Delete
     * dropped there after the adoption's list request began. Public provider id only.
     */
    "reader.not_listed": { providerId: string };
    /**
     * A reader operation was asked for a provider that has no sealed credential. `providerId` is the
     * public provider token (`"sumup"`/`"stripe"`), never a credential.
     */
    "reader.provider_disconnected": { providerId: string };
    /**
     * A Delete or Unpair of this reader is running, so a second one, an Enable, or an adoption of
     * the same provider reader (`providerRef`) is refused until it ends. `readerId` is the reader's
     * uuid, which the reader list shows under the same permission; not a secret.
     */
    "reader.unpair_in_progress": { readerId: string };
    /**
     * An active card reader's battery is at or below the warning floor — a dashboard alert, not a
     * thrown request error (`alert-sources.ts`). `reader` is the display name, `percent` a whole
     * percentage; neither is a secret.
     */
    "reader.battery_low": { reader: string; percent: number };
    "reader.status_unavailable": { reader: string };
    "reader.offline": { reader: string };
    /** The till was asked to ring a sale with no lines; refused before any catalogue read or fiscal write. */
    "sale.empty_basket": Record<string, never>;
    "sale.charged_not_recorded": {
      workingOrderId: string;
      reason:
        | "disk_full"
        | "clock_behind_chain"
        | "clock_unusable"
        | "clock_unconfirmed"
        | "issuance_refused"
        | "partial_refund";
      recoveryUrl?: string;
    };
    /**
     * A tender method this till does not support. `method` echoes the request so a translator can
     * name what was attempted; it is caller-supplied text, never a secret.
     */
    "sale.unsupported_tender": { method: string };
    /** An extras pick on a dish not sold in whole portions: its unit has a scale (`soldBy:
     *  "weight"`), else allows decimal places (`"fraction"`), else is marked a measure such as ml
     *  (`"measure"`). A child line is priced at the dish's quantity times the pick count, so on such
     *  a dish an extra's quantity would not be a number of extras. */
    "extras.unsupported_product": {
      productId: string;
      soldBy: "weight" | "fraction" | "measure";
    };
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
    /**
     * A till request named a person who is not the one signed in on the device, or named nobody.
     * `personId` is the person named, or `null` when there was no id.
     */
    "session.person_not_signed_in": { personId: string | null };
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
    "sale.full_invoice_unavailable": Record<string, never>;
    "invoice.recipient_invalid": {
      field: "taxId" | "legalName" | "address" | "identifierType" | "identifierCountryCode";
    };
    "invoice.choice_locked": Record<string, never>;
    /**
     * A write reached an OPEN order a card payment is in flight on: an integrated payment between
     * pricing and filing (`working_orders.payment_attempt_at` is set), or a pending card payment
     * towards the bill. The payment settles what it was asked for, so what the order charges is not
     * changed under it. Also a cancel of any PLACED order with a card payment: one its provider
     * has not resolved, or one captured or accepted offline that no sale records yet
     * (`ordersWithUnfiledPayment`); or a cancel of any placed order while an integrated card
     * collection of it runs in this process (`paymentAttemptIsLive`). Also, while such a payment or
     * collection exists (`refusePlacedPaymentInFlight`): a collect of a placed order, an unpaid
     * departure recorded for its party, a payment of it or its preview in the bill's payment window
     * (where a card taken for a part payment is not counted; its reservation is, as on an open bill,
     * and refuses a payment with this code when it covers all that is left), and a card payment
     * (`/api/pay`) of it other
     * than one that files a card already charged, invoice or none; and setting the invoice choice or
     * receipt language of a placed order with no invoice yet. The caller waits for the payment to
     * settle or fail.
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
     * own prep at placing, so reaching here with one means the wrong path was called. Also
     * `handOver`'s refusal (through `handOverOrder`) of an order it may not hand over: absent, open,
     * abandoned, a table party's bill, or placed in a mode that takes payment before sending.
     */
    "working_order.not_settled": { workingOrderId: string };
    /**
     * `handOver` (through `handOverOrder`) found the order ALREADY collected, or a move to another
     * station found the order handed over. Caught before the
     * write because `working_orders_enforce_transition` permits the `collected_at` stamp only from
     * NULL, so a second stamp would surface as a raw trigger error.
     */
    "working_order.already_collected": { workingOrderId: string };
    // `table.not_found` is declared in @waitron/db's errors.ts.
    /**
     * The name is already in use in this venue. A floor-plan save sends `label`, the saved label
     * asked for; with `takenBy`, the saved table is left with no short name and another zone's
     * table, named by `takenBy`, shows that name as its own short name. A till's name for today
     * sends `todayName`, the name asked for, with `field: "name"`; it is masked in the log because
     * it is normally a booking's surname, and `field?: never` keeps it from travelling as `label`.
     */
    "table.label_taken":
      { label: string; takenBy?: string; field?: never } | { todayName: string; field: "name" };
    /** A floor-plan save sent a short name another table holds; `takenBy` is that table's full name. */
    "table.short_name_taken": { shortName: string; takenBy: string; field: "shortName" };
    "table.inactive": { tableId: string };
    /** A change to today's plan named a table with no today's row, or a spare where it needs a place. */
    "table.not_on_today_plan": { tableId: string };
    /** A change to today's plan named a table taken off for today. */
    "table.taken_off": { tableId: string };
    /** A change to today's plan would move, turn or place a fixed table. */
    "table.fixed": { tableId: string };
    /** A change to today's plan would turn or take off a table in one of today's merges. */
    "table.merged": { tableId: string };
    /** Taking a table off for today found an order with food on its way to it. */
    "table.delivery_pending": { tableId: string };
    /**
     * The table still needs clearing (`dining_tables.needs_clearing_since` is set), so
     * no party may be seated at it, moved to it or joined to it until Mark cleared.
     */
    "table.needs_clearing": { tableId: string };
    /**
     * The table's reset row waits for Mark moved, so no party may be seated at it, moved to it or
     * joined to it, and it may not be merged.
     */
    "table.needs_moving": { tableId: string };
    /**
     * A bill was moved to a table its own party already holds, a party joined a table it holds, or
     * guests were moved to the only table their party holds.
     */
    "table.already_in_party": { tableId: string };
    /**
     * Split a table named a table the party does not hold, or the id names no table. One code for
     * both, so the answer does not confirm another party's table exists.
     */
    "table.not_joined": { tableId: string; partyId: string };
    /** Split a table named the party's only table, which would leave the party with none. */
    "table.not_shared": { tableId: string; partyId: string };
    /** A party still holds the table, so no party may be seated at it (`openTab`). */
    "tab.already_open": { tableId: string };
    /**
     * A party verb found the party is not open — Finish, a new service command, an unpaid
     * departure, or a bill action on a party's bill (`guardParty`) — or the id names no party, or a
     * party id in a route is not a UUID. One code for all, as `tab.not_open` is.
     */
    "party.not_open": { partyId: string };
    "party.not_found": { partyId: string };
    "service_step.not_found": { stepId: string };
    /**
     * A command carried a party revision another write has since moved past, so it was prepared
     * from a stale copy of the party; or it named a party it read at a table or on a bill where that
     * party no longer is, or read a table free that this party now holds (`refuseMovedParty`).
     * `revision` is the party's current one; the caller reloads and acts again. The sibling of
     * `working_order.out_of_date`.
     */
    "party.out_of_date": { partyId: string; revision: number };
    /**
     * Finish table found a bill of the party — its own, or one kept by a party merged into it — that
     * is placed, or open with items on it: the table cannot be finished while a bill is unpaid.
     */
    "party.bill_outstanding": { partyId: string };
    "party.unserved_dishes": { partyId: string; dishes: UnservedDish[] };
    "unpaid_departure.nothing_outstanding": { partyId: string };
    /**
     * Record unpaid departure found a bill it would invoice — open, or presented with no invoice
     * yet — holding a dish the kitchen is not making: never sent, held in its group or by its
     * kitchen item, or waiting for the pass and not served whole. Staff
     * cancel it first.
     */
    "unpaid_departure.unfired_dishes": { workingOrderId: string };
    /**
     * Record unpaid departure found a bill it would invoice, open or presented, holding a payment,
     * one given back in full included: collecting a presented bill refuses one that holds a payment
     * (`collectOrder`, through `refuseBillWithPayments`), so the invoice issued now could not be
     * collected later.
     */
    "unpaid_departure.bill_holds_payment": { workingOrderId: string };
    /**
     * A submission id already recorded in this scope arrived with another command kind or other
     * arguments. The id is the device's own, made fresh for each person's action.
     */
    "submission.id_reused": { submissionId: string };
    "invoice_correction.not_settled": { saleId: string };
    "invoice_correction.not_cash": { saleId: string };
    "invoice_correction.cash_short": { saleId: string; cashLeft: string; gross: string };
    /** The invoice already has a correction that is still open. */
    "invoice_correction.already_open": { saleId: string; correctionId: string };
    /** The invoice's payments hold less money still refundable than the correction would give back. */
    "invoice_correction.money_short": { saleId: string; moneyLeft: string; gross: string };
    "invoice_correction.not_found": { correctionId: string };
    /** The refund names a correction of another invoice, or one that has ended. */
    "invoice_correction.not_open": {
      correctionId: string;
      state: "open" | "filed" | "discarded" | "closed";
    };
    /** The refund would give back more than the correction has left; what it has left. */
    "invoice_correction.leg_too_large": { correctionId: string; left: string };
    /** The split the till showed is no longer what this correction would file; the fresh one. */
    "invoice_correction.split_changed": {
      saleId: string;
      gross: string;
      vatBreakdown: Array<{ rate: string; base: string; tax: string }>;
      moneyRefundable: string;
    };
    "invoice_correction.chain_unsound": { saleId: string };
    /** The bill cannot be closed by transfer: it is not one whole, positive, untouched bill. */
    "transfer_close.ineligible": {
      workingOrderId: string;
      reason:
        | "non_positive"
        | "prior_payment"
        | "prior_tender"
        | "correction"
        | "void"
        | "substitution"
        | "final_without_transfer"
        | "other_node";
    };
    /** The request's invoice type or total is not the bill's. */
    "transfer_close.conflict": { workingOrderId: string };
    /** This node's business day of the closure is already frozen by its daily close. */
    "transfer_close.day_frozen": { nodeId: string; businessDay: string };
    "draft.taken_over":
      | { draftId: string; ownerId: string; ownerName: string }
      | {
          billId: string;
          draftId: string | null;
          ownerId: string;
          ownerName: string | null;
          edit: BillEditState;
          conflicts?: BillEditState[];
        };
    /** The draft has been submitted, so no command can act on it. */
    "draft.already_submitted": { draftId: string };
    "draft.out_of_date":
      | { draftId: string; revision: number }
      | {
          billId: string;
          draftId: string | null;
          revision: number | null;
          edit: BillEditState;
        };
    /**
     * The id names no draft that is open or submitted, or names one of another party than the one
     * the request is on. A discarded draft is not found.
     */
    "draft.not_found": { draftId: string };
    /**
     * A group command needs a HELD group — a join, a move into or out of one, a fire, a reorder —
     * and this one has fired. `groupId` is the group named or the group a moved line sits in.
     */
    "group.not_held": { groupId: string };
    /**
     * A snooze, or clearing one, named a held group that is not the one waiting: the party's first
     * held group is. `groupId` is the group named.
     */
    "group.not_waiting": { groupId: string };
    /**
     * No group of this party has the id (a removed group included), a moved line is not a dish
     * line in one of the party's groups, or a served line is not a dish line on a bill of the party.
     * One of the two ids is named.
     */
    "group.not_found": { groupId: string } | { lineId: string };
    /**
     * A bill holding a line of a held group was asked to move to the counter. A counter order has
     * no party and so no groups to hold the line in; fire the group first.
     */
    "group.held_leaves_party": { tabId: string; lineNo: number };
    /**
     * A line was named while its group is held, or marked served before the waiter has asked for
     * it or while one of its extras is held.
     */
    "group.line_held": { tabId: string; lineNo: number };
    /** A payment was asked of a bill with nothing left to pay and no card pending on it. */
    "bill.nothing_outstanding": { workingOrderId: string };
    "bill.unsent_dishes": { billId: string };
    /**
     * The venue has tips off and the payment would record a tip. `chargeable` is what can be taken
     * without one.
     */
    "bill.tip_not_allowed": { workingOrderId: string; chargeable: string };
    /**
     * The allocation the operator was shown is no longer the server's, or a choice between paying
     * the full price with a tip and using the earlier contributions is needed. `preview` is the
     * server's current answer, for the till to show again.
     */
    "bill.allocation_changed": { workingOrderId: string; preview: AllocationPreview };
    /**
     * A write would charge again, move, void, reduce or edit a quantity of a line that a pending
     * or received item payment has paid for. The line's unpaid quantity stays free.
     */
    "bill.line_paid": { workingOrderId: string; lineNo: number };
    /**
     * A write would leave the bill's total below the money it has received or reserved. `excess`
     * is by how much; refunding that first lets the write through.
     */
    "bill.received_exceeds_total": { workingOrderId: string; excess: string };
    /**
     * Money has been taken on the bill before its invoice. Paying it in one go by the
     * single-payment routes, placing it, merging it with another bill and moving items between it
     * and another are refused while it has any pending or received bill payment, even one given
     * back in full; abandoning it and finishing its table are refused while it still holds money.
     */
    "bill.payments_received": { workingOrderId: string };
    /** The bill has been presented (placed), so it takes no new order. */
    "bill.presented": { workingOrderId: string };
    /** The bill is paid, so it takes no new order. */
    "bill.paid": { workingOrderId: string };
    /** An order named a bill that is not the party's: a bill of another party, or of none. */
    "bill.other_party": { workingOrderId: string };
    /**
     * A merge would move `workingOrderId`'s full invoice onto `intoWorkingOrderId` without the till
     * saying which customer the merged bill is invoiced to, or either bill's full invoice changed
     * since the till asked.
     */
    "bill.merge_invoice_choice_required": { workingOrderId: string; intoWorkingOrderId: string };
    /** No bill payment with this id; `paymentId` is the id the caller sent. */
    "bill.payment_not_found": { paymentId: string };
    "bill.payment_not_stuck": { paymentId: string };
    /**
     * What became of a pending card bill payment is not confirmed, so nothing was recorded and the
     * payment stays pending. `reason`: `unreachable` (the provider could not be asked), `ambiguous`
     * (the provider's answer, or its row's state named by `providerStatus`, does not settle it),
     * `attempting` (the provider row is still attempting, so the card may yet be charged).
     */
    "bill.payment_outcome_unconfirmed": {
      paymentId: string;
      reason: "unreachable" | "ambiguous" | "attempting";
      providerStatus?: string;
    };
    /**
     * A refund asked for more than the bill payment can still give back. `applied` and `tip` are
     * what it can: a refund may take up to `applied`, and the tip comes back only with the whole of
     * what is left of the payment.
     */
    "bill.refund_exceeds_payment": { paymentId: string; applied: string; tip: string };
    "tender.refund_exceeds_payment": { tenderId: string; applied: string; tip: string };
    "tender.refund_exceeds_cancelled": { tenderId: string; cancelled: string };
    "tender.manual_refund_pin_required": { tenderId: string };
    "tender.refund_unavailable": { tenderId: string };
    "tender.refund_in_progress": { tenderId: string };
    "tender.refund_not_found": { refundId: string };
    "tender.refund_not_stuck": { refundId: string };
    "tender.refund_outcome_unconfirmed": { refundId: string };
    "tender.attestation_contradicted": { refundId: string; evidence: "never_sent" };
    /**
     * A refund of an item payment asked for less than the whole of it: an item payment is given
     * back whole, which frees its lines. `applied` and `tip` are that whole.
     */
    "bill.refund_not_whole": { paymentId: string; applied: string; tip: string };
    /**
     * A standalone-terminal refund lacks explicit confirmation, or the connected provider offers
     * no refund route Waitron can record before asking.
     */
    "bill.refund_unsupported": { paymentId: string };
    /** A standalone terminal refund requires a manager's PIN on this request. */
    "bill.manual_refund_pin_required": { paymentId: string };
    /**
     * A card refund of the bill is still pending: until the card provider shows its outcome, the
     * bill's payments, what its lines charge, and its invoice stay as they are.
     */
    "bill.refund_in_progress": { workingOrderId: string };
    /** No refund of a bill payment with this id; `refundId` is the id the caller sent. */
    "bill.refund_not_found": { refundId: string };
    /** A manager's action was refused: the refund is no longer pending, or its request is still
     * running in this process. */
    "bill.refund_not_stuck": { refundId: string };
    /**
     * The card provider did not show what became of a pending refund, so nothing was recorded and
     * the bill stays locked. `reason`: `not_found` (no such refund there), `ambiguous` (more than
     * one could be it), `unreachable` (the provider could not be asked), `pending` (the provider
     * has not finished it).
     */
    "bill.refund_outcome_unconfirmed": {
      refundId: string;
      reason: "not_found" | "ambiguous" | "unreachable" | "pending";
    };
    /**
     * A manager's recorded outcome is contradicted by Waitron's own record, so it was not recorded.
     * `evidence`: `captured` (the provider's record shows the card charged), `never_sent` (the
     * refund never reached the provider).
     */
    "bill.attestation_contradicted": { id: string; evidence: "captured" | "never_sent" };
    /**
     * An incident: the provider captured a card bill payment for its amount, but the loop could not
     * record it received, its invoice included, so the payment stays pending and its bill locked.
     * `errorCode` is the refusal's code, `unknown` for an error that carries none.
     */
    "payment.bill_settle_failed": {
      billPaymentId: string;
      workingOrderId: string;
      amount: string;
      errorCode: string;
    };
    "payment.tender_refund_unresolved": {
      refundId: string;
      saleId: string;
      tenderId: string;
      amount: string;
      pendingSince: string;
    };
    "payment.tender_refund_outcome_conflict": {
      refundId: string;
      saleId: string;
      tenderId: string;
      amount: string;
      providerRefundRef: string | null;
    };
    /**
     * An incident: the card provider shows a bill refund made that Waitron had already recorded as
     * failed. Nothing was recorded; the money went back to the payer.
     */
    "payment.refund_outcome_conflict": {
      refundId: string;
      billPaymentId: string;
      workingOrderId: string;
      amount: string;
      providerRefundRef: string | null;
    };
    /**
     * An incident: a card refund of a bill has been pending for more than an hour, so its bill is
     * locked until the card provider shows the outcome or a manager records a confirmed one.
     */
    "payment.refund_unresolved": {
      refundId: string;
      billPaymentId: string;
      workingOrderId: string;
      amount: string;
      pendingSince: string;
    };
    // The four `booking.*` codes are declared in @waitron/bookings/src/errors.ts.
    /**
     * A tab verb found the order it was asked to modify is not open, or is absent; or, for a verb
     * on a party's bills, is an open order of no party: a counter order.
     */
    "tab.not_open": { tabId: string };
    "tab.cancel_context_changed": { context: CancellationContext };
    /**
     * No such line on the open bill: an adjustment names its line by id, every other caller by number.
     */
    "tab.line_not_found": { tabId: string; lineNo: number } | { tabId: string; lineId: string };
    /**
     * A bill named as BOTH source and destination of a merge (`mergeBills`, or `moveOrderLines`).
     * Refused first: moving a bill's lines onto itself would abandon it or empty it.
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
     * A served or unserved mark named a `quantity` that is not a positive decimal in the line's
     * unit's decimal places, more than is left to serve on the line, or, for an undo, more than is
     * served. `quantity` is the caller's own text.
     */
    "tab.serve_quantity_invalid": { tabId: string; lineNo: number; quantity: string };
    /**
     * A transfer batch named the same source `line_no` more than once. Refused because each entry is
     * checked against the line's quantity before the batch, so repeats would not conserve quantity.
     * `lineNo` is the first that repeats.
     */
    "tab.transfer_duplicate_line": { tabId: string; lineNo: number };
    /**
     * A transfer would separate a modifier from its dish: an entry names a CHILD modifier line (it
     * moves only with its dish), or a PARTIAL split names a dish that carries modifier children
     * (their quantity would no longer match the dish's). Also a partial split that takes a dish's
     * extras with it — asked for only by a give-away or a discount of part of a dish — when an extra
     * is not a whole count for each dish, so its two parts would not add up to it; that path
     * refuses the same case first as `adjustment.quantity_invalid`. `lineNo` is the offending
     * source line.
     */
    "tab.transfer_modifier_line": { tabId: string; lineNo: number };
    /**
     * A send or a raise would add more than `limit` portions of one dish at once. Each portion is
     * its own line, and one write of a few thousand lines fails in the store.
     */
    "tab.portions_too_many": { limit: number };
    /** No floor-plan zone with this id. */
    "zone.not_found": { zoneId: string };
    /**
     * This set's layout of the zone was saved since the editor's copy was read. `revision` is the
     * layout's current one; the caller reloads the layout and saves again.
     */
    "floor_plan.out_of_date": { zoneId: string; revision: number };
    /** A layout save's entry is out of range; `field` is its path, such as `tables.0.seats`. */
    "floor_plan.invalid": { field: string };
    /** No floor plan set with this id among the venue's active departments' sets. */
    "floor_plan_set.not_found": { setId: string };
    /** A floor plan set request names something the set cannot take; `field` names it. */
    "floor_plan_set.invalid": { field: string };
    /**
     * The till's read of today's room is older than the room: `revision` is the room's revision
     * after this request's catch-up, which the refusal rolls back with everything else; a caller
     * should re-read the floor before trying again.
     */
    "floor_today.out_of_date": { zoneId: string; revision: number };
    /** The layout the till offered or reset onto is no longer the zone's; the till reads again. */
    "floor_today.layout_changed": { zoneId: string };
    "merge.seats_required": Record<string, never>;
    /** A table named to split off a group is not one of its members. */
    "merge.member_invalid": { tableId: string; field: "partIds" };
    /** The split names every member of the group, which would leave it with none. */
    "merge.split_all": { tableId: string; field: "partIds" };
    /** The split names every table a party holds, which would leave it with none. */
    "merge.strands_party": { tableId: string; field: "partIds" };
    /** A floor-plan zone name already exists in this venue. `name` is the operator's own text. */
    "zone.name_taken": { name: string };
    /** A kitchen-station name already exists in this venue. `name` is the operator's own text. */
    "station.name_taken": { name: string };
    "station.is_default": { stationId: string };
    "station.screen_in_use": { stationId: string; count: number };
    "station.work_in_progress": { stationId: string; count: number };
    // `station.not_found` is declared in @waitron/db's errors.ts.
    /**
     * No kitchen notice with this id in this venue (for a station's own display, at its station).
     * Declared by `@waitron/venue-service` too, with the same params: it throws it for an unknown
     * notice, and the acknowledge routes here for an id that is not a UUID.
     */
    "kitchen_notice.not_found": { noticeId: string };
    /**
     * A line was fired but no routing cell applies and the venue has no active
     * default station. Firing fails loud rather than silently dropping food from the kitchen.
     * `dishes`: the staff names of the dishes no active station can make, other than those
     * refused `station.no_replacement`, each once, in line order, joined by ", ".
     */
    "station.no_default": { dishes: string };
    "station.no_replacement": { stationId: string; productIds: string[] };
    /**
     * A per-line kitchen ticket-item bump is not legal from the item's current state (a skip, a
     * repeat, or backwards). Its conditional UPDATE is the check: an illegal move matches no row.
     */
    "ticket.invalid_transition": { ticketItemId: string };
    /** A ticket-item bump named an item that does not exist. */
    "ticket_item.not_found": { ticketItemId: string };
    "ticket.already_fired": { workingOrderId: string };
    /**
     * `handOver` (through `handOverOrder`) found an order that was never fired to the kitchen.
     * Refused rather than stamped: a later `sendToPrep` would fire lines the station queue hides
     * for a collected order.
     */
    "ticket.not_fired": { workingOrderId: string };
    /**
     * A move named a line with no kitchen record: never sent, or a dish needing no preparation.
     * Before a send, `make_at_station_id` chooses where a dish will be made.
     */
    "ticket.not_sent": { workingOrderId: string; lineId: string };
    "ticket.extra_not_movable": { workingOrderId: string; lineId: string };
    /** A move named a dish made at the sending till, always fired and ready; its station is its maker. */
    "ticket.made_here": { ticketItemId: string };
    /**
     * A ticket-item bump was refused because the item is not released yet (`fired_at` is null:
     * held, or Requested and waiting for the pass). Distinct from `ticket.invalid_transition`, an
     * illegal move on a fired line.
     */
    "ticket.item_held": { ticketItemId: string };
    /**
     * A pass's Fire named other dishes, or another digest, than the card it sees now: refresh it.
     */
    "ticket.pass_context_changed": Record<string, never>;
    /**
     * A recall or station move named a line already preparing or ready. A move also refuses a line
     * sent out of the kitchen or partly served. Recalling un-fires a line back to held only while
     * nothing is cooking; the correction for a started line is a cancel. An edit (`applyLineEdits`)
     * changing or lowering a started dish, or a whole-order save leaving it out, is refused the same
     * way.
     */
    "ticket.already_started": { ticketItemId: string };
    /**
     * An edit (`applyLineEdits`) would change a dish some of which has been marked served, or a
     * whole-order save (`updateHeldOrder`) would leave it out or lower its count. `lineId` is the
     * served line.
     */
    "ticket.already_served": { workingOrderId: string; lineId: string };
    /**
     * A whole-order save (`updateHeldOrder`) would leave out or lower a dish stamped sent that has
     * no kitchen record, such as a drink handed over at the bar. `lineId` is the sent line.
     */
    "ticket.already_sent": { workingOrderId: string; lineId: string };
    /** A kitchen-course name already exists in this venue. `name` is the operator's own text. */
    "course.name_taken": { name: string };
    /**
     * No kitchen course with this id in this venue; where only an active course will do
     * (`requireLiveCourse`, `moveCourse`), also a deleted one.
     */
    "course.not_found": { courseId: string };
    // `management.request_invalid` is declared in `@waitron/shared` (`src/errors.ts`).
    /**
     * A request to a device-authenticated route carried no usable device identity — the
     * `waitron_device` cookie was absent, malformed, named no device, carried a wrong token, or
     * named a revoked device — or a till sign-in session's device has been revoked
     * (`requireSession`). NO params: the cookie is a bearer secret.
     */
    "device.unauthorized": Record<string, never>;
    /**
     * Refused because of the station: a device's station screen does not offer it, or a till
     * session advanced a dish that has since left the station the request named. `stationId` names
     * the dish's current station when a dish is involved, otherwise the refused station.
     */
    "device.forbidden_station": { stationId: string };
    /**
     * A device whose active profile does not permit the action tried it (`assertProfileAction`,
     * `device-session.ts`). `action` names the refused operation: the profile action, or the
     * symbol a route that predates the action names passes.
     */
    "device.forbidden_action": { action: string };
    /** A cash payment from a device whose profile does not take cash (`assertTakesCash`). */
    "device.cash_not_allowed": Record<string, never>;
    /**
     * A device's active profile cannot change while a card payment it started is still unresolved
     * (`payments.state` `attempting` or `initiated`): the payment finishes or is cancelled first.
     * A device cannot be deleted while such a payment, or a pending bill payment or bill refund it
     * started, is unresolved (`deleteDevice`).
     */
    "device.payment_in_progress": Record<string, never>;
    /**
     * A switch named a profile the device is not approved for: never approved, withdrawn since the
     * till last read the list, retired, of another form factor, or unknown.
     */
    "device_profile.not_approved": Record<string, never>;
    /** The person signed in on the device may not sign in on the profile they tried to switch to. */
    "device_profile.not_admitted": Record<string, never>;
    /** A manager approved, for a device, a profile of another form factor than its active one. */
    "device_profile.incompatible": { field: "approvedProfileIds" };
    /**
     * Accepting a device under a name another active device already has
     * (`devices_label_active_key`). The admin renames the device.
     */
    "device.name_taken": Record<string, never>;
    /** The venue's region fixes its receipt language; `language` is that fixed language, never the
     * caller's value. */
    "receipt.language_fixed": { field: "receiptLanguage"; language: string };
    /** A receipt-language change refused because `count` open orders hold a line. */
    "receipt.language_orders_open": { field: "receiptLanguage"; count: number };
    "receipt.not_printed": Record<string, never>;
    /**
     * A request named equipment the device may not newly choose: unknown, not on its profile's list
     * for the role, switched off, or an unavailable or unpaired reader
     * (`selectDeviceEquipment`). `field` carries the FIELD NAME only, never the id value.
     */
    "device.binding_invalid": { field: EquipmentField };
    /**
     * A list choice not confirmed as a takeover, or a manager's choice, named a portable item another
     * device holds. Names that device and the person signed in on it, if anyone.
     */
    "device.equipment_held": {
      field: EquipmentField;
      holderDeviceId: string;
      holderDeviceName: string;
      holderPersonName: string | null;
    };
    /**
     * A knock arrived at `POST /api/device/join` while pairing mode is shut, or after it shut during
     * the knock — the ordinary state, not an anomaly. NO params: nothing about the window is the
     * joiner's business.
     */
    "device.pairing_closed": Record<string, never>;
    /**
     * A renewal or a number check named a hold on the join window this server does not hold: it
     * lapsed, was released, or was taken before a restart. NO params.
     */
    "device.pairing_hold_lapsed": Record<string, never>;
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
    "recovery.rate_limited": Record<string, never>;
    /**
     * The admin tapped a number that is not this request's. The request is DELETED, not offered
     * again: a wrong tap denies, which is what makes one-in-three an acceptable guess rate.
     */
    "device.join_mismatch": Record<string, never>;
    /**
     * A knock proved it came from a disabled device's browser, but by the time its transaction ran
     * the device had changed: another knock from it had replaced its token, or Pair had enabled it.
     * The knock is refused with no new cookie, so the browser keeps the one it has; asking again is
     * the recovery. NO params.
     */
    "device.join_stale": Record<string, never>;
    /**
     * A node's own print agent asked to self-enrol against a row that was deliberately revoked;
     * self-enrol refuses rather than reactivating it, so a revoke sticks until an admin re-allows it.
     */
    "device.join_revoked": Record<string, never>;
    /**
     * No pending join request with that id — never existed, already accepted or denied, or lapsed.
     * The admin's recovery is the same in each case, and the joiner must knock again. Not one code
     * for all on the device accept route: there a well-formed id naming no pending request, which
     * this login holds no live claim on, answers `join_request.unclaimed` instead.
     */
    "join_request.not_found": Record<string, never>;
    /**
     * Another login matched this device request's number first and holds it while its Add dialog
     * stays open. NO params: the dashboard's list names who is pairing it from its next refresh.
     */
    "join_request.claimed": Record<string, never>;
    /**
     * The device approval route found no live claim of this login's on that id: this login never
     * matched the number, another login did, the id is a well-formed one naming no pending request (a
     * malformed id, or a print agent's pending request, answers `join_request.not_found` first), or the
     * match ended with the hold it was made under — which ends the request too, so the device must
     * ask again. NO params.
     */
    "join_request.unclaimed": Record<string, never>;
    /**
     * A self-signed server certificate was asked for with an empty `hostnames` list. The minter
     * refuses before generating a key.
     */
    "setup.cert_hostnames_empty": Record<string, never>;

    /** A setup or provisioning field cannot be used. Fiscal venue validators and the core and
     * catalogue configuration checks (`packages/db/src/configuration-transfer.ts`,
     * `packages/catalogue/src/configuration-transfer.ts`) also raise this code;
     * editing routes translate it to their own request error. `field` carries only the field name,
     * never its value, because certificate fields can contain credentials. */
    "setup.request_invalid": { field: string };
    "setup.mode_not_allowed": { environment: "production" } | { installationOrigin: "usb" };
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
     * Start again, or its summary, will not go ahead: the setup already finished, or the setup
     * database holds rows Waitron never deletes.
     */
    "setup.start_again_refused": { cause: "setup-finished" | "kept-records" };
    /** Start again was asked for over a connection that is not encrypted. */
    "setup.connection_insecure": Record<string, never>;
    /**
     * A manual open-drawer request found no active cash drawer choice on the requesting device (its
     * own, else its profile's default), so there is nothing to send the kick through. `deviceId`
     * names the device.
     */
    "drawer.no_printer": { deviceId: string };
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
    /** A mirror's promotion was asked for by a request not shown to come from the box itself;
     * refused before the body is read. */
    "promotion.from_box_only": Record<string, never>;
    /**
     * `retireSelf` was invoked on a node that is NOT fenced (serving, absent from the chart, or with
     * no membership document). Only a fenced node retires itself.
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
     * The box runs setup mode (it was reset, or never set up), so no management route exists.
     * Setup mode answers it to every `/management-api/*` and `/api/*` request, which a dashboard tab
     * left open still sends.
     */
    "node.reset": Record<string, never>;
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
     * An adopted mirror's standby identity was not established because this database holds no venue
     * row; nothing copies the main box's rows to a mirror yet.
     */
    "mirror.venue_not_copied": Record<string, never>;
    /**
     * A mirror was pointed at a primary of a different deployment environment. One database serves
     * one environment (CLAUDE.md §5); refused before adopt writes anything. `expected` is this box's
     * environment and `actual` the primary's.
     */
    "mirror.environment_mismatch": { expected: string; actual: string };
    /**
     * A mirror-bundle request carried a malformed STANDBY identity: `standbyNodeId` absent or not a
     * UUID, `standbyPublicKey` absent or empty, `standbyContactUrl` absent, not a string, or a
     * non-empty value that is not a bare http(s) origin, `standbyStoreUrl` not an `https` bare
     * origin at the contact URL's host (so an empty contact URL is refused), or `standbyAt` not a
     * number or not a time a `Date` can hold. Not
     * `password.invalid`: a bad identity is not a bad credential. The standby's key is not echoed.
     */
    "mirror.standby_invalid": Record<string, never>;
    /**
     * A joining box could not fetch, parse or check the bundle from the primary. Never carries the
     * upstream error's `.message`, which can embed a URL or connection detail.
     */
    "mirror.bundle_fetch_failed": Record<string, never>;
    /** No box but this one answered for another box's `.local` name within the time limit. */
    "mirror.peer_unresolved": Record<string, never>;
    /**
     * A box joining as a spare already holds a sealed vault row. Joining replaces its key ring with
     * the main box's, so that row would never open again; nothing has been written.
     */
    "mirror.vault_not_empty": Record<string, never>;
    /**
     * A spare was asked to join a main box over https before the person confirmed that box's
     * authority certificate, or with something other than one authority certificate as the
     * confirmed one; nothing was sent.
     */
    "mirror.primary_unconfirmed": Record<string, never>;
    /**
     * The membership document could not be written because every read-mint-write round lost its
     * term race. The mirror-bundle adopt handshake refuses rather than force a write that would drop
     * the winner's node from the chart; transient, so the caller retries. `attempts` is the round
     * bound, a constant of this process. A machine's removal (`removeUnjoinedStandby`) and
     * clearance (`clearRemovedMachine`) raise it the same way.
     */
    "membership.write_contended": { attempts: number };
    /**
     * The chart this box holds is too broken to read (`malformed`), or vouched for by no key it
     * stores itself (its own, or the main box's it pinned). The first comes only from a fault; the
     * second also from a Cloud peer, or, in a venue of three or more boxes after two promotions, a
     * main box that no key this box trusts vouched for, which the backlog records. Screens show the
     * generic text.
     */
    "membership.held_untrusted": { reason: VerifyFailure };
    /**
     * An admin asked to remove or clear a machine this node's held membership chart lists neither
     * among its machines nor as cleared, or no chart is held.
     */
    "membership.node_not_found": Record<string, never>;
    /** Only the chart's serving primary removes or clears a machine, and this node is not that. */
    "membership.not_primary": Record<string, never>;
    /** The machine asked to be removed or cleared is the serving primary, this node. */
    "membership.node_is_primary": Record<string, never>;
    /** The machine asked to be removed is a former primary (`sell-only`), so it has served. */
    "membership.node_has_served": Record<string, never>;
    /** The standby asked to be removed has a `nodes` row in this database, so it finished joining. */
    "membership.standby_joined": Record<string, never>;
    /**
     * The machine asked to be cleared is not removed (`evicted`): only a removed machine's place in
     * the chart can be freed.
     */
    "membership.node_not_removed": Record<string, never>;
    /**
     * A mirror-bundle request named a standby node id this node's held chart lists as `evicted` or
     * has cleared. A fresh join mints a fresh id.
     */
    "mirror.standby_removed": Record<string, never>;
    /**
     * A mirror-bundle request named a standby node id this node's held chart does not list, and
     * the chart already lists `limit` (MAX_NODES) machines, the most a chart may hold. Clearing a
     * removed machine frees a place.
     */
    "mirror.membership_full": { limit: number };
    /** A spare asked to join while this box's pair link already streams to a joined spare. */
    "mirror.spare_already_joined": Record<string, never>;
    /** A spare asked to join while this venue streams to a bucket; a venue streams to one place. */
    "mirror.bucket_stream_active": Record<string, never>;
    /** A joining spare's box name is already a listed box's; a fresh join draws a new node id. */
    "mirror.standby_name_taken": Record<string, never>;
    /** The two boxes' clocks, both given as ISO times, are 10 minutes or more apart. */
    "mirror.clocks_apart": { primaryAt: string; standbyAt: string };
    /**
     * The venue enables `module`, whose standby series are allocated only at activation under
     * authority a join does not carry, so this version cannot add a spare to the venue. The main
     * box refuses the join before reserving anything, a spare refuses a bundle naming such a
     * module before writing anything, and an adoption left pending refuses to finish.
     */
    "mirror.standby_series_unsupported": { module: string };
    /** A secret file's path, from a backup archive being restored, would land outside the state
     * folder or on a first-setup host file. */
    "recovery.archive_path_unsafe": Record<string, never>;
    "recovery.pack_invalid": { reason: string };
    /** A recovery pack was asked for over a connection that is not encrypted. */
    "recovery.pack_connection_insecure": Record<string, never>;
    /** A recovery pack was asked for by a page on another site (`Origin` or `Sec-Fetch-Site`). */
    "recovery.pack_origin_refused": Record<string, never>;
    /** The box is missing one of its own persisted secret files, so a complete backup archive
     * cannot be built. `missing` is the state-dir-relative path (e.g. `secrets.env`). A server
     * fault, not a client error: the box has lost part of its own unrecoverable state. */
    "recovery.state_incomplete": { missing: string };
    /** A `reload()` on `BackupSupervisor` or `StreamHost` was called while another reload on the
     * same object was still in flight; the second is refused rather than allowed to interleave its
     * teardown with the first. */
    "backup.reload_in_progress": Record<string, never>;
    /** Start the copy again was asked while the copy is refused because another box was found
     * writing this venue's copy to the same bucket (`pointer_changed`, `pointer_newer_term`). */
    "backup.stream_held_by_another_box": Record<string, never>;
    /** Saving bucket settings was asked while this box holds a pair link: the venue copies to its
     * standby. */
    "backup.spare_stream_active": Record<string, never>;
    /** WAITRON_BACKUP_RECOVERY_KEY is unset where one is needed: a backup destination is configured
     * (refused at load so an unattended backup can never write an unencrypted or box-key-encrypted
     * artifact), or a recovery pack's bucket or archives page is drawn
     * (`backup-recovery-pack-parts.ts`), where it fails that page alone. */
    "backup.recovery_key_missing": Record<string, never>;
    /** WAITRON_BACKUP_RECOVERY_KEY is shorter than `min` characters. */
    "backup.recovery_key_too_short": { min: number };
    /** WAITRON_BACKUP_DESTINATIONS is not a valid JSON array of destination descriptors. */
    "backup.destinations_invalid": { reason: string };
    /** A box's backup settings this box would not write as its `backup.env`: a name outside
     * `WAITRON_BACKUP_`, a value that is not text, or one the file would not keep. `reason` names
     * the check and never a value, which may be the backup recovery key. */
    "spare.settings_invalid": { reason: string };
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
     * A backup admin route (`apply`/`disable`/`rotate`), or the bucket copy's Save on a box holding no
     * recovery key, was refused because a variable `BACKUP_ENV_KEYS` (`backup-config.ts`) lists is
     * set in the environment. The environment then owns this box's backup settings, and the server
     * does not write `backup.env` beside it. No params: an env var could hold the recovery key. */
    "backup.managed_by_environment": Record<string, never>;
    /**
     * A backup admin route (`apply`/`disable`/`rotate`) or the bucket copy's Save or switch-off was refused
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
     * `rotate` wrote the new key to `backup.env`, then failed to store the archive settings' new
     * revision. The new key is in effect and is never put back; only the revision is stale, and the
     * rotation time and fingerprint still tell an old recovery pack apart. `keyFingerprint` is the
     * key's 8-hex fingerprint, never the key. `reloadErrorCode` is set when the reload that followed
     * failed too, and `sealedState` when re-locking this node's state did not seal. */
    "backup.rotation_metadata_failed": {
      effectiveKeyChanged: true;
      keyFingerprint: string;
      keyRotatedAt: string;
      reloadErrorCode?: string;
      sealedState?: "no_key" | "failed";
    };
    /**
     * A backup admin route body failed shape validation before any write; or `field: "config"` when
     * `disable` finds no stored archive record, or `rotate` finds no readable archive record, no
     * destination loaded and no key held. `field`
     * names the offending field, never the value, which could be the recovery key. */
    "backup.request_invalid": { field: string; reason?: string; scratchRoot?: string };
    "backup.stream_test_failed": { reason: ProbeFailure };
    /** Archives in the stream's bucket were asked for while no bucket is configured. */
    "backup.stream_not_configured": Record<string, never>;
    /** The stored archive settings (`backup.archive`) are not a record this server wrote.
     * `reason` names the part that failed, never its value, which could be a secret. */
    "backup.archive_settings_invalid": { reason: string };
    /** A stored archive record could not be read. `disable` has no settings to keep switched off,
     * the bucket copy's Save (`PUT /api/backup/stream`) cannot check its folder against the
     * archive's, and a recovery pack's archives page (`backup-recovery-pack-parts.ts`) fails; an
     * archive Save replaces the record. `reason` is the read's error code, never the
     * record. */
    "backup.archive_settings_unreadable": { reason: string };
    /** The bucket copy's stored settings (`backup.stream`) could not be read, so an archive Save
     * choosing a bucket cannot check or reuse them; `PUT /api/backup/stream` replaces the record.
     * `reason` is the read's error code, never the record. */
    "backup.stream_settings_unreadable": { reason: string };
    /** An archive bucket's folder for this venue would sit inside, or contain, the stream's venue
     * folder in the same bucket. No params: they would be the owner's bucket settings. */
    "backup.archive_namespace_overlap": Record<string, never>;
    /** An archive recovery pack (`archive-recovery-pack.ts`) held no token (`not_found`), more
     * than one token (`several`), a token that is not base64url JSON (`encoding`), or not exactly a
     * pack this server issues (`shape`). Never carries a field's value: the pack holds the bucket's
     * secret key and the recovery key. */
    "backup.archive_recovery_pack_invalid": {
      reason: "not_found" | "encoding" | "shape" | "several";
    };
    /** Save's test of an archive bucket — write, read back, list and delete one object — failed or
     * ran out of time. `reason` is a code, or `timed_out`, `read_mismatch` or `not_listed`; never
     * the provider's message. */
    "backup.archive_test_failed": { reason: string };
    /** A recovery pack's bucket page was drawn on a node with no membership public key
     * (`nodes.public_key`), so a rebuild could not verify the pointer this node signs. */
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
    /** No incident with this id exists in this venue. Also answered for a malformed id, to a
     * session that can see no alerts, to a note sent for an alert whose code takes none, and by the
     * wrongly dated sales download for an id that names no such alert with a list. */
    "alert.not_found": { id: string };
    /** A note came with marking an incident handled that was already handled, so it was not saved. */
    "alert.already_handled": { id: string };
    /** A note was sent for an incident that already has one; the first is kept. */
    "alert.note_exists": { id: string };
    /** A note was sent for an incident not yet marked handled. */
    "alert.not_handled": { id: string };
    /** An alert source failed while being read. Its alerts are replaced by this one, under the
     * source's own area and permission. Built as data, never thrown. */
    "alert.source_unavailable": { area: string };
    /** A backup destination's newest good backup is older than the stale threshold, it holds no
     * archive, or it could not be listed. `destination` is the backend id (never a secret). Built as
     * data by the backups alert source, never thrown. */
    "backup.destination_overdue": { destination: string };
    /** A backup destination's most recent attempt failed. `destination` is the backend id (never a
     * secret). Built as data by the backups alert source, never thrown. */
    "backup.destination_failed": { destination: string };
    /** The most recent backup run stopped before reaching any destination; `errorCode` is the code
     * it threw, `unknown` for an error that is not an AppError. `spaceLow` is set only when
     * `errorCode` is `backup.staging_space_low`; `neededBytes` and `availableBytes` only then too,
     * from that error's params.
     * Built as data by the backups alert source, never thrown. */
    "backup.run_stopped": {
      errorCode: string;
      spaceLow?: true;
      neededBytes?: number;
      availableBytes?: number;
    };
    /** A small object put to a bucket destination, or read from any destination, is larger than
     * `maxBytes` (`SMALL_OBJECT_MAX_BYTES`, `storage-backend.ts`). */
    "backup.destination_object_too_large": { maxBytes: number };
    /** A call to one destination did not finish within `timeoutMs`: an upload plus
     * its pruning (`WAITRON_BACKUP_DESTINATION_TIMEOUT_MS`), or a status listing
     * (`STATUS_READ_TIMEOUT_MS`, `backup-status.ts`). */
    "backup.destination_timed_out": { timeoutMs: number };
    /** The backup staging folder's filesystem reported fewer than `neededBytes` free, so the tick
     * stopped before writing more there. `neededBytes` is what the step needed: from a room step
     * (before the copy, and after encrypting), the need plus the free-space floor; from the check
     * right after the copy, the copy's size. `availableBytes` is what it reported. `afterDeleting`
     * is set only by a room step: false when it refused before deleting anything, true when it
     * refused on the reading taken after its deletions (or after a deletion failed). */
    "backup.staging_space_low": {
      neededBytes: number;
      availableBytes: number;
      afterDeleting?: boolean;
    };
    /** A backup run deleted `count` of its oldest backups to make room for itself; `date` and
     * `lastDate` are the venue's calendar days the oldest and newest of them were taken,
     * `YYYY-MM-DD`, and `severalDays` says they differ. Recorded as an incident, never thrown. */
    "backup.archives_deleted": {
      count: number;
      date: string;
      lastDate: string;
      severalDays: boolean;
    };
    /** A destination's work was stopped because the backup duty stopped or reloaded. A
     * cancellation, never recorded as the destination failing. */
    "backup.destination_cancelled": Record<string, never>;
    /** Neither an archive destination nor a bucket copy that is on and current: no copy of the data
     * is being kept. Built as data by the backups alert source, never thrown. */
    "backup.disabled": Record<string, never>;
    /** The dashboard's stored archive settings could not be read or used, so archives are off.
     * Built as data by the backups alert source, never thrown. */
    "backup.archive_settings_unusable": Record<string, never>;
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
     * is out of date or missing. `errorCode` is the failure's cause, `unknown` when unnamed. Built
     * as data by the sealed-state alert source, never thrown. */
    "backup.sealed_state_failed": { errorCode: string };
    /** The box's disk fell below `SPACE_LOW_BYTES` (`free-space-watch.ts`) free and no reading
     * since has reached `SPACE_OK_BYTES`. `freeBytes` is the latest reading. Built as data by the
     * box alert source, never thrown. */
    "storage.space_low": { freeBytes: number };
    /** Two or more fresh devices agree with each other that the box's clock is more than a minute
     * off. `deviceAt` is the box's time moved by their mean difference. Built as data by the
     * clock-disagrees alert source, never thrown. */
    "clock.disagrees": { count: number; deviceAt: string; boxAt: string };
    /** The box's time service is switched off (`off`), on with no time unit running (`stopped`),
     * running but not synchronised (`unsynchronised`), or the box's clock service did not answer in
     * production (`unreachable`). Built as data by the clock-sync alert source, never thrown. */
    "clock.sync_off": { reason: "off" | "stopped" | "unsynchronised" | "unreachable" };
    /** The box did not set or confirm its clock from an administrator's device or a till, and
     * asked its host to set nothing: the request came from the box itself, no stop holds, the host
     * service did not answer, the time service says the clock is synchronised, AEAT has spoken
     * during the stop, the person's device is within a minute of the box (`agrees`),
     * the device's time was measured before a step of the box's clock, the time would be before
     * 28-10-2024 or from 2100 on (`target_invalid`), the readings taken before an earlier step are
     * not yet recorded (`pending_disproofs`), a till asked the box to keep its time while a stop
     * holds (`stopped`), or, for a staff member on a till, the box's start-up is over
     * (`not_start_up`) or AEAT has not yet been asked (`authority_pending`). */
    "clock.set_refused": {
      reason:
        | "same_machine"
        | "stopped"
        | "not_stopped"
        | "not_start_up"
        | "authority_pending"
        | "host_unavailable"
        | "synchronised"
        | "witnessed"
        | "agrees"
        | "stale"
        | "target_invalid"
        | "pending_disproofs";
    };
    /** The box asked its host to set the clock: `refused`, the clock moved by a second or less;
     * `unverified`, it moved further, but the box could not confirm it landed where it was asked
     * to. */
    "clock.set_failed": { reason: "refused" | "unverified" };
    /** The box has not confirmed its time since this start, so it writes no fiscal record and
     * takes or gives back no money until the time service, two devices or a person confirms it. */
    "clock.unconfirmed": Record<string, never>;
    /** The box's host service cannot take this request: `missing`, no connection to its socket
     * was made (`detail` is the connection error's code); `unsupported`, the host does not take the
     * request (`detail` is the host's word). */
    "box_host.unavailable":
      | { reason: "missing"; detail: string }
      | { reason: "unsupported"; detail: "unknown_request" | "request_invalid" };
    /** The box's host service failed a request: the connection was lost, timed out or answered
     * something unreadable, or the host refused it with one of the protocol's own words. */
    "box_host.failed": {
      reason:
        | "lost"
        | "timeout"
        | "malformed"
        | "request_invalid"
        | "actor_invalid"
        | "fields_invalid"
        | "host_failed";
    };
    /** The network and screen routes already have as many requests open to the box's host service
     * as they allow, so this one was not sent. */
    "box_host.busy": Record<string, never>;
    /** The box's host service answered `busy` to a scan, join or forget. */
    "box_network.busy": Record<string, never>;
    /** The box's host service answered `no_wifi` to a scan or join. */
    "box_network.no_wifi": Record<string, never>;
    /** The box's host service answered `not_saved` to a forget: the network named is not the one
     * the box has saved. */
    "box_network.not_saved": Record<string, never>;
    /** The Wi-Fi password breaks the host protocol's rules for its key type, so nothing was sent
     * to the host. */
    "box_network.password_invalid": { field: "psk"; keyMgmt: "wpa-psk" | "sae" };
    /** A Wi-Fi join was not sent over an encrypted connection from the box's own page. */
    "box_network.join_connection_insecure": { reason: "unencrypted" | "other_origin" };
    "restore.request_waiting": Record<string, never>;
    "restore.flow_unreadable": Record<string, never>;
    "restore.administrator_password_missing": Record<string, never>;
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
     * An archive entry name is unsafe, repeats a destination already named in the archive, names
     * a destination that already exists as a folder (or a link to one), or names a secret ending
     * in a suffix the restore gives its own working files (`.incoming`, `.restore-previous`,
     * `.tmp`, `.replaced`).
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
     * hooks need (`WAITRON_NODE_ID`; an empty value is
     * missing). Validation refuses with the target intact, before identity set-aside or database
     * restore. `missing` is the fixed key or file name. */
    "restore.identity_incomplete": { missing: string };
    /** The artifact's identity names a node the restored database does not hold, or the restored
     * copy holds no taxpayer row, no venue row, or more than one venue row. */
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
    "restore.stream_pointer_unverified": {
      reason: "signature" | "venue_mismatch" | "key_or_access";
    };
    /** The live generation received a change within the last ten minutes on the bucket's own
     * clock, so the old box may still be selling; refused until the operator confirms it is gone.
     * `lastChangeAt` is an ISO time on the bucket's clock. */
    "restore.stream_source_live": { lastChangeAt: string };
    /** Whether the old box is still writing could not be checked: the difference between this
     * box's clock and the bucket's could not be measured (`clock`), or — an archive whose database
     * holds bucket settings — the bucket could not be read (`bucket`). Refused until the operator
     * confirms the old box is gone. */
    "restore.stream_source_unchecked": { reason: "clock" | "bucket" };
    /** The restored copy is a venue the operator has not confirmed: its legal name, tax id and
     * venue name, which the operator must recognise before anything is staged. */
    "restore.stream_venue_unconfirmed": { legalName: string; taxId: string; venueName: string };
    /** SQLite's integrity or foreign-key check found the restored copy damaged, or the copy could
     * not be opened. Carries no SQLite text, which can name paths. */
    "restore.stream_integrity_failed": Record<string, never>;
    /** The restored copy holds no sealed state row for the node the pointer names, so the box's
     * vault key and certificate authority cannot come back with it. */
    "restore.stream_state_missing": { nodeId: string };
    /** The disk filled while the copy was being downloaded from the bucket. */
    "restore.stream_disk_full": Record<string, never>;
    /** The archive named for a restore is not a name an archive is stored under, so nothing was
     * asked of the bucket. */
    "restore.archive_key_invalid": Record<string, never>;
    /** The pack's archive folder holds no archive by the name given. */
    "restore.archive_missing": Record<string, never>;
    /** A restore's clock request names a staged backup copy this box no longer holds. The page
     * uploads the backup again under the same restore event. A copy another upload replaced since
     * the server started, among the last 64 replaced, is refused as `setup.request_invalid`
     * instead. */
    "restore.staged_copy_missing": Record<string, never>;
    /** The staging folder has too little free space for the archive, or the disk filled while it
     * was being downloaded. */
    "restore.archive_disk_full": Record<string, never>;
    /** Downloading the archive did not finish: it was cancelled or ran out of time (`timed_out`),
     * the bucket refused or failed a request (`request_failed`), or anything else (`failed`).
     * Carries no key, path or bucket text. */
    "restore.archive_download_failed": { reason: "timed_out" | "request_failed" | "failed" };
    // The server's working-order paths throw these contributed venue-service codes directly.
    "order.service_context_missing": { workingOrderId: string };
    "service_zone.mode_incompatible": {
      zoneId: string;
      expected: string;
      actual: string;
    };
    /** Join tables refuses a table in a service zone other than the party's, when both have one. */
    "service_zone.join_mismatch": { orderZoneId: string; tableZoneId: string };
    /** Raised by `raiseDishesNotSent` (`./dish-not-sent-alert.ts`). */
    "route.dish_not_sent": {
      dishes: string;
      workingOrderId: string;
      orderNumber: number;
      orderLabel: string | null;
    };
    /** Raised by the release alert for held work left at a closed station. */
    "route.released_at_closed_station": {
      station: string;
      dishes: string;
      workingOrderId: string;
      orderNumber: number;
      orderLabel: string | null;
    };
    /** Raised by the release alert for work at a closed station that waits for the pass. */
    "route.waiting_at_closed_station": {
      station: string;
      dishes: string;
      workingOrderId: string;
      orderNumber: number;
    };
  }
}

/** The request field naming each equipment role. */
export type EquipmentField =
  | "receiptPrinterId"
  | "paymentSlipPrinterId"
  | "cashDrawerPrinterId"
  | "invoicePrinterId"
  | "cardReaderId";
