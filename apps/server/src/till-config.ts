// Keeps this package's `errors.ts` augmentation reachable from every file that throws one of its
// codes — the reachability convention `config.ts` and `webhook.ts` follow (a side-effect import, no
// value used here). See the note atop `errors.ts`.
import "./errors.js";
import { eq } from "drizzle-orm";
import { AppError, locationId, nodeId, seriesId, tenantId, tillId } from "@waitron/shared";
import type { LocationId, NodeId, SeriesId, TenantId, TillId } from "@waitron/shared";
import { asAppUser, locations, orderFlow, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";

/**
 * The per-venue pay-timing / service mode (design §3), the union of the `order_flow` enum's values —
 * derived from `@waitron/db`'s `orderFlow` pgEnum so the two can never drift (add a mode to the enum
 * and this widens with it). `prepay` pays + issues at ORDER (open → settled, no placed state);
 * `invoice_first` issues a deferred invoice at PLACE and settles it at COLLECT (open → placed →
 * settled); `ticket_then_pay` files no fiscal doc at PLACE and files + settles at COLLECT
 * (open → placed → settled). It decides WHICH issuance primitive fires and WHEN — a wrong dispatch
 * files the wrong kind of unrepairable fiscal record (§5), which is why it rides on the till's config.
 */
export type OrderFlow = (typeof orderFlow.enumValues)[number];

/**
 * Which card-payment provider this till drives, if any (integrated card terminal, sub-project 7).
 * Per-NODE config (a node runs one till hardware setup), read from the environment provisioning
 * stamped: `none` is a till with no integrated terminal (cash + the manual "datáfono" card tender
 * only), `stripe_terminal` drives a specific server-side Stripe reader by id, and `stripe_on_device`
 * is the handheld Tap-to-Pay flow that mints its own connection token. It selects which
 * `PaymentProvider` (if any) `boot.ts` builds and which pay control the till UI renders (Task 8), so
 * it rides on the till's config beside the fiscal ids.
 */
export type CardProvider = "none" | "stripe_terminal" | "stripe_on_device";

/**
 * The deployed till's identity, resolved once at boot from the environment provisioning stamped it
 * with. The four fiscal ids are branded (a bare uuid string cannot be passed where one of these is
 * expected), and `locationId` rides alongside because the sale path needs it: `recordTillSale`
 * (Task 3) and `GET /api/products` (Task 6) both call `listAvailableProducts(tx, locationId)`, so
 * the config the till carries has to include the location it sells from, not just its fiscal keys.
 *
 * `locale` / `invoiceLocales` are display-side: the till's own UI locale and the set of locales its
 * invoices are rendered in. One entry today (there is a single till locale), a list so the invoice
 * renderer never has to change shape when a second is added.
 */
export interface TillConfig {
  tenantId: TenantId;
  tillId: TillId;
  nodeId: NodeId;
  seriesId: SeriesId;
  locationId: LocationId;
  locale: string;
  invoiceLocales: string[];
  /**
   * Which integrated card-payment provider this till drives (`WAITRON_TILL_CARD_PROVIDER`), or
   * `none`. Unlike the fiscal ids and `orderFlow`, this is env-only (there is no per-location card
   * column), so `loadTillConfig` resolves it directly. `boot.ts` reads it to build the one
   * `PaymentProvider` this till's tenant needs (or none), and `GET /api/till` echoes it so the client
   * selects the card-collect route + UI affordances (Task 8).
   */
  cardProvider: CardProvider;
  /**
   * The server-side Stripe reader this till drives (`WAITRON_TILL_STRIPE_READER_ID`). Present iff
   * `cardProvider === "stripe_terminal"` — `loadTillConfig` REQUIRES it there and leaves it absent
   * otherwise: a server-driven reader is named by id, while `stripe_on_device` mints its own
   * connection token and has no server-side reader to name.
   */
  stripeReaderId?: string;
  /**
   * Whether the till offers a tip prompt at card collect (`WAITRON_TILL_TIPS`). Default false; only
   * the literal `"true"` or `"1"` enable it, so a typo fails safe (off). `GET /api/till` echoes it so
   * the client shows or hides the tip affordance (Task 8).
   */
  tipsEnabled: boolean;
  /**
   * The venue's pay-timing / service mode, read from the till's LOCATION rather than the environment
   * (the env carries no `order_flow` — the location does), so it is NOT set by `loadTillConfig` and is
   * merged in by `boot.ts` via `readOrderFlow` once the pool is open. That is why `loadTillConfig`
   * returns `Omit<TillConfig, "orderFlow">`: the type forbids reading this off the env-only identity
   * before the DB read has supplied its real value, so a wrong-mode dispatch cannot slip in from a
   * placeholder default (§5 — the mode decides which unrepairable fiscal record is filed).
   */
  orderFlow: OrderFlow;
}

/**
 * The value of `key`, or a loud failure. "Unset" is absent OR the empty string — an operator's
 * `VAR=` (as opposed to omitting the line) must be reported as missing, not accepted as a value that
 * will then fail the uuid check with a less honest code. Only the variable NAME travels in the
 * error, never the value.
 */
function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new AppError("server.till_config_missing", { key });
  }
  return value;
}

/**
 * Runs a branded-id constructor over `raw`, translating its `shared.invalid_id` throw into
 * `server.till_config_invalid` naming the env var. The value that failed is deliberately dropped on
 * the floor here: the operator needs to know WHICH variable is malformed, and echoing a possibly-
 * secret value into an error is the leak `errors.ts` documents this code avoiding.
 */
function brand<T>(key: string, fn: (value: string) => T, raw: string): T {
  try {
    return fn(raw);
  } catch {
    throw new AppError("server.till_config_invalid", { key });
  }
}

/**
 * Resolve the till's fiscal identity (+ location and locale) from the environment, failing loudly on
 * any missing or malformed value. Every id is required and branded; `WAITRON_TILL_LOCALE` is the one
 * optional value, defaulting to `es-ES`.
 *
 * Returns `Omit<TillConfig, "orderFlow">`: `order_flow` is a per-LOCATION column, not an env var, so
 * it cannot be resolved here without a database. `boot.ts` reads it via `readOrderFlow` once the pool
 * is open and spreads it in to form the full `TillConfig` the routes receive (see this file's
 * `orderFlow` field comment for why the omission is deliberate and type-enforced).
 */
export function loadTillConfig(env: NodeJS.ProcessEnv): Omit<TillConfig, "orderFlow"> {
  // "Unset" is absent OR the empty string — the same rule `required` applies to the ids, so an
  // operator's `WAITRON_TILL_LOCALE=` line falls back to the default rather than pushing an empty
  // locale into `invoiceLocales` (which downstream invoice rendering consumes). A bare `?? "es-ES"`
  // would only catch `undefined`.
  const rawLocale = env.WAITRON_TILL_LOCALE;
  const locale = rawLocale === undefined || rawLocale === "" ? "es-ES" : rawLocale;

  // The integrated card terminal (sub-project 7). Same "absent OR empty is unset" rule the ids use,
  // so a `WAITRON_TILL_CARD_PROVIDER=` line falls back to `none` rather than reaching the invalid
  // branch. An unrecognised value is `server.till_config_invalid` (naming the variable, never the
  // value — the no-leak discipline the id-branding path already follows).
  const rawProvider = env.WAITRON_TILL_CARD_PROVIDER;
  const cardProvider: CardProvider =
    rawProvider === undefined || rawProvider === ""
      ? "none"
      : rawProvider === "stripe_terminal" ||
          rawProvider === "stripe_on_device" ||
          rawProvider === "none"
        ? rawProvider
        : (() => {
            throw new AppError("server.till_config_invalid", { key: "WAITRON_TILL_CARD_PROVIDER" });
          })();
  // A server-driven reader is named by id and REQUIRED; on-device mints its own connection token, so
  // it carries no reader id. `required` throws `server.till_config_missing` (naming the variable) on
  // an absent or empty value, exactly as it does for the fiscal ids.
  const stripeReaderId =
    cardProvider === "stripe_terminal" ? required(env, "WAITRON_TILL_STRIPE_READER_ID") : undefined;
  // Only the literal "true" or "1" enable tips; anything else (including a typo) fails safe to off.
  const rawTips = env.WAITRON_TILL_TIPS;
  const tipsEnabled = rawTips === "true" || rawTips === "1";

  return {
    tenantId: brand("WAITRON_TILL_TENANT_ID", tenantId, required(env, "WAITRON_TILL_TENANT_ID")),
    tillId: brand("WAITRON_TILL_TILL_ID", tillId, required(env, "WAITRON_TILL_TILL_ID")),
    nodeId: brand("WAITRON_TILL_NODE_ID", nodeId, required(env, "WAITRON_TILL_NODE_ID")),
    seriesId: brand("WAITRON_TILL_SERIES_ID", seriesId, required(env, "WAITRON_TILL_SERIES_ID")),
    locationId: brand(
      "WAITRON_TILL_LOCATION_ID",
      locationId,
      required(env, "WAITRON_TILL_LOCATION_ID"),
    ),
    locale,
    invoiceLocales: [locale],
    cardProvider,
    // Omit the key entirely when absent (rather than materialising `stripeReaderId: undefined`), so
    // the optional field stays truly absent for a non-terminal provider — the shape the config tests'
    // `toEqual` pins.
    ...(stripeReaderId === undefined ? {} : { stripeReaderId }),
    tipsEnabled,
  };
}

/**
 * Read the venue's pay-timing mode from the till's own LOCATION row — the DB half of the config
 * `loadTillConfig` cannot resolve from the environment. Runs as the app role under the till's tenant
 * (`withTenant` + `asAppUser`), so RLS scopes the lookup to this tenant and the `eq(id)` filter
 * selects exactly the till's own location. Called ONCE at boot (`boot.ts`), not per request: the mode
 * is provisioning-time config, stable for the process lifetime, so re-reading it on every place/collect
 * would be a needless round trip on the till's hottest path.
 */
export async function readOrderFlow(
  db: Database,
  cfg: Pick<TillConfig, "tenantId" | "locationId">,
): Promise<OrderFlow> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const [row] = await tx
      .select({ orderFlow: locations.orderFlow })
      .from(locations)
      .where(eq(locations.id, cfg.locationId));
    /* v8 ignore start */
    if (row === undefined) {
      // Structurally unreachable: provisioning stamped this till with its own location, so the row
      // always exists and RLS returns it. A till pointed at a nonexistent location is a
      // misconfiguration that fails loudly at boot rather than dispatching against a guessed mode.
      throw new Error(`readOrderFlow: no location ${cfg.locationId}`);
    }
    /* v8 ignore stop */
    return row.orderFlow;
  });
}
