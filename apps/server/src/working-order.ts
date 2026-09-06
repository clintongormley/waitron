// Side-effect only: keeps this host's `sale.*` codes (errors.ts) reachable from the file that throws
// them — the reachability convention `till-sale.ts`/`till-config.ts` follow (a bare import, no value
// used here). See the note atop `errors.ts`.
import "./errors.js";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import {
  AppError,
  classifyBand,
  compareDecimal,
  decimal,
  MONEY_SCALE,
  multiplyDecimal,
  type SaleId,
  type StationThresholds,
  subtractDecimal,
  type TillId,
  type TimingBand,
  toScale,
  workingOrderId as brandWorkingOrderId,
  worstBand,
} from "@waitron/shared";
import {
  allocateOrderNumber,
  appendOrderAmendment,
  asAppUser,
  categories,
  DEFAULT_TIME_ZONE,
  diningTables,
  DONENESS,
  invoiceSeries,
  isUniqueViolation,
  kitchenCourses,
  kitchenStations,
  optionGroupItems,
  products,
  sales,
  ticketItems,
  ticketState,
  withTenant,
  workingOrderLines,
  workingOrders,
  workingOrderStatus,
} from "@waitron/db";
import type { AllergenMap, Database, Doneness, Transaction } from "@waitron/db";
import {
  deriveAsServedAllergens,
  deriveAsServedDiet,
  listAvailableProducts,
  priceBasket,
  priceBasketWithOptions,
  priceLockedLines,
  toInvoiceLineDescriptions,
} from "@waitron/catalogue";
import type {
  BasketItemWithOptions,
  DietaryOrigin,
  DietDerivation,
  DietOverride,
  DietProfile,
  LockedLine,
  OptionOriginOverlay,
  PricedLines,
  ProductAllergens,
} from "@waitron/catalogue";
import { formatInvoiceNumber, recordSale } from "@waitron/core";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { FloorTableShape } from "./tables.js";
import { requireCourse, requireLiveCourse } from "./kitchen.js";
import { enqueueCorrectionSlips, enqueueKitchenTickets } from "./kitchen-print.js";
import { requireNullableString } from "./request-screens.js";
import { isUuid } from "./till-session.js";
import type { TillConfig } from "./till-config.js";

export interface WorkingOrderDeps {
  db: Database;
}

/**
 * The fuller till dependency bundle — `db` plus the `backend`/`clock` a FISCAL FILE needs. `placeOrder`
 * (Mode-I deferred invoice) and `cancelPlacedOrder` (the amendment's trusted clock) take it here, and
 * every `till-sale.ts` filing path (`payWorkingOrder`, `collectOrder`, `fileImmediateSale`,
 * `recordTillSale`) takes it too. It lives in this lower-level module — beside {@link WorkingOrderDeps},
 * the `db`-only subset for the non-filing operations (park, list, retrieve, update, abandon, advance) —
 * so `till-sale.ts` imports it from here, keeping the module dependency ONE-directional (no import cycle).
 */
export interface TillSaleDeps {
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
}

/** The rows a park or an update writes into `working_order_lines`, as Drizzle types the insert. */
type WorkingOrderLineInsert = typeof workingOrderLines.$inferInsert;

/** `priceBasketWithOptions`'s authoritative result (`{ lines, total, vatBreakdown }`) — threaded out of
 * `priceOrderLines`/`createOpenOrder` so a caller that both persists the order AND files its sale in
 * the same transaction (a walk-up, `payWorkingOrder`) reuses this price rather than re-reading the
 * catalogue and re-pricing the identical basket a second time. Same shape as plain `priceBasket`'s
 * result (both return `PricedLines`); this alias just names the one `priceOrderLines` actually calls. */
type PricedBasket = PricedLines;

/**
 * Per-line customisation carried on the wire and threaded through every order path (spec §2/§3): a
 * free-text kitchen `note` and, for a meat product, a `doneness`. BOTH ARE NON-FISCAL — validated and
 * persisted server-side on the parent dish line (and snapshotted onto its ticket item at fire), and
 * NEVER threaded into any sale/fiscal projection or huella. Intersected into each request/parameter
 * line shape so the field pair (and this rationale) is declared ONCE rather than re-copied per site.
 */
export type LineExtras = { note?: string; doneness?: Doneness };

/**
 * Price requested lines from this location's sellable catalogue. Return both the
 * insertable line snapshots and the basket result so a caller filing the same basket
 * can reuse it. Stored gross unit prices preserve the price agreed at add time.
 */
async function priceOrderLines(
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
  // KDS-2 (§2b): each line MAY carry an optional `courseId` OVERRIDE. Absent = fall to the product's
  // default course; present (incl. `null`) = the line-level override. Only the tab round-send threads a
  // value today (a future course picker); park/update pass none, so their lines take the product default.
  // Ordering modifiers (Task 6): a line MAY carry selected `options`, each naming an
  // `optionGroupItemId` chosen from one of the product's attached ACTIVE option groups. The server
  // resolves + validates every selection against the product's own `optionGroups` (the SAME read below
  // returns — no extra query), then expands the line into a PARENT dish row plus one CHILD row per
  // option. Absent/empty `options` = a plain single line, unchanged from before. Per-option quantity:
  // an option MAY carry `quantity` (a small positive integer, absent = 1) — the count of THIS option
  // per dish, capped by the item's `max_quantity`; the child is priced at `dishQty × optionQty`.
  //
  // Per-line customisation (`LineExtras`, spec §2/§3): a line MAY carry a free-text `note` and a
  // `doneness`. Both are NON-FISCAL. The note is trimmed and length-capped (`working_order.note_too_long`);
  // the doneness is validated against the enum (`working_order.invalid_doneness`). Both attach to the PARENT dish
  // line only — a child modifier row carries neither. Absent = NULL (not chosen); a whitespace-only
  // note folds to NULL.
  lines: ({
    productId: string;
    quantity: string;
    courseId?: string | null;
    options?: { optionGroupItemId: string; quantity?: number }[];
  } & LineExtras)[],
): Promise<{ lineRows: WorkingOrderLineInsert[]; priced: PricedBasket }> {
  if (lines.length === 0) {
    // An empty basket needs no catalogue read: nothing to resolve, no course override to screen, nothing
    // to price. priceBasket([]) yields the correct empty PricedBasket shape (a pure call, no DB), so every
    // splitOffCheck / lineless openTab / unjoin skips the full listAvailableProducts scan they used to pay
    // for. Callers passing [] ignore `priced` (they persist no lines); it is returned only for type-consistency.
    return { lineRows: [], priced: priceBasket([]) };
  }
  const { products: available, invoiceLocales } = await listAvailableProducts(tx, cfg.locationId);
  const byId = new Map(available.map((p) => [p.id, p]));

  // Build the priceable basket AND, in lockstep, the per-PRICED-LINE metadata `priceBasketWithOptions`
  // does not itself carry: which productId/courseId a PARENT row takes and which source
  // `option_group_item_id` a CHILD row traces back to. `priceBasketWithOptions` expands each item to a
  // parent row then its option rows IN THIS SAME ORDER (see its doc), so `lineMeta[i]` lines up with
  // `priced.lines[i]` one-for-one below.
  type LineMeta =
    | {
        kind: "parent";
        productId: string;
        courseId: string | null;
        note: string | null;
        doneness: Doneness | null;
      }
    | { kind: "child"; optionGroupItemId: string };
  const items: BasketItemWithOptions[] = [];
  const lineMeta: LineMeta[] = [];
  // Per-PRODUCT cache of `optionGroupItemId → { item, groupId }`, built once per distinct product rather
  // than once per LINE: ordering N lines of the same product (e.g. 3× the same burger with different
  // modifiers) resolved this map N times before. Same resolved values either way — pure de-duplication
  // of in-memory work, keyed on `product.id` so two different products never share a cache entry.
  type OptionItemRow = (typeof available)[number]["optionGroups"][number]["items"][number];
  const itemByIdByProduct = new Map<
    string,
    Map<string, { item: OptionItemRow; groupId: string }>
  >();
  for (const line of lines) {
    const product = byId.get(line.productId);
    if (product === undefined) {
      throw new AppError("sale.unknown_product", { productId: line.productId });
    }

    // Per-line customisation (spec §2/§3), NON-FISCAL. Validate + normalise BEFORE pricing so a bad
    // value aborts the whole basket rather than half-persisting. The wire type is a lie (JSON), so the
    // note is TYPE-SCREENED first: a non-string (e.g. `123`) is refused `management.request_invalid`
    // (a clean 400) rather than reaching `.trim()` as a `123.trim is not a function` TypeError → an
    // opaque 500 — an absent (`undefined`) note stays "not chosen", the same as before. It is then
    // trimmed (trailing whitespace never trips the cap) and capped at 200 chars; a note empty after
    // trimming folds to NULL. The doneness is screened against the enum — the same runtime check keeps a
    // crafted value out of the `working_order_lines` insert. Both belong to the PARENT dish line and are
    // carried on its `lineMeta` entry below.
    const NOTE_LIMIT = 200;
    const screenedNote = line.note === undefined ? null : requireNullableString(line.note, "note");
    const trimmedNote = screenedNote?.trim() ?? "";
    if (trimmedNote.length > NOTE_LIMIT) {
      throw new AppError("working_order.note_too_long", {
        length: trimmedNote.length,
        limit: NOTE_LIMIT,
      });
    }
    const note = trimmedNote.length === 0 ? null : trimmedNote;
    if (line.doneness !== undefined && !DONENESS.includes(line.doneness)) {
      throw new AppError("working_order.invalid_doneness", { value: String(line.doneness) });
    }
    const doneness = line.doneness ?? null;

    const selected = line.options ?? [];
    // Modifiers attach to `each` products only this slice (design): a `weight` product (loose deli by
    // the kilo) carrying options is a crafted request the till never produces — refuse it loud, the
    // client is never the gate. A `weight` line with NO options is untouched.
    if (selected.length > 0 && product.pricingUnit !== "each") {
      throw new AppError("options.unsupported_product", {
        productId: line.productId,
        pricingUnit: product.pricingUnit,
      });
    }

    // Resolve every selected option against THIS product's active groups/items (already in hand), and
    // tally per group for the required/min/max checks. Skip the whole block for a non-`each` product
    // (it has no options — either none were sent, or the guard above already threw).
    const selectedOptions: {
      id: string;
      name: Record<string, string>;
      priceDelta: string;
      vatClass: (typeof product.optionGroups)[number]["items"][number]["vatClass"];
      quantity: number;
    }[] = [];
    if (product.pricingUnit === "each") {
      let itemById = itemByIdByProduct.get(product.id);
      if (itemById === undefined) {
        itemById = new Map(
          product.optionGroups.flatMap((group) =>
            group.items.map((item) => [item.id, { item, groupId: group.id }] as const),
          ),
        );
        itemByIdByProduct.set(product.id, itemById);
      }
      // Per-option quantity: SUM each wire entry's `quantity` (absent = 1) per `optionGroupItemId`
      // instead of collapse-deduping. A crafted request naming the same id twice now SUMS to that
      // combined count — the summed value is then validated (`1 ≤ qty ≤ max_quantity`), so a doubled
      // pick beyond the item's cap is still refused (the anti-overcharge intent FIX 3 protected), and a
      // legitimate ×N goes through. `firstSeenOrder` preserves the wire's first-seen order so the child
      // rows keep a stable order. The client is never the gate.
      const qtyById = new Map<string, number>();
      const firstSeenOrder: string[] = [];
      for (const sel of selected) {
        const found = itemById.get(sel.optionGroupItemId);
        if (found === undefined) {
          throw new AppError("option.not_found", {
            optionGroupItemId: sel.optionGroupItemId,
            productId: line.productId,
          });
        }
        // Validate EACH wire entry's quantity is a positive integer BEFORE summing, so a crafted
        // request cannot wash out an invalid component (a negative, a fraction) against a duplicate
        // whose total lands on a valid integer. The SUMMED cap (`≤ max_quantity`) is checked below.
        const entryQty = sel.quantity ?? 1;
        if (!Number.isInteger(entryQty) || entryQty < 1) {
          throw new AppError("options.selection_invalid", {
            productId: line.productId,
            groupId: found.groupId,
            reason: "quantity_invalid",
          });
        }
        if (!qtyById.has(sel.optionGroupItemId)) {
          firstSeenOrder.push(sel.optionGroupItemId);
        }
        qtyById.set(sel.optionGroupItemId, (qtyById.get(sel.optionGroupItemId) ?? 0) + entryQty);
      }
      // The per-group TALLY is the SUM of quantities (not the distinct-item count): a per-option
      // quantity COUNTS toward `max_select` (product decision). Applied consistently to required /
      // min_select / max_select below.
      const tallyByGroup = new Map<string, number>();
      for (const optionGroupItemId of firstSeenOrder) {
        // `found` and each entry's positive-integer validity were established in the summing loop
        // above (every id in `firstSeenOrder` resolved there), so only the SUMMED cap can still fail
        // here — duplicate entries summing PAST the item's `max_quantity`.
        const found = itemById.get(optionGroupItemId)!;
        const qty = qtyById.get(optionGroupItemId)!;
        if (qty > found.item.maxQuantity) {
          throw new AppError("options.selection_invalid", {
            productId: line.productId,
            groupId: found.groupId,
            reason: "quantity_invalid",
          });
        }
        tallyByGroup.set(found.groupId, (tallyByGroup.get(found.groupId) ?? 0) + qty);
        selectedOptions.push({
          id: found.item.id,
          name: found.item.name,
          priceDelta: found.item.priceDelta,
          vatClass: found.item.vatClass,
          quantity: qty,
        });
      }
      // Validate the selection per group over the SUMMED tally. An EMPTY group (`items: []`, an
      // authoring bug) carries no satisfiable constraint, so it is SKIPPED rather than deadlocking a
      // legitimate sale — nothing may block a sale on a mis-authored group (CLAUDE.md §5). `required`
      // (⟹ `min_select ≥ 1` by the DB `option_groups_required_ck`) is reported distinctly from a bare
      // `min_select`.
      for (const group of product.optionGroups) {
        if (group.items.length === 0) {
          continue;
        }
        const count = tallyByGroup.get(group.id) ?? 0;
        if (group.required && count === 0) {
          throw new AppError("options.selection_invalid", {
            productId: line.productId,
            groupId: group.id,
            reason: "required",
          });
        }
        if (count < group.minSelect) {
          throw new AppError("options.selection_invalid", {
            productId: line.productId,
            groupId: group.id,
            reason: "below_min",
          });
        }
        if (count > group.maxSelect) {
          throw new AppError("options.selection_invalid", {
            productId: line.productId,
            groupId: group.id,
            reason: "above_max",
          });
        }
      }
    }

    items.push({
      product,
      quantity: line.quantity,
      options: selectedOptions.map((option) => ({
        name: option.name,
        priceDelta: option.priceDelta,
        vatClass: option.vatClass,
        // The per-option count threads into `priceBasketWithOptions`, which prices the child at
        // `dishQuantity × quantity` and stores that COMBINED quantity on the child line.
        quantity: option.quantity,
      })),
    });
    // The parent row's course is the ring-time resolver `<override> ?? product.course_id` (§2b); a
    // CHILD row inherits none (no ticket_item, KDS coursing is per dish).
    lineMeta.push({
      kind: "parent",
      productId: line.productId,
      courseId: line.courseId ?? product.courseId ?? null,
      note,
      doneness,
    });
    for (const option of selectedOptions) {
      lineMeta.push({ kind: "child", optionGroupItemId: option.id });
    }
  }

  // KDS-2 (A1): screen each non-null course OVERRIDE against the SAME live-course definition the config
  // verbs use, so this — the ONE course-write path that skipped it — no longer accepts a crafted id. A
  // malformed (non-uuid) override would `22P02` at `requireLiveCourse`'s own `id = $1` uuid cast, so fold
  // it to the SAME `course.not_found` first (the shape the fire route's `isUuid` screen uses);
  // `requireLiveCourse` then refuses an absent / DIFFERENT-venue (its FK is tenant-scoped only) / retired
  // id — location-scoped, `course.not_found`. Only the OVERRIDE is screened: the product DEFAULT
  // (`product.course_id`, resolved below) is an already-valid stored FK, and re-validating it would
  // wrongly reject a legitimately-deactivated product default. Living in this shared resolver, the screen
  // covers every caller — the round path (`addTabRound`) and the order paths (`createOpenOrder` /
  // `updateHeldOrder`) — uniformly. Deduped so a repeated override id costs one round trip; `null`
  // (explicit clear / fire-earliest) and `undefined` (fall to the product default) skip.
  const overrideCourseIds = new Set(
    lines
      .map((line) => line.courseId)
      .filter((courseId): courseId is string => courseId !== null && courseId !== undefined),
  );
  for (const courseId of overrideCourseIds) {
    if (!isUuid(courseId)) {
      throw new AppError("course.not_found", { courseId });
    }
    await requireLiveCourse(tx, cfg, courseId);
  }

  // Price the basket authoritatively, expanding each dish into a PARENT row + one CHILD row per
  // selected option (`priceBasketWithOptions`). With every line's `options` empty this is line-for-line
  // identical to `priceBasket`, so the no-modifier callers (park/update/walk-up without options) are
  // unchanged. Each child's `parentLineNo` names its dish, carried through to `RecordSaleLine` for the
  // filed `sale_lines` (Task 4/5) — and through the working_order_lines self-FK built below.
  const priced = priceBasketWithOptions(items);

  // Feature B — re-key catalogue content to the fiscal line. Catalogue descriptions are authored under
  // the BARE language tag (`es` = "our Spanish"); the `working_order_lines_check_locales` trigger (and
  // the receipt) require the per-line map to hold EXACTLY this location's full-tag `invoice_locales`
  // (`es-ES`). Use the location's DB `invoice_locales`, NOT `cfg.invoiceLocales` — the latter is
  // env-derived and can drift from what the trigger actually checks, which is the location row. This
  // closes that drift FOR THE LINE DESCRIPTIONS ONLY: the sale HEADER's locale fields
  // (`sales.locale`/`sales.invoice_locales`, stamped by `recordSale` from `cfg`) are still sourced from
  // boot-time config, so a config-vs-env drift can still file a header inconsistent with these lines
  // (immutable record, §5) — a residual gap tracked in the backlog, not closed here. That `invoice_locales`
  // value comes from the SAME `listAvailableProducts` read above (it projects `locations.invoice_locales`
  // alongside the products via `resolveAccessibleCatalogueIds`, one read), so no second `locations`
  // query is issued here — and it reflects a REAL `locations` row whenever this loop runs: the loop
  // iterates `priced.lines`, which are non-empty only if every input line resolved a product from that
  // read, which returns products only when `resolveAccessibleCatalogueIds` found ≥1 accessible catalogue
  // for `cfg.locationId` — i.e. the `locations` row exists (an absent location yields no products, so
  // every line would have thrown `sale.unknown_product` above, and `invoiceLocales` would be the `?? []`
  // empty fallback). So if the loop body runs, `invoiceLocales` is the genuine row value, not the
  // absent-location default. `toInvoiceLineDescriptions`
  // graceful-fills and NEVER throws (§5: nothing may block a sale), and mutating `priced.lines` in place
  // propagates the re-key to BOTH the `working_order_lines` rows built below AND the filed `sale_lines`
  // (the same `priced` is threaded back out and fed to `recordSale`). The inherited/locked paths
  // (`priceLockedLines`, move/transfer) already carry full tags and are untouched.
  for (const line of priced.lines) {
    line.descriptions = toInvoiceLineDescriptions(line.descriptions, invoiceLocales);
  }

  // Pre-generate the line ids so a CHILD row's `parent_line_id` can name its PARENT's id in the SAME
  // insert (the self-referential FK is checked at statement end, so one `.values([...])` inserts parent
  // and children together). `randomUUID` from `node:crypto`, the house pattern — not bare global
  // `crypto`. Mirrors Task 5's id-resolution shape for the filed `sale_lines`.
  const ids = priced.lines.map(() => randomUUID());
  const byLineNo = new Map(priced.lines.map((line, i) => [line.lineNo, ids[i]!]));
  const lineRows = priced.lines.map((line, i) => {
    // `lineMeta[i]` lines up with `priced.lines[i]` (both in `priceBasketWithOptions`'s
    // parent-then-children expansion order): a PARENT row carries the dish's product + resolved course
    // and no option/parent link; a CHILD row carries its source `option_group_item_id` and its parent's
    // id, and NO product/course (a modifier has no product row and no independent kitchen course).
    const meta = lineMeta[i]!;
    return {
      id: ids[i]!,
      tenantId: cfg.tenantId,
      workingOrderId,
      lineNo: line.lineNo,
      // NULL for a top-level line; the parent dish's own pre-generated id for a child option line —
      // resolved from `line.parentLineNo` (the parent's `lineNo`) via `byLineNo`.
      parentLineId: line.parentLineNo == null ? null : byLineNo.get(line.parentLineNo)!,
      // Authoring traceability back to the catalogue option (child only); NULL for a parent.
      optionGroupItemId: meta.kind === "child" ? meta.optionGroupItemId : null,
      // The priced product this draft line was built from — a PARENT dish only; a CHILD modifier has no
      // product (its price/name are snapshotted onto the line by value), so NULL.
      productId: meta.kind === "parent" ? meta.productId : null,
      descriptions: line.descriptions,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      // The GROSS (VAT-inclusive) UNIT price LOCKED at add-time (line-add snapshot, 7c) — the
      // AUTHORITATIVE input a retrieved order is FILED from without a re-price (`priceLockedLines`,
      // @waitron/catalogue reads this straight back as its `grossUnitPrice`). `unit_price` above is the
      // NET unit, informational only; this is the gross the line was priced from, so a later catalogue
      // price change never moves the filed total. Stored from the pricer's `grossUnitPrices` — the
      // per-UNIT gross at MONEY_SCALE, the exact figure `priceLockedLines` recomputes from — never
      // `line_total ÷ quantity`, which is exact for `each` but DRIFTS for a weighed line. A child
      // option's gross unit is its `price_delta`, re-priced from THIS locked column on retrieve exactly
      // as the dish is. This is a durable lock, not a display cache.
      unitPriceGross: priced.grossUnitPrices[i]!,
      vatRate: line.vatRate,
      // The DRAFT line stores the GROSS (VAT-inclusive) line total, not `line.lineTotal`'s net base:
      // `working_order_lines` is the counter's mutable display, and every other total the operator/
      // customer sees is gross (the basket grand total, the per-line gross, the filed ticket), so the
      // held-orders list `sum(line_total)` must be gross too. This deliberately DIVERGES from the FILED
      // `sale_lines.line_total`, which keeps `line.lineTotal`'s net base for the fiscal record. The
      // FILED line of a retrieved order now derives from the locked `unit_price_gross` unit above via
      // `priceLockedLines`, NOT from `priced.lines`; a freshly-created walk-up still files from
      // `priced.lines`. See `working_order_lines.line_total`'s schema comment and the pricer's
      // `grossLineTotals`/`grossUnitPrices`.
      lineTotal: priced.grossLineTotals[i]!,
      category: line.category ?? null,
      // KDS-2 ring-time course (§2b): the resolver `<override> ?? product.course_id` was computed into
      // `lineMeta` when the basket was built (data already in hand — the input line's override and the
      // resolved `product.courseId`); a CHILD row inherits no course.
      courseId: meta.kind === "parent" ? meta.courseId : null,
      // Per-line customisation (spec §2/§3), NON-FISCAL: the validated + normalised note/doneness, on the
      // PARENT dish line only — a child modifier row carries neither (NULL). Snapshotted onto the
      // ticket item at fire (`fireLines`), never onto the sale.
      note: meta.kind === "parent" ? meta.note : null,
      doneness: meta.kind === "parent" ? meta.doneness : null,
    };
  });
  return { lineRows, priced };
}

/**
 * Read a persisted order's STORED lines in `line_no` order — the columns `priceLockedLines` needs
 * (gross unit, quantity, rate, descriptions, category), each snapshotted at add-time, PLUS `id`,
 * `line_no` and `parent_line_id`, from which the returned `parentLineNo` is reconstructed so the
 * parent→child modifier linkage survives the lock round-trip (see below). THE ONE
 * reader shared by `payWorkingOrder` (a retrieved order), `placeOrder` (Mode-I's deferred file at
 * placing) and `collectOrder` (Mode-T's immediate file at collect), so all three file a persisted
 * order from the SAME locked composition and a catalogue price change after add never moves the filed
 * total (line-add snapshot, 7c).
 *
 * Refuses a LINELESS order with `sale.empty_basket` (a domain 4xx → 400), never a raw Error. A
 * lineless persisted order IS a reachable state: `openTab` opens an EMPTY tab — a lineless `open`
 * working order (design §3a; tabs.test.ts "opens a tab with NO initial round") — so paying it
 * (`payWorkingOrder`), placing it (Mode-I `placeOrder`), or card-paying it
 * (`payWorkingOrderIntegrated`) all reach here through `priceStoredOrder`. A sale needs ≥1 line to
 * price and file, so an empty one is refused BEFORE any fiscal write (and before any card charge) —
 * the SAME `sale.empty_basket` guard the walk-up/park/round paths make at their own layer, surfaced
 * here as the actionable domain code the error boundary maps to 400, rather than the opaque
 * `server.internal` 500 a raw Error would become through `run`. This is the last line for the
 * empty-tab pay/place flow, which those earlier per-layer guards do not cover.
 */
export async function readLockedLines(
  tx: Transaction,
  workingOrderId: string,
): Promise<LockedLine[]> {
  const stored = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      grossUnitPrice: workingOrderLines.unitPriceGross,
      quantity: workingOrderLines.quantity,
      vatRate: workingOrderLines.vatRate,
      descriptions: workingOrderLines.descriptions,
      category: workingOrderLines.category,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId))
    .orderBy(workingOrderLines.lineNo);
  if (stored.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }
  // Reconstruct each child modifier line's `parentLineNo` from its stored `parent_line_id` (an id), so
  // the file path preserves parent→child linkage exactly as the live walk-up does — a child `sale_line`
  // must not be orphaned (`parent_line_id` NULL) just because the order was locked and re-priced.
  // Ordering modifiers (Task 6): the WALK-UP files the live `priced` (linkage intact), but EVERY
  // persisted-order file (a retrieved counter order, a settled tab — the PRIMARY modifier path) reaches
  // the fiscal record through this reader, so the link must survive the lock round-trip here.
  //
  // CRITICAL (FIX 1): reconstruct `parentLineNo` in the COMPACTED array-position space `priceRows` will
  // renumber into — `lineNo = i + 1` by array position — NOT the stored `line_no` space. `stored` is
  // `line_no`-ordered and `priceRows`/`priceLockedLines` preserve that array order, so position `i + 1`
  // here equals the `lineNo` the emitted line (and `recordSale`'s `byLineNo` map, keyed on the EMITTED
  // `lineNo`) will carry. The two spaces COINCIDE only when the stored `line_no`s are exactly `1..n`
  // contiguous; a void (`voidTabLine`) or a subset transfer/move leaves them non-contiguous, and keying
  // on the stored `line_no` would then resolve a child to the WRONG emitted line — self, null, or a
  // sibling — filing a wrong `parent_line_id` into the immutable record. `id` is unique within the
  // order and this batch is the whole order, so the map is total.
  const positionById = new Map(stored.map((line, i) => [line.id, i + 1]));
  return stored.map((line) => ({
    grossUnitPrice: line.grossUnitPrice,
    quantity: line.quantity,
    vatRate: line.vatRate,
    descriptions: line.descriptions,
    category: line.category,
    parentLineNo: line.parentLineId == null ? null : (positionById.get(line.parentLineId) ?? null),
  }));
}

/**
 * Price a persisted order's STORED locked composition — `priceLockedLines` over {@link readLockedLines},
 * the one-liner every persisted-order file repeats (retrieved-order pay, Mode-I place, Mode-T collect,
 * and the settled-ticket read-back). `priceLockedLines` runs the SAME difference-method arithmetic over
 * the ADD-TIME locked gross (`unit_price_gross`) that `priceBasket` runs over a live catalogue, so a
 * catalogue price change after add never moves the filed total (line-add snapshot, 7c). Pure over
 * `readLockedLines`'s read; refuses a lineless order with `sale.empty_basket` (see there).
 */
export async function priceStoredOrder(
  tx: Transaction,
  workingOrderId: string,
): Promise<PricedLines> {
  return priceLockedLines(await readLockedLines(tx, workingOrderId));
}

/**
 * Read a filed sale's human-facing `NumSerieFactura` ("A/1") back from its `sales` row and series, in
 * the caller's transaction — the `FiscalRecordRef` is regime-opaque and carries neither, so both the
 * immediate-file (`fileImmediateSale`) and the Mode-I deferred place (`placeOrder`) read it back the
 * same way. `recordSale` guarantees exactly one `sales` row for the id, so the single-row read always
 * resolves (the non-null assertion holds for the same reason both call sites' did).
 */
export async function readInvoiceNumber(tx: Transaction, saleId: SaleId): Promise<string> {
  const [issued] = await tx
    .select({ code: invoiceSeries.code, number: sales.invoiceNumber })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(eq(sales.id, saleId));
  return formatInvoiceNumber(issued!.code, issued!.number);
}

/**
 * Project a VAT desglose onto the ticket's `{ rate, base, tax }` shape — the one place the three result
 * builders express it: `placeOrder` here (Mode-I place), and `till-sale.ts`'s `readSettledTicket` (over a
 * FILED record's bands) and `fileImmediateSale` (over a freshly-`priced` basket). A pure per-band field
 * copy; the surcharge fields a `VatBreakdownLine` may also carry are deliberately dropped, exactly as
 * each inline `.map` did — the counter ticket carries base/tax only. Lives here (not in `till-sale.ts`)
 * so `till-sale.ts` imports it one-directionally, no cycle.
 */
export function toVatBreakdown(
  bands: readonly { rate: string; base: string; tax: string }[],
): { rate: string; base: string; tax: string }[] {
  return bands.map((v) => ({ rate: v.rate, base: v.base, tax: v.tax }));
}

/**
 * A working order the counter parks to retrieve and pay later (park & retrieve, sub-project 7b). Like
 * `TillSaleRequest`, it carries NO price of any kind — the server re-reads the catalogue and prices
 * authoritatively (`priceBasket`), so a browser cannot influence the snapshot the draft carries.
 *
 * `id` is client-supplied: the till mints the working-order uuid and holds it stable across a retry.
 * That id is what makes park IDEMPOTENT — a re-sent park (a lost-response retry) PK-collides on
 * `working_orders.id`, and `parkOrder` catches that 23505 and REPLAYS the existing OPEN order's
 * `{ id, orderNumber }` rather than surfacing the collision, so at most one order is ever parked for the
 * id and the retry sees the original result. This mirrors PAY's own replay (`payWorkingOrder`, which
 * re-returns an already-settled order's ticket rather than filing a second chained record). The ONE
 * exception is a colliding id whose committed row is no longer `open` (abandoned/settled/placed) — a
 * pathological id reuse, not a held-order retry — which is re-thrown as the raw 23505 unchanged.
 * `quantity` is a count for an `each` product and a measured kg weight for a `weight` product.
 *
 * `operatorId` is the person who parked the order, for later attribution. It is accepted here for the
 * caller's convenience and forward-compatibility with the session wiring (Task 5) but is NOT persisted
 * in this slice: `working_orders` carries no operator column yet, so there is nowhere to write it.
 */
export interface ParkOrderRequest {
  id: string;
  // A line MAY carry per-line `LineExtras` (NON-FISCAL), forwarded to `priceOrderLines` via
  // `createOpenOrder`.
  lines: ({ productId: string; quantity: string } & LineExtras)[];
  label?: string;
  operatorId?: string;
}

export interface ParkOrderResult {
  id: string;
  orderNumber: number;
}

/**
 * Persist an OPEN working order plus its priced lines on the CALLER's transaction: re-read the
 * catalogue, re-price `lines` with `priceBasket`, allocate the next per-node order number, and INSERT
 * the `working_orders` row (status `open`) and its `working_order_lines`. Returns the allocated order
 * number AND the authoritative `priceBasket` result its lines were priced from — so `payWorkingOrder`'s
 * walk-up path files the sale from the SAME price this creation computed, never a second catalogue
 * read of the identical basket. The server never trusts a browser-computed price; `lines` carry none.
 *
 * Shared by `parkOrder` (a counter parks an order to pay later, which uses only `orderNumber`) and
 * `payWorkingOrder` (a WALK-UP, which creates the order `open` and settles it in the same transaction,
 * reusing `priced`) — extracted so a walk-up order is IDENTICAL in shape to a parked one: same
 * allocated number, same priced lines, same triggers (`require_open_parent`/`check_locales` fire on
 * the inserted lines because their parent was inserted just above). The empty-basket refusal stays
 * with each caller (it is checked before any database work), as does the surrounding
 * `withTenant`/`asAppUser` scope; this helper owns only the two inserts.
 */
export async function createOpenOrder(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  // A line MAY carry `options` (ordering modifiers, Task 6) — passed straight to `priceOrderLines`,
  // which validates them and expands the line into a parent dish row + child option rows. A walk-up
  // counter sale threads them here; park/openTab pass a plain `{productId, quantity}` line (no options).
  // A line MAY also carry per-line `LineExtras` (NON-FISCAL) — likewise forwarded to `priceOrderLines`,
  // which validates + persists them on the parent dish line.
  lines: ({
    productId: string;
    quantity: string;
    options?: { optionGroupItemId: string; quantity?: number }[];
  } & LineExtras)[],
  label: string | null,
  // A counter delivery sets `deliveryTableId` (design §2b/§3c). Defaults to {}, so parkOrder, openTab
  // and payWorkingOrder's walk-up path are unchanged (they omit it → a plain walk-up, column NULL). A
  // TAB does NOT flow through here — its link is the `dining_tables.tab_id` back-pointer openTab sets,
  // not an order column, so openTab passes no placement and this never stamps a delivery table on it.
  placement: { deliveryTableId?: string | null } = {},
): Promise<{ orderNumber: number; priced: PricedBasket }> {
  // Check the delivery table exists before insertion so an unknown id produces
  // table.not_found rather than a raw foreign-key failure. This check permits an
  // inactive table and does not take a row lock.
  const deliveryTableId = placement.deliveryTableId ?? null;
  if (deliveryTableId !== null) {
    const [table] = await tx
      .select({ id: diningTables.id })
      .from(diningTables)
      .where(eq(diningTables.id, deliveryTableId));
    if (table === undefined) {
      throw new AppError("table.not_found", { tableId: deliveryTableId });
    }
  }

  // Resolve + price the basket authoritatively (refusing an unknown product) into the line rows,
  // keeping the raw price so the caller need not re-derive it — `priceOrderLines`'s own doc-comment
  // explains the zip and why `priced` is threaded back out.
  const { lineRows, priced } = await priceOrderLines(tx, cfg, id, lines);
  const orderNumber = await allocateOrderNumber(tx, cfg.tenantId, cfg.nodeId);

  await tx.insert(workingOrders).values({
    id,
    tenantId: cfg.tenantId,
    tillId: cfg.tillId,
    nodeId: cfg.nodeId,
    orderNumber,
    label,
    status: "open",
    // Set ⇒ this counter order is DELIVERED to that table (metadata on the commercial row, NOT a
    // fiscal field — the alta path never reads it, proven by the H2 huella-identity test). NULL for a
    // walk-up/park/tab. The FK is enforced above by the app pre-check and by the DB as the backstop.
    deliveryTableId,
  });

  // The parent order was inserted just above, so the composite FK and the
  // `require_open_parent`/`check_locales` triggers all resolve it. Guarded: an EMPTY tab (openTab with
  // no initial round) has no lines to insert, and `tx.insert(...).values([])` errors. Existing callers
  // always pass ≥1 line (they guard empty baskets before calling), so this never changes their path.
  if (lineRows.length > 0) {
    await tx.insert(workingOrderLines).values(lineRows);
  }

  return { orderNumber, priced };
}

/**
 * Park a working order: re-read the catalogue, re-price with `priceBasket`, allocate the next per-node
 * order number, and persist an OPEN `working_orders` row plus its priced `working_order_lines` — all
 * inside ONE `withTenant`/`asAppUser` transaction, so the order and every line commit as a single unit
 * (or roll back together, leaving nothing parked). The server never trusts a browser-computed price;
 * `req` carries none. The persisted line keeps `product_id` (a pricing INPUT a later repricing
 * re-resolves) alongside the frozen display snapshot (`descriptions`, `unit_price`, `vat_rate`,
 * `category`) from `priceBasket`, plus its GROSS `line_total` (`priceBasket`'s `grossLineTotals`, not
 * the net base the fiscal line carries — see `priceOrderLines`). The persist itself is
 * `createOpenOrder`, shared verbatim with `payWorkingOrder`'s walk-up path.
 */
export async function parkOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  req: ParkOrderRequest,
): Promise<ParkOrderResult> {
  // Refused before any database work: an empty basket has nothing to price and no order to open. Park
  // always needs lines, so this refusal is unconditional here (the sale path's is not — `payWorkingOrder`
  // scopes it to a walk-up, so a retrieved order files stored lines); the `lines` array is a network
  // boundary, so the guard is real.
  if (req.lines.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }

  try {
    return await withTenant(
      deps.db,
      cfg.tenantId,
      async (tx) => {
        await asAppUser(tx);
        // Park needs only the allocated number; `priced` is `payWorkingOrder`'s walk-up shortcut, unused here.
        const { orderNumber } = await createOpenOrder(
          tx,
          cfg,
          req.id,
          req.lines,
          req.label ?? null,
        );
        return { id: req.id, orderNumber };
      },
      { nodeId: cfg.nodeId },
    );
  } catch (error) {
    // Anything but a unique violation is a real failure and surfaces unchanged — the transaction above
    // already rolled back, so nothing half-parked persists.
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // A 23505 on `working_orders_pkey`: a re-sent park (see `ParkOrderRequest` for the stable client id)
    // collides on the id an EARLIER park already committed. That row is READABLE now in a fresh
    // transaction — the unique violation fires only against a COMMITTED conflicting row (an UNCOMMITTED
    // concurrent insert of the same key would BLOCK on the index until its writer commits or aborts, not
    // error), which is exactly why `payWorkingOrder`'s 23505 backstop (`till-sale.ts`) replays in a fresh
    // tx too. Replay the committed OPEN order's number, filing and inserting nothing.
    return withTenant(
      deps.db,
      cfg.tenantId,
      async (tx) => {
        await asAppUser(tx);
        const [existing] = await tx
          .select({ orderNumber: workingOrders.orderNumber })
          .from(workingOrders)
          .where(and(eq(workingOrders.id, req.id), eq(workingOrders.status, "open")));
        // Not `open` (abandoned/settled/placed) — a pathological id reuse, not a replayable held order —
        // so re-throw the raw 23505 unchanged per the docstring's exception, never fabricating a result.
        if (existing === undefined) {
          throw error;
        }
        return { id: req.id, orderNumber: existing.orderNumber };
      },
      { nodeId: cfg.nodeId },
    );
  }
}

/**
 * Open the running tab on a table (design §3a). Takes the `dining_tables` row `FOR UPDATE` — THIS
 * per-table lock is the one-open-tab-per-table concurrency guard: there is NO partial-unique now (a
 * single nullable `tab_id` gives one-tab-per-table structurally), so the lock is what serialises the
 * check-then-set. A second concurrent openTab on the same table blocks on this lock until the first
 * commits, then reads the now-set `tab_id`, finds it points at an OPEN order, and is refused
 * `tab.already_open` (proven by deletion of the lock — §7). A STALE `tab_id` (pointing at a
 * settled/abandoned order) reads as free and is OVERWRITTEN, so the fiscal pay path needs no settle-time
 * write (design §2b).
 *
 * Then creates an `open` working order (reusing `createOpenOrder`, incl. the per-node order-number
 * allocation) and points the table's `tab_id` at it. The order carries NO tab column — the link is this
 * back-pointer. `lines?` opens the tab with an initial round; absent, the tab opens empty. Runs on the
 * CALLER's transaction under its tenant/app_user scope. `table.not_found`/`table.inactive` guard the
 * table itself.
 */
export async function openTab(
  tx: Transaction,
  cfg: TillConfig,
  req: { tableId: string; lines?: { productId: string; quantity: string }[] },
): Promise<{ tabId: string; orderNumber: number }> {
  const [table] = await tx
    .select({ active: diningTables.active, tabId: diningTables.tabId })
    .from(diningTables)
    .where(eq(diningTables.id, req.tableId))
    .for("update");
  if (table === undefined) {
    throw new AppError("table.not_found", { tableId: req.tableId });
  }
  if (!table.active) {
    throw new AppError("table.inactive", { tableId: req.tableId });
  }

  // A set tab_id blocks a second tab ONLY while it points at a STILL-OPEN order; the WHERE clause does
  // the filtering, so a stale pointer (at a settled order) simply returns no row and is overwritten below.
  if (table.tabId !== null) {
    const [openTabRow] = await tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(and(eq(workingOrders.id, table.tabId), eq(workingOrders.status, "open")));
    if (openTabRow !== undefined) {
      throw new AppError("tab.already_open", { tableId: req.tableId });
    }
  }

  const tabId = randomUUID();
  const { orderNumber } = await createOpenOrder(tx, cfg, tabId, req.lines ?? [], null);
  // TS-1 sets the back-pointer; TS-2 also clears any stale manual status as the new tab opens (§3b(2)).
  await tx
    .update(diningTables)
    .set({ tabId, statusId: null })
    .where(eq(diningTables.id, req.tableId));
  return { tabId, orderNumber };
}

/**
 * Lock an open working-order row, otherwise tab.not_open. This accepts table-less
 * orders; lockOpenTab adds the table back-pointer check. Callers that also lock dining
 * tables acquire working-order locks first, matching the settlement path.
 */
async function lockOpenTabRow(tx: Transaction, tabId: string): Promise<void> {
  const [row] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, tabId))
    .for("update");
  if (row?.status !== "open") {
    throw new AppError("tab.not_open", { tabId });
  }
}

/**
 * Lock the open working-order row and require a dining-table back-pointer.
 * The caller holds the lock through its line allocation or deletion until commit.
 */
async function lockOpenTab(tx: Transaction, tabId: string): Promise<void> {
  await lockOpenTabRow(tx, tabId);
  const [pointer] = await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .where(eq(diningTables.tabId, tabId));
  if (pointer === undefined) {
    throw new AppError("tab.not_open", { tabId });
  }
}

/**
 * Fire an order's (or a tab round's) lines to the kitchen (KDS-1 §3b): insert one `ticket_items` row
 * per line, its station RESOLVED and SNAPSHOTTED at fire time. The shared primitive the three fire
 * points funnel through — `placeOrder` (placing = firing for Modes I/T), `sendToPrep` (Mode P's
 * pickup) and a tab's round-send ({@link addTabRound}) — so routing and the snapshot rule live in ONE
 * place, replacing #63's single `order_prep` row per order with a per-line/per-station model.
 *
 * Each line resolves `product.station_id ?? category.station_id ?? the location's default station`
 * (§2b): a per-product override wins over the product's category default, which wins over the venue's
 * single `is_default` kitchen station. The resolved id is WRITTEN onto the ticket item, so re-pointing
 * the product's or category's station later never moves an already-fired item — the load-bearing
 * snapshot (`ticket_items.station_id`'s own schema comment). If a line resolves NEITHER a product- nor
 * category-level route AND the venue has no default station, firing FAILS LOUD with
 * `station.no_default` (§2b: a misconfiguration must not silently drop food from the kitchen), naming
 * the venue so the operator can fix it.
 *
 * `node_id = cfg.nodeId` (node-scoped, as `order_prep` was); `working_order_id = orderId` is the
 * denormalised grouping key; `working_order_line_id` is the fired line, whose `(tenant_id,
 * working_order_line_id)` unique makes a double-fire collide (23505) rather than duplicate. The two
 * catalogue reads (the venue default once, then all lines' product/category routes in one batched
 * `inArray`) and the insert all run on the CALLER's transaction under its tenant/app_user scope. An
 * empty `lines` inserts nothing — the `values([])` guard `createOpenOrder` uses.
 *
 * SIDE EFFECT (KDS-4 print-on-fire, §3b): after the insert, the newly-fired items (the insert's
 * `.returning()` filtered to `firedAt != null`) are handed to `enqueueKitchenTickets`, which INSERTs
 * kitchen print jobs into the outbox on this same tx — never blocking the fire (see `kitchen-print.ts`).
 */
export async function fireLines(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  // A CHILD modifier line (ordering modifiers, Task 2/7) carries `parent_line_id` set and NO product —
  // it is part of its parent dish, not its own kitchen ticket, so it must get NEITHER a `ticket_items`
  // row NOR an independent station resolution (a modifier never routes to its own station, and a
  // productless child would otherwise fall to the default station or fail `station.no_default`). This is
  // the SHARED fire chokepoint (placeOrder / sendToPrep / addTabRound all pass through here), so the
  // parent-only filter lives HERE — keyed on `parent_line_id IS NULL`, the semantic "is a top-level
  // line" — covering every caller by construction rather than being repeated at each. `productId` stays
  // nullable in the row shape only so a caller can hand the whole line set through; after the filter it
  // is non-null on every surviving parent.
  // Per-line customisation (spec §2/§3): each parent line's `note`/`doneness` (NON-FISCAL) rides in on
  // the same `lines` param — read back from `working_order_lines` by each caller's line-select, exactly
  // as `courseId` is — and is SNAPSHOTTED onto the `ticket_items` row below (like `station_id`/
  // `course_id`), so a later edit to the draft line never moves an already-fired ticket.
  // Coursing editing (A3): a line MAY carry `hold: true` — the round-send's "insert but do NOT fire yet"
  // marker (the tab screen's per-line hold toggle). It is TRANSIENT (read here to decide `fired_at`, never
  // a stored column, so no migration): a held line inserts with `fired_at NULL` REGARDLESS of its course,
  // so it is greyed on the KDS and prints nothing until a later `sendLines`/`fireCourse` releases it. Absent
  // (`undefined`) = today's auto-fire-by-course rule, unchanged — placeOrder/sendToPrep omit it entirely.
  lines: {
    id: string;
    productId: string | null;
    courseId: string | null;
    parentLineId: string | null;
    note: string | null;
    doneness: Doneness | null;
    hold?: boolean;
  }[],
): Promise<void> {
  // Keep only PARENT lines (`parent_line_id IS NULL`); child modifier lines fire nothing. Done first, so
  // an all-children (impossible today) or empty set short-circuits before any catalogue read or insert.
  const parentLines = lines.filter((line) => line.parentLineId === null);
  if (parentLines.length === 0) {
    return;
  }
  lines = parentLines;
  // The venue's single fallback station (its `is_default` row, if any) — read ONCE; each line falls to
  // it when neither the product nor its category names a route. The `active` filter is load-bearing:
  // `deactivateStation` leaves `is_default=true` on a deactivated default, so without it a dead station
  // is still resolved here and lines route to a queue the till/station display (active-only) never
  // surface — food silently dropped. Requiring `active` makes a venue whose only default is deactivated
  // resolve `null` → the fail-loud `station.no_default` below (§2b), until a new default is set.
  const [fallback] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(
      and(
        eq(kitchenStations.locationId, cfg.locationId),
        eq(kitchenStations.isDefault, true),
        eq(kitchenStations.active, true),
      ),
    );
  const defaultStationId = fallback?.id ?? null;

  // Read product and category station overrides in one batch. A missing category
  // yields a null route; modifier children have already been removed from this list.
  const productIds = [
    ...new Set(lines.map((line) => line.productId).filter((id): id is string => id !== null)),
  ];
  const routes = await tx
    .select({
      productId: products.id,
      productStationId: products.stationId,
      categoryStationId: categories.stationId,
    })
    .from(products)
    .leftJoin(
      categories,
      and(eq(categories.tenantId, products.tenantId), eq(categories.id, products.categoryId)),
    )
    .where(inArray(products.id, productIds));
  const routeByProduct = new Map(routes.map((route) => [route.productId, route]));

  // --- KDS-2 hold-and-fire (§3c): snapshot each line's course + decide fired-vs-held ---

  // Each fired line's RESOLVED course — Task 3 stored it at ring time as `<override> ?? product.course_id`
  // (null = no course). Threaded in on the `lines` param (keyed by line id, the same id this fire snapshots
  // as `working_order_line_id`) rather than re-read here: every caller already holds it — placeOrder and
  // sendToPrep add `course_id` to the line select they already run, and addTabRound reads it back on the
  // insert's RETURNING — so the value is `working_order_lines.course_id` exactly as a re-read would give,
  // one round trip cheaper.
  const courseByLine = new Map(lines.map((line) => [line.id, line.courseId ?? null]));

  // Aggregate existing items per venue course: anyFired lets later rounds join food
  // already cooking, and itemCount includes prior rounds when choosing the earliest
  // course. The join matches tenant ids and the course list is location-scoped.
  const courseRows = await tx
    .select({
      id: kitchenCourses.id,
      displayOrder: kitchenCourses.displayOrder,
      anyFired: sql<boolean>`bool_or(${ticketItems.firedAt} is not null)`,
      itemCount: sql<number>`count(${ticketItems.id})::int`,
    })
    .from(kitchenCourses)
    .leftJoin(
      ticketItems,
      and(
        eq(ticketItems.courseId, kitchenCourses.id),
        eq(ticketItems.tenantId, kitchenCourses.tenantId),
        eq(ticketItems.workingOrderId, orderId),
      ),
    )
    .where(eq(kitchenCourses.locationId, cfg.locationId))
    .groupBy(kitchenCourses.id, kitchenCourses.displayOrder);

  // Courses with an EXISTING fired item — a new item of one joins the already-cooking course and fires.
  const firedCourseIds = new Set(courseRows.filter((row) => row.anyFired).map((row) => row.id));

  // The order's NON-NULL course set = venue courses the order already carries items of (`itemCount > 0`,
  // prior rounds) ∪ this batch's non-null courses. A null course_id has no `display_order`, is treated as
  // earliest — it fires immediately (§2b) — and never enters this set. The min `display_order` over it is
  // the order's EARLIEST course, taken over prior rounds AND this batch. Empty set (all null courses) ⇒
  // no minimum, and every line fires by the null rule below.
  const orderCourseIds = new Set<string>([
    ...courseRows.filter((row) => row.itemCount > 0).map((row) => row.id),
    ...[...courseByLine.values()].filter((id): id is string => id !== null),
  ]);
  const displayOrderByCourse = new Map(courseRows.map((row) => [row.id, row.displayOrder]));
  const orderDisplayOrders = courseRows
    .filter((row) => orderCourseIds.has(row.id))
    .map((row) => row.displayOrder);
  const earliestDisplayOrder =
    orderDisplayOrders.length === 0 ? null : Math.min(...orderDisplayOrders);

  // Resolve + snapshot each line's station AND course, refusing the whole fire if any line has nowhere
  // to go. `firedAt` is `sql`now()`` (fired) or null (held), so the array is not annotated
  // `$inferInsert` — that type carries no `SQL` member; `.values()` accepts one per column.
  const values = lines.map((line) => {
    const route = line.productId === null ? undefined : routeByProduct.get(line.productId);
    const stationId = route?.productStationId ?? route?.categoryStationId ?? defaultStationId;
    if (stationId === null || stationId === undefined) {
      throw new AppError("station.no_default", { locationId: cfg.locationId });
    }
    const courseId = courseByLine.get(line.id) ?? null;
    // Fired NOW (§3c) if: no course (null fires earliest, §2b) OR its course is already fired for this
    // order OR its course is the order's earliest (min display_order). Else HELD (`fired_at` NULL) until
    // `fireCourse` stamps it. For a this-venue course (every A1-screened override, and the usual product
    // default) `displayOrderByCourse.get` is defined and the three checks decide fire vs held as intended.
    // A FOREIGN product-default course (the shared-catalogue corner above) is absent from the maps, so all
    // three checks are false and the line holds — and is then unfireable (Debt → KDS-2); harmless in the
    // incoherent state that alone produces it.
    // Coursing editing (A3): `hold === true` short-circuits the whole course decision — the round-send
    // asked for this line to be INSERTED but NOT fired, so it holds (`fired_at NULL`) even when its course
    // is the order's earliest (or already fired). It is then released like any other held line, by
    // `sendLines`/`fireCourse`. Absent `hold` falls through to the unchanged auto-fire-by-course rule.
    const fired =
      line.hold === true
        ? false
        : courseId === null ||
          firedCourseIds.has(courseId) ||
          displayOrderByCourse.get(courseId) === earliestDisplayOrder;
    return {
      tenantId: cfg.tenantId,
      nodeId: cfg.nodeId,
      workingOrderId: orderId,
      workingOrderLineId: line.id,
      stationId,
      courseId,
      // Per-line customisation (spec §2/§3), NON-FISCAL: snapshot the parent line's note/doneness onto
      // the ticket item at fire — frozen here like `station_id`/`course_id`, so editing the draft line
      // afterwards never moves this fired ticket.
      note: line.note,
      doneness: line.doneness,
      firedAt: fired ? sql`now()` : null,
      state: "queued" as const,
    };
  });
  let inserted: { workingOrderLineId: string; stationId: string; firedAt: string | null }[];
  try {
    // `.returning()` captures the newly-written ticket items so print-on-fire (KDS-4) can enqueue their
    // kitchen tickets WITHOUT re-querying `ticket_items` — a re-query would sweep up EARLIER rounds'
    // already-fired items (an order fires round by round) and reprint them (controller ruling R-D).
    inserted = await tx.insert(ticketItems).values(values).returning({
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      firedAt: ticketItems.firedAt,
    });
  } catch (error) {
    // A line already fired collides on `ticket_items`' per-line `(tenant_id, working_order_line_id)`
    // unique — a re-fire (the reachable case is a double `sendToPrep`). Map that 23505 to the domain
    // code naming the order, so the route surfaces a clean 409 instead of the raw constraint error
    // becoming an opaque `server.internal` 500. Caught HERE, the shared fire choke point, so every fire
    // path (placeOrder / sendToPrep / addTabRound) is covered by construction. Any other error re-throws.
    if (isUniqueViolation(error)) {
      throw new AppError("ticket.already_fired", { workingOrderId: orderId });
    }
    throw error;
  }

  // Print-on-fire (KDS-4 §3c): enqueue a kitchen ticket at each printer attached to a firing station,
  // for the lines that FIRED now — held items (`fired_at` null, a later course) print only when
  // `fireCourse` releases them. Same-tx outbox INSERTs, so the enqueue rolls back with the fire and
  // never blocks it (no hardware I/O).
  const firedItems = inserted
    .filter((row) => row.firedAt !== null)
    .map((row) => ({ workingOrderLineId: row.workingOrderLineId, stationId: row.stationId }));
  await enqueueKitchenTickets(tx, cfg, orderId, firedItems);
}

/**
 * Release held items of a course by stamping fired_at. Require the course to exist
 * in this venue, including a deactivated course whose food still needs release.
 * Already-fired items retain their timestamps; an empty held set is a no-op.
 */
export async function fireCourse(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  courseId: string,
): Promise<void> {
  await requireCourse(tx, cfg, courseId);
  const firedItems = await tx
    .update(ticketItems)
    .set({ firedAt: sql`now()` })
    .where(
      and(
        eq(ticketItems.workingOrderId, orderId),
        eq(ticketItems.courseId, courseId),
        isNull(ticketItems.firedAt),
      ),
    )
    .returning({
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
    });
  // Print-on-fire (KDS-4 §3c): the `fired_at IS NULL` predicate matched EXACTLY the items that fired now
  // (a held course being released), so `RETURNING` is precisely this round's newly-fired set — no earlier
  // round is re-selected, and a re-fire of an already-fired course matches zero rows and enqueues
  // nothing. Same-tx outbox INSERTs, so the enqueue rolls back with the fire and never blocks it.
  await enqueueKitchenTickets(tx, cfg, orderId, firedItems);
}

/**
 * Send selected held lines of an open tab, refreshing queued_at when they fire.
 * The caller's transaction includes kitchen writes and their print jobs.
 */
export async function sendLines(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lineNos: number[],
): Promise<void> {
  await lockOpenTab(tx, tabId);
  // Empty list ⇒ no line filter ⇒ every HELD line of the tab fires ("send all together"). A non-empty
  // list restricts the fire to the ticket items whose line is in the set. The subquery selects from
  // `working_order_lines` (its own FROM), so its bare `"id"` resolves inward and the outer
  // `ticket_items."working_order_line_id"` stays qualified — verified with `.toSQL()`; not a correlated
  // subquery, so the CLAUDE.md base-vs-join bare-column hazard does not apply.
  const lineFilter =
    lineNos.length === 0
      ? undefined
      : inArray(
          ticketItems.workingOrderLineId,
          tx
            .select({ id: workingOrderLines.id })
            .from(workingOrderLines)
            .where(
              and(
                eq(workingOrderLines.workingOrderId, tabId),
                inArray(workingOrderLines.lineNo, lineNos),
              ),
            ),
        );
  const firedItems = await tx
    .update(ticketItems)
    .set({ firedAt: sql`now()`, queuedAt: sql`now()` })
    .where(
      and(
        eq(ticketItems.workingOrderId, tabId),
        isNull(ticketItems.firedAt),
        ...(lineFilter ? [lineFilter] : []),
      ),
    )
    .returning({
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
    });
  // Print-on-fire (KDS-4 §3c): the `fired_at IS NULL` predicate matched EXACTLY the lines that fired now,
  // so `RETURNING` is precisely this send's newly-fired set — a re-send of an already-fired line matches
  // zero rows and enqueues nothing. Same-tx outbox INSERTs, so the enqueue rolls back with the fire.
  await enqueueKitchenTickets(tx, cfg, tabId, firedItems);
}

/**
 * Recall selected lines of an open tab only while their items remain queued.
 * Refuse the whole call if a line is missing or any item has started. Previously
 * fired lines enqueue correction slips in the same transaction; held lines do not.
 * Leave queued_at untouched until a later send refreshes it.
 */
export async function recallLines(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lineNos: number[],
): Promise<void> {
  await lockOpenTab(tx, tabId);
  if (lineNos.length === 0) {
    return;
  }
  // Resolve every named line by `(working_order_id, line_no)` — an absent line_no yields no row for it
  // (→ tab.line_not_found, the resolve-or-throw the sibling single-line tab verbs make, naming the first
  // that matches nothing).
  const lines = await tx
    .select({ lineNo: workingOrderLines.lineNo, id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(
      and(eq(workingOrderLines.workingOrderId, tabId), inArray(workingOrderLines.lineNo, lineNos)),
    );
  const foundLineNos = new Set(lines.map((r) => r.lineNo));
  for (const lineNo of lineNos) {
    if (!foundLineNos.has(lineNo)) {
      throw new AppError("tab.line_not_found", { tabId, lineNo });
    }
  }
  const lineIds = lines.map((r) => r.id);
  // Race-safe read (Copilot #191, twin of setLineCourse). {@link fireCourse} stamps `fired_at` on
  // `ticket_items` WITHOUT taking {@link lockOpenTab}, so the tab-row lock above does NOT serialise it: a
  // concurrent `fireCourse` firing (and PRINTING) a held line BETWEEN this lock-free read and the un-fire
  // below would leave the line seen as not-previously-fired here — so it would be un-fired with NO RECALLED
  // slip enqueued, while the kitchen ticket `fireCourse` printed is never pulled. So take a ROW LOCK on the
  // named lines' held ticket-item rows (`FOR UPDATE`) BEFORE reading `state`/`fired_at` for the started
  // check AND the RECALLED capture. A concurrent `fireCourse`'s `UPDATE ticket_items` on any of these rows
  // then BLOCKS until this tx commits, serialising the two: either this recall wins (reads the line held,
  // un-fires it, nothing printed, no slip) or `fireCourse` wins (line fires + prints, and this recall then
  // reads it as previously-fired → un-fires AND enqueues the RECALLED slip). A line with NO ticket item yet
  // (a pending line) contributes no row: not started, never fired, un-fire is a no-op. Single-table lock,
  // NOT a LEFT JOIN, so no lock-through-outer-join hazard. `working_order_line_id` is unique on
  // `ticket_items`, so each line contributes at most one row. Read BEFORE the un-fire so a STARTED
  // (preparing/ready) line can be named in the refusal and `fired_at` reflects the pre-recall state.
  const items = await tx
    .select({
      ticketItemId: ticketItems.id,
      workingOrderLineId: ticketItems.workingOrderLineId,
      state: ticketItems.state,
      firedAt: ticketItems.firedAt,
      stationId: ticketItems.stationId,
    })
    .from(ticketItems)
    .where(inArray(ticketItems.workingOrderLineId, lineIds))
    .for("update");
  // Refuse the WHOLE call if any named line has started (nothing is un-fired unless every line is
  // recallable). A started line has a ticket item, so it appears in `items`.
  const started = items.find((r) => r.state === "preparing" || r.state === "ready");
  if (started !== undefined) {
    throw new AppError("ticket.already_started", { ticketItemId: started.ticketItemId });
  }
  // A6: the correction set is the PREVIOUSLY-FIRED lines this recall actually un-fires — `fired_at`
  // non-null AND `state = 'queued'` (the same rows the update below matches AND that had paper out). A
  // held line (`fired_at` already null) never printed and is excluded, so it produces no slip. `fired_at`
  // non-null implies a joined ticket-item row, so `stationId` is non-null there.
  const recalled = items
    .filter((r) => r.firedAt !== null && r.state === "queued")
    .map((r) => ({ workingOrderLineId: r.workingOrderLineId, stationId: r.stationId! }));
  // Un-fire only the queued items of the named lines — an already-held line (fired_at already null) is
  // matched but its clear is a no-op, and a started line never reaches here (refused above).
  await tx
    .update(ticketItems)
    .set({ firedAt: null })
    .where(
      and(
        eq(ticketItems.workingOrderId, tabId),
        eq(ticketItems.state, "queued"),
        inArray(ticketItems.workingOrderLineId, lineIds),
      ),
    );
  // Tell the paper kitchen to pull each previously-printed recalled line (no-op when `recalled` is empty).
  await enqueueCorrectionSlips(tx, cfg, tabId, recalled, "RECALLED");
}

/**
 * Bump every fired item of this order and course directly to ready. Held items
 * are skipped. An empty match is a no-op; this operation changes kitchen state only.
 */
export async function bumpCourseReady(
  tx: Transaction,
  _cfg: TillConfig,
  orderId: string,
  courseId: string,
): Promise<void> {
  await tx
    .update(ticketItems)
    .set(advanceSet("ready"))
    .where(
      and(
        eq(ticketItems.workingOrderId, orderId),
        eq(ticketItems.courseId, courseId),
        ne(ticketItems.state, "ready"),
        isNotNull(ticketItems.firedAt),
      ),
    );
}

/**
 * Dispatch ready items of a course by stamping away_at once. Require an existing
 * course in this venue, including deactivated courses with plated food remaining.
 * Items still cooking and items already away are unchanged.
 */
export async function markCourseAway(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  courseId: string,
): Promise<void> {
  await requireCourse(tx, cfg, courseId);
  await tx
    .update(ticketItems)
    .set({ awayAt: sql`now()` })
    .where(
      and(
        eq(ticketItems.workingOrderId, orderId),
        eq(ticketItems.courseId, courseId),
        eq(ticketItems.state, "ready"),
        isNull(ticketItems.awayAt),
      ),
    );
}

/**
 * APPEND a priced round to an OPEN tab (design §3b) — the one genuinely new order primitive. It locks
 * each new line's `unit_price_gross` at add-time (via `priceOrderLines`) and assigns the NEXT `line_no`,
 * WITHOUT deleting or re-pricing existing lines. Contrast `updateHeldOrder`, which deletes and re-inserts
 * the whole basket (`:633-634`), re-locking every line at the current catalogue price — wrong for an
 * incremental tab.
 *
 * Concurrency (load-bearing for QR ordering — multiple guests append to one shared tab at once): the tab
 * row is taken `FOR UPDATE` by {@link lockOpenTab}, which serialises concurrent writers to this tab on
 * the `working_orders` row lock, so the `max(line_no)+1` read-then-insert below cannot interleave. A
 * naïve `max(line_no)+1` without the lock races and collides on the `working_order_lines`
 * `(working_order_id, line_no)` unique — a real-PG concurrent test proves it by deletion of the lock.
 */
export async function addTabRound(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  // KDS-2: each round line MAY carry an optional `courseId` override, threaded into `priceOrderLines`
  // where the line's course resolves to `override ?? product.course_id` (§2b). Ordering modifiers
  // (Task 6): a line MAY also carry `options`, expanded there into parent + child rows. Per-line
  // customisation (`LineExtras`): a line MAY carry a `note`/`doneness` (NON-FISCAL), persisted on the
  // parent dish line and snapshotted onto its ticket item at fire. Coursing editing (A3): a line MAY carry
  // `hold: true` — insert it HELD (no fire, no print) regardless of course; the marker is correlated onto
  // the priced PARENT row below and read by `fireLines`. All optional, so existing callers (and the till's
  // current `{productId, quantity}` send-round) are unchanged.
  lines: ({
    productId: string;
    quantity: string;
    courseId?: string | null;
    options?: { optionGroupItemId: string; quantity?: number }[];
    hold?: boolean;
  } & LineExtras)[],
): Promise<void> {
  await lockOpenTab(tx, tabId);
  if (lines.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }
  // The next line_no, allocated under the per-tab row lock — concurrent rounds serialise on it, so no two
  // reads see the same max.
  const [{ maxLineNo }] = await tx
    .select({ maxLineNo: sql<number>`coalesce(max(${workingOrderLines.lineNo}), 0)::int` })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId));
  // Price the round (locks each new gross unit at add-time), then APPEND: renumber from maxLineNo+1,
  // never touching existing lines. `priceOrderLines` numbers its rows 1..n in `lines` order, so row i
  // maps to maxLineNo + i + 1.
  const { lineRows } = await priceOrderLines(tx, cfg, tabId, lines);
  const appended = lineRows.map((row, i) => ({ ...row, lineNo: maxLineNo + i + 1 }));
  // TS-1 appends the round; KDS-1 fires it (design §3b, the tab round-send fire point) — insert the new
  // lines and send each to the kitchen as a ticket item. `returning` gives the line ids (pre-generated
  // by `priceOrderLines` so a child's `parent_line_id` resolves in the insert) that `fireLines`
  // snapshots the resolved station onto, plus each line's `product_id` and resolved `course_id` that
  // `fireLines` needs for routing + the hold-and-fire decision (§3c) — read back here instead of
  // `fireLines` re-selecting it.
  const appendedLines = await tx.insert(workingOrderLines).values(appended).returning({
    id: workingOrderLines.id,
    productId: workingOrderLines.productId,
    courseId: workingOrderLines.courseId,
    parentLineId: workingOrderLines.parentLineId,
    note: workingOrderLines.note,
    doneness: workingOrderLines.doneness,
    lineNo: workingOrderLines.lineNo,
  });
  // Coursing editing (A3): correlate each input round line's `hold` onto the PARENT row `priceOrderLines`
  // produced for it. `priceOrderLines` emits one PARENT row (`parentLineId === null`) per input line, in
  // INPUT ORDER, each immediately followed by its option CHILD rows (verified at its source: a single loop
  // over `lines` pushes the parent then its children into `lineMeta`, and `lineRows[i]` maps 1-for-1 to
  // that parent-then-children expansion). `appended` stamps `line_no = maxLineNo + i + 1` in that same
  // order, so the parents carry ASCENDING `line_no` in input-line order — the k-th parent by `line_no` is
  // input line k. Correlate on that sorted `line_no` rather than on the `RETURNING` array position, so the
  // hold-to-parent mapping does not depend on the INSERT emitting rows in VALUES order. A CHILD row is
  // never held (it has no ticket item — `fireLines` filters it out anyway) → `hold: false`. Pinned
  // end-to-end by the modifier-first correlation test, which fires the wrong dish on an off-by-one.
  const holdByParentId = new Map<string, boolean>();
  appendedLines
    .filter((row) => row.parentLineId === null)
    .sort((a, b) => a.lineNo - b.lineNo)
    .forEach((row, k) => holdByParentId.set(row.id, lines[k]?.hold === true));
  const withHold = appendedLines.map((row) => ({
    ...row,
    hold: row.parentLineId === null ? (holdByParentId.get(row.id) ?? false) : false,
  }));
  // Fire the round: `fireLines` fires only the PARENT dish lines and NEVER a child modifier line
  // (`parent_line_id` set) — a modifier is part of its dish, not its own kitchen ticket. The parent-only
  // filter lives in `fireLines` (the shared chokepoint), so this passes the whole set (parents AND
  // children) straight through, exactly as placeOrder/sendToPrep do. `hold` rides through per parent.
  await fireLines(tx, cfg, tabId, withHold);
}

/**
 * Void ONE not-yet-paid line from an OPEN tab (design §3b) — pre-fiscal, so nothing is filed and there
 * is no fiscal record or amendment involved; it is a plain delete under the open parent (the
 * `require_open_parent` trigger is the DB backstop). {@link lockOpenTab} locks the tab row `FOR UPDATE`
 * so a concurrent round/pay cannot race the delete, and confirms it is an open tab. `tab.not_open` if the
 * order is not an open tab; `tab.line_not_found` if the `line_no` matches nothing on it.
 *
 * CORRECTION PRINT (A6): if the voided line had ALREADY FIRED (printed) — its ticket item carries a
 * non-null `fired_at` — a VOID correction slip tells the paper kitchen to bin it. The ticket item is read
 * BEFORE the delete (the `ON DELETE CASCADE` from `working_order_lines` removes both the line AND its
 * ticket item), capturing `{workingOrderLineId, stationId}`; a held line (`fired_at` null) or a directly
 * voided CHILD modifier (no ticket item of its own) captures nothing and prints nothing. The enqueue runs
 * BEFORE the delete — {@link enqueueCorrectionSlips} RE-READS the line's qty/name/modifiers from
 * `working_order_lines`, which the cascade is about to remove — and rides the same tx (rolls back with it).
 */
export async function voidTabLine(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lineNo: number,
): Promise<void> {
  await lockOpenTab(tx, tabId);
  // FIX 2: a parent dish takes its modifiers with it (design §6). Resolve the named line's id first so
  // its child modifier lines (`parent_line_id = <that id>`) can be removed in the SAME delete — the
  // self-referential `working_order_lines_parent_fk` is NO ACTION (0080), checked at statement END, so
  // deleting the parent alone would orphan its children and raise 23503 (an opaque `server.internal`
  // 500 on a normal tab edit). Deleting both in one statement satisfies the FK at statement end.
  // Voiding a CHILD line directly matches only itself (a modifier has no children), so this is a plain
  // one-row delete in that case — unchanged behaviour.
  // A6: resolve the named line AND its (at most one) ticket item in ONE round trip via a LEFT JOIN, still
  // BEFORE the delete (the `ON DELETE CASCADE` removes both). An absent line yields zero rows (→
  // tab.line_not_found); a held line, or a directly voided CHILD modifier (no ticket item), joins to null
  // ticket columns. `working_order_line_id` is unique on `ticket_items`, so at most one row.
  const [target] = await tx
    .select({
      id: workingOrderLines.id,
      firedAt: ticketItems.firedAt,
      stationId: ticketItems.stationId,
    })
    .from(workingOrderLines)
    .leftJoin(
      ticketItems,
      and(
        eq(ticketItems.tenantId, workingOrderLines.tenantId),
        eq(ticketItems.workingOrderLineId, workingOrderLines.id),
      ),
    )
    .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, lineNo)));
  if (target === undefined) {
    throw new AppError("tab.line_not_found", { tabId, lineNo });
  }
  // Only a PARENT that has fired carries a non-null `fired_at` (which implies a joined ticket-item row, so
  // `stationId` is non-null there); a held line or a child modifier yields nothing to correct.
  const voided =
    target.firedAt !== null
      ? [{ workingOrderLineId: target.id, stationId: target.stationId! }]
      : [];
  // Enqueue the VOID slip BEFORE the delete — enqueueCorrectionSlips re-reads the line from
  // `working_order_lines`, which the cascade below is about to remove (no-op when `voided` is empty).
  await enqueueCorrectionSlips(tx, cfg, tabId, voided, "VOID");
  await tx
    .delete(workingOrderLines)
    .where(
      and(
        eq(workingOrderLines.workingOrderId, tabId),
        or(eq(workingOrderLines.id, target.id), eq(workingOrderLines.parentLineId, target.id)),
      ),
    );
}

/**
 * Move ONE not-yet-fired line of an OPEN tab into another kitchen course, or clear its course to null
 * (coursing editing A1, design §3b). {@link lockOpenTab} locks the tab row `FOR UPDATE` and confirms it
 * is an open tab a `dining_tables.tab_id` points at (else `tab.not_open`), serialising this re-course
 * against a concurrent round/void the way every tab verb does. A non-null target is screened with
 * {@link requireLiveCourse} — the SAME live-course definition the config/fire verbs use, so an absent /
 * foreign / RETIRED course is `course.not_found` (a deactivated course is not a valid new target); a
 * malformed (non-uuid) id is screened to that same code at the ROUTE before it reaches this uuid cast.
 *
 * The named line is resolved by `(working_order_id, line_no)` — `tab.line_not_found` if none matches,
 * exactly as {@link voidTabLine}. A line whose ticket item has already FIRED (`fired_at IS NOT NULL`) is
 * REFUSED with `ticket.already_fired` (naming the order): once the kitchen has been told to cook a line,
 * it is corrected via a recall, never silently re-coursed underneath the pass. Otherwise BOTH the open-tab
 * line's `course_id` AND its held ticket item's `course_id` snapshot are updated — the ticket-item UPDATE
 * matches no row (a no-op) when the line has no held item yet, so a not-yet-fired line without a ticket
 * item re-courses cleanly too.
 *
 * PRE-FISCAL (design H2): `course_id` is a kitchen-routing field written only while the parent order is
 * open; it never enters `registros`/`computeHuella`/`recordSale` (the pay path rebuilds `sale_lines` from
 * the locked price snapshot), so this touches nothing filed.
 */
export async function setLineCourse(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lineNo: number,
  courseId: string | null,
): Promise<void> {
  await lockOpenTab(tx, tabId);
  if (courseId !== null) {
    await requireLiveCourse(tx, cfg, courseId);
  }
  // Resolve the named line by `(working_order_id, line_no)` — `tab.line_not_found` if none matches, exactly
  // as {@link voidTabLine}.
  const [line] = await tx
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, lineNo)));
  if (line === undefined) {
    throw new AppError("tab.line_not_found", { tabId, lineNo });
  }
  // Race-safe fired check (Copilot #191). {@link fireCourse} stamps `fired_at` on `ticket_items` WITHOUT
  // taking {@link lockOpenTab}, so the tab-row lock above does NOT serialise it: a concurrent `fireCourse`
  // could fire this line AFTER a lock-free read of `fired_at` and BEFORE this verb's write, re-coursing an
  // already-fired line under the pass. So take a ROW LOCK on this line's held ticket item (`FOR UPDATE`)
  // BEFORE reading `fired_at`. A concurrent `fireCourse`'s `UPDATE ticket_items` on the same row then BLOCKS
  // until this tx commits, serialising the two: either we re-course the held line (and it fires LATER under
  // its new course — `fireCourse`'s `course_id` predicate re-reads the moved row and skips it) or
  // `fireCourse` fires first and this SELECT then reads `fired_at` set and throws `ticket.already_fired`. A
  // line with NO ticket item yet (a pending line) locks zero rows and has no fire to race — the check below
  // is skipped and the `ticket_items` update stays a 0-row no-op. This REVERTS the simplify pass's LEFT-JOIN
  // fold here (correctness over the one-query micro-optimisation); the sibling `voidTabLine`/`recallLines`
  // folds keep theirs. `working_order_line_id` is unique on `ticket_items`, so at most one row is locked.
  const [item] = await tx
    .select({ firedAt: ticketItems.firedAt })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, line.id))
    .for("update");
  // A line whose kitchen ticket has already fired is corrected via recall, not moved — refuse it here.
  if (item !== undefined && item.firedAt != null) {
    throw new AppError("ticket.already_fired", { workingOrderId: tabId });
  }
  await tx.update(workingOrderLines).set({ courseId }).where(eq(workingOrderLines.id, line.id));
  // Update the HELD ticket item's course snapshot too — a no-op (0 rows) when the line has no item yet.
  await tx.update(ticketItems).set({ courseId }).where(eq(ticketItems.workingOrderLineId, line.id));
}

/**
 * Set (or clear) ONE line's `served_at` on an OPEN tab — the shared body of {@link markLineServed} and
 * {@link unmarkLineServed}. {@link lockOpenTab} locks the tab row `FOR UPDATE` and confirms it is an
 * open tab a `dining_tables.tab_id` points at (else `tab.not_open`), then a single conditional UPDATE
 * writes the line: `served ? now() : null`. `now()` is the DATABASE clock (the venue's server time),
 * not a JS instant — the served marker is a floor-UI signal, so the write is stamped where every other
 * timestamp on this row is. A 0-row UPDATE (no such `line_no` on the tab) throws `tab.line_not_found`,
 * exactly as {@link voidTabLine}'s delete does.
 *
 * PRE-FISCAL (design H2, ruling R4): `served_at` is written only while the parent order is `open` and
 * is NEVER read into a filed record — the pay path rebuilds `sale_lines` from the locked price snapshot
 * (`priceLockedLines`), never this column, so this touches nothing filed. The
 * `working_order_lines_require_open_parent` trigger is the DB backstop that a served write cannot reach
 * a non-open parent even if this app guard were bypassed.
 */
async function setLineServed(
  tx: Transaction,
  tabId: string,
  lineNo: number,
  served: boolean,
): Promise<void> {
  await lockOpenTab(tx, tabId);
  const updated = await tx
    .update(workingOrderLines)
    .set({ servedAt: served ? sql`now()` : null })
    .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, lineNo)))
    .returning({ lineNo: workingOrderLines.lineNo });
  if (updated.length === 0) {
    throw new AppError("tab.line_not_found", { tabId, lineNo });
  }
}

/**
 * Mark one line of an open tab as served. The route requires an operator session;
 * setLineServed performs the shared update. The marker is operational data.
 */
export async function markLineServed(
  tx: Transaction,
  _cfg: TillConfig,
  tabId: string,
  lineNo: number,
): Promise<void> {
  await setLineServed(tx, tabId, lineNo, true);
}

/**
 * Clear ONE line's delivered marker on an OPEN tab — `served_at = NULL` (the inverse of
 * {@link markLineServed}, for a mis-tap). Same session gating, same `tab.not_open`/`tab.line_not_found`
 * guards, same shared body and H2 pre-fiscal note (see {@link setLineServed}).
 */
export async function unmarkLineServed(
  tx: Transaction,
  _cfg: TillConfig,
  tabId: string,
  lineNo: number,
): Promise<void> {
  await setLineServed(tx, tabId, lineNo, false);
}

/**
 * Move working-order lines from one OPEN tab to another (design §3) — the shared primitive `mergeTabs`
 * calls with ALL lines and TS-4 (transfer) will call with a subset, so it is written general now to
 * avoid a TS-4 refactor. Reads the named lines (default all), APPENDS them onto `toTab` at the next
 * `line_no`s with every locked price column carried across UNCHANGED (a move NEVER re-prices — the
 * add-time `working_order_lines.unit_price_gross` column is what the filed sale is later rebuilt from),
 * then deletes them from `fromTab`.
 *
 * Refuses a self-transfer (`fromTabId === toTabId`) with `tab.merge_self` BEFORE any read or write. In
 * the "move all" shape (no `lineNos`) a self-transfer would append every line as a duplicate and then
 * the trailing delete — keyed on `workingOrderId = fromTabId`, which is now ALSO `toTabId` — would match
 * BOTH the originals and the just-inserted duplicates, emptying the tab. `mergeTabs` already guards this
 * at its own top, but `moveTabLines` is the exported primitive TS-4 (transfer) calls directly, so the
 * guard lives here too, reusing the `tab.merge_self` code (one tab named as both ends — the same concept).
 *
 * Both tabs are locked `FOR UPDATE` in ASCENDING `id` order — a DEFENSIVE, plan-independent lock-order
 * discipline, NOT a deadlock-safety property any concurrent test at THIS level exercises: this primitive's
 * only caller today (`mergeTabs`) has already taken both `working_orders` row locks (in this same
 * ascending-id order) before `moveTabLines` runs, so the re-lock here is a deliberate no-op and no
 * `moveTabLines`-level race reaches this ordering. (mergeTabs's OWN lock order — `working_orders` before
 * `dining_tables` — is what carries the merge-vs-pay deadlock safety; see there.) These locks are on
 * `working_orders`, whose `id` is its PRIMARY KEY, so `mergeTabs`'s unindexed-`tab_id` seq-scan argument
 * does not apply to this leg. Their status is read off the locked copies: a non-`open` parent is refused
 * `tab.not_open` (moving lines under a settled/abandoned order would violate
 * `working_order_lines_require_open_parent` anyway). The lock on `toTab` also serialises `line_no`
 * allocation the way `addTabRound`'s per-tab lock does, so a concurrent append/move cannot collide on the
 * `working_order_lines` `(working_order_id, line_no)` unique. Runs on the CALLER's transaction under its
 * tenant/app_user scope.
 */
export async function moveTabLines(
  tx: Transaction,
  fromTabId: string,
  toTabId: string,
  lineNos?: number[],
): Promise<void> {
  // Refuse a self-transfer before any read/write (see the docstring): the "move all" shape would append
  // every line as a duplicate and then delete BOTH copies, emptying the tab. mergeTabs guards this too,
  // but this primitive is called directly by TS-4. Reuses tab.merge_self — one tab named as both ends.
  if (fromTabId === toTabId) {
    throw new AppError("tab.merge_self", { tabId: fromTabId });
  }
  const locked = await tx
    .select({ id: workingOrders.id, status: workingOrders.status })
    .from(workingOrders)
    .where(or(eq(workingOrders.id, fromTabId), eq(workingOrders.id, toTabId)))
    .orderBy(workingOrders.id)
    .for("update");
  const from = locked.find((r) => r.id === fromTabId);
  const to = locked.find((r) => r.id === toTabId);
  if (from === undefined || from.status !== "open") {
    throw new AppError("tab.not_open", { tabId: fromTabId });
  }
  if (to === undefined || to.status !== "open") {
    throw new AppError("tab.not_open", { tabId: toTabId });
  }

  const sourceWhere =
    lineNos === undefined
      ? eq(workingOrderLines.workingOrderId, fromTabId)
      : and(
          eq(workingOrderLines.workingOrderId, fromTabId),
          inArray(workingOrderLines.lineNo, lineNos),
        );

  // Read the lines to move (locked price columns kept verbatim), in line_no order. `id`/`parentLineId`/
  // `optionGroupItemId` come too so a moved CHILD modifier line's parent→child linkage is rebuilt onto
  // the destination rather than dropped — without them the re-INSERT below lands every child with a NULL
  // `parent_line_id` and renders it ungrouped (Task 6 modifiers).
  const source = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      optionGroupItemId: workingOrderLines.optionGroupItemId,
      tenantId: workingOrderLines.tenantId,
      productId: workingOrderLines.productId,
      descriptions: workingOrderLines.descriptions,
      quantity: workingOrderLines.quantity,
      unitPrice: workingOrderLines.unitPrice,
      unitPriceGross: workingOrderLines.unitPriceGross,
      vatRate: workingOrderLines.vatRate,
      lineTotal: workingOrderLines.lineTotal,
      category: workingOrderLines.category,
    })
    .from(workingOrderLines)
    .where(sourceWhere)
    .orderBy(workingOrderLines.lineNo);

  // The next free line_no on the destination, allocated under the toTab lock above (no race).
  const [agg] = await tx
    .select({ next: sql<number>`coalesce(max(${workingOrderLines.lineNo}), 0)::int` })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, toTabId));
  const base = agg!.next;

  // Pre-generate the destination ids so a moved CHILD's `parent_line_id` can name its moved PARENT's NEW
  // id in the SAME insert (the self-referential FK is checked at statement end — parent and children go
  // in together), mirroring `priceOrderLines`/`recordSale`'s `byLineNo` remap. `newIdByOldId` maps each
  // source line's OLD id to its new one; a child's remapped parent is another moved line. `?? null`
  // covers a PARTIAL move (`transferLines` passing a `lineNos` subset) that carries a child WITHOUT its
  // parent — the child lands top-level rather than pointing at a deleted source row; `mergeTabs` moves
  // ALL of a tab's lines, so there every parent moves with its children and the map is total.
  const newIds = source.map(() => randomUUID());
  const newIdByOldId = new Map(source.map((line, i) => [line.id, newIds[i]!]));

  // Append onto the destination, then delete from the source. Guarded: an EMPTY source (or empty subset)
  // has nothing to insert and `tx.insert(...).values([])` errors — the same guard createOpenOrder uses.
  if (source.length > 0) {
    await tx.insert(workingOrderLines).values(
      source.map((line, i) => ({
        id: newIds[i]!,
        tenantId: line.tenantId,
        workingOrderId: toTabId,
        lineNo: base + i + 1,
        parentLineId:
          line.parentLineId == null ? null : (newIdByOldId.get(line.parentLineId) ?? null),
        optionGroupItemId: line.optionGroupItemId,
        productId: line.productId,
        descriptions: line.descriptions,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        unitPriceGross: line.unitPriceGross,
        vatRate: line.vatRate,
        lineTotal: line.lineTotal,
        category: line.category,
      })),
    );
  }
  await tx.delete(workingOrderLines).where(sourceWhere);
}

/**
 * Assert a working order is an OPEN tab, else throw `tab.not_open` (design §3) — the one definition of
 * "this tab is open" that `moveTab`/`joinTable` both gate on, so the check cannot drift between them. A
 * single UNLOCKED status read: deliberately NOT `lockOpenTab`, which takes `FOR UPDATE` and checks a
 * `dining_tables` back-pointer both verbs intentionally avoid (see their docstrings).
 */
async function assertTabOpen(tx: Transaction, tabId: string): Promise<void> {
  const [tab] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, tabId));
  if (tab === undefined || tab.status !== "open") {
    throw new AppError("tab.not_open", { tabId });
  }
}

/** One line of an OPEN tab, for the table-order screen (FP-1, design §3b). `unitPriceGross` is the gross
 *  unit price LOCKED at add-time (`working_order_lines.unit_price_gross`), NOT a re-price; `servedAt` is
 *  the pre-fiscal served marker (`null` ⇒ "Pendiente de servir", a timestamp ⇒ "Servido"). Carries the
 *  `productId` only — no product name, mirroring `HeldOrder`: the screen resolves names from its own
 *  catalogue prop. `quantity` is numeric(_,3) text, `unitPriceGross` numeric(_,2) text. */
export interface TabLine {
  lineNo: number;
  // Nullable since ordering modifiers (Task 2): a child modifier line has no product. Child-line
  // rendering on the tab lands in Task 6; today every tab line still carries a product.
  productId: string | null;
  quantity: string;
  unitPriceGross: string;
  servedAt: string | null;
  /** The line's RESOLVED kitchen course (KDS-2 `working_order_lines.course_id`), or null when it has
   * none (a null-course line fires immediately). The tab-order screen groups the waiter-fire actions by
   * this; the course NAME comes from the venue course list the boot payload carries, not from here. */
  courseId: string | null;
  /** When the line's kitchen ticket item was FIRED (`ticket_items.fired_at`), or null when no LIVE
   * ticket item of the line's has fired. Null covers two overlapping cases: a line whose course is still
   * HELD (the tab surfaces a "Fire <course>" action for each course with a held line under
   * `fire_control = 'waiter'`, §5b), and — since this is LEFT-joined — a line with no ticket item at all,
   * the same edge the adjacent `state` field documents. That no-item shape is reachable for a real PARENT
   * line, e.g. a line {@link openTab} inserted with the tab's initial round (its `lines` go through
   * {@link createOpenOrder}, which never fires) or one moved between tabs ({@link moveTabLines}, used by
   * both merge and transfer, re-inserts the line under a new id without re-firing). Course is independent:
   * {@link setLineCourse} clears a HELD line's course to null (it refuses only a FIRED line), so a null
   * `firedAt` says nothing about whether `courseId` is null. */
  firedAt: string | null;
  /** The line's kitchen ticket item's `state` (`ticket_items.state`), or null when the line has no
   * ticket item — the same LEFT-join edge {@link firedAt} documents. A child modifier line ALWAYS lacks
   * one ({@link fireLines} filters children out of the fire). A parent line normally has one once
   * fired/held, but can also lack one — e.g. a line {@link openTab} inserted without firing (its
   * initial `lines` go through {@link createOpenOrder}, which never calls {@link fireLines}), or one
   * moved between tabs ({@link moveTabLines}, used by both merge and transfer, re-inserts the line
   * under a brand-new id without re-firing, cascading the old id's item away). Treat null as "no LIVE
   * ticket item", not as impossible for a parent. Coursing corrections (C1): distinguishes a RECALLABLE
   * line (`firedAt` set, `state === "queued"`, not yet started) from a CANCEL-only one (`state`
   * "preparing"/"ready") — the till reads this, not implemented here. */
  state: TicketState | null;
}

/**
 * Read an open tab's lines in line-number order, including their stored gross prices
 * and served markers. No catalogue re-price or write lock is taken.
 */
export async function readTabLines(
  tx: Transaction,
  _cfg: TillConfig,
  tabId: string,
): Promise<TabLine[]> {
  await assertTabOpen(tx, tabId);
  // LEFT JOIN each line's kitchen ticket item (KDS-2) to carry its `fired_at` AND `state` (coursing
  // corrections, C1) — one item per line at most (`ticket_items` is UNIQUE on
  // `(tenant_id, working_order_line_id)`), so the join never multiplies rows. `course_id` is read from
  // `working_order_lines` (the authoritative ring-time resolution), not the item snapshot, so a line with
  // no ticket item still reports its course; `fired_at`/`state` have no home but the item, so both are
  // null when the join finds none. A child modifier line ALWAYS has no ticket item (`fireLines` filters
  // children out of the fire); a PARENT line normally has one once fired/held, but can also have none —
  // e.g. `openTab`'s initial `lines` are inserted without firing, or `moveTabLines` (merge/transfer)
  // re-inserts a moved line under a brand-new id without re-firing it. Treat null as "no LIVE ticket
  // item", not as impossible for a parent. Both columns feed the tab's per-course waiter-fire (§5b) and
  // the till's recall-vs-cancel-only distinction (`firedAt` set + `state === "queued"` ⇒ recallable,
  // `state` "preparing"/"ready" ⇒ cancel-only); the existing pay/serve columns are unchanged.
  return tx
    .select({
      lineNo: workingOrderLines.lineNo,
      productId: workingOrderLines.productId,
      quantity: workingOrderLines.quantity,
      unitPriceGross: workingOrderLines.unitPriceGross,
      servedAt: workingOrderLines.servedAt,
      courseId: workingOrderLines.courseId,
      firedAt: ticketItems.firedAt,
      state: ticketItems.state,
    })
    .from(workingOrderLines)
    .leftJoin(
      ticketItems,
      and(
        eq(ticketItems.tenantId, workingOrderLines.tenantId),
        eq(ticketItems.workingOrderLineId, workingOrderLines.id),
      ),
    )
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);
}

/**
 * Assert a move/join TARGET table exists, is `active`, and is FREE — the one occupancy predicate the
 * whole table-service feature rests on (design §3), shared by `moveTab`/`joinTable` so the three-way
 * check cannot drift between them. `table` is the caller's already-fetched-and-`FOR UPDATE`-locked row
 * (or undefined). "Free" = `tab_id` null OR pointing at a settled/abandoned order (a stale pointer,
 * TS-1 §2b); a still-`open` pointed order throws `table.occupied` ("use merge"). Throws
 * `table.not_found`/`table.inactive`/`table.occupied`, each naming the caller-supplied `tableId`.
 */
async function assertTableAvailable(
  tx: Transaction,
  table: { tabId: string | null; active: boolean } | undefined,
  tableId: string,
): Promise<void> {
  if (table === undefined) {
    throw new AppError("table.not_found", { tableId });
  }
  if (!table.active) {
    throw new AppError("table.inactive", { tableId });
  }
  if (table.tabId !== null) {
    const [pointed] = await tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(and(eq(workingOrders.id, table.tabId), eq(workingOrders.status, "open")));
    if (pointed !== undefined) {
      throw new AppError("table.occupied", { tableId });
    }
  }
}

/**
 * Free every table currently covered by `tabId` — `tab_id` + `status_id → NULL` in one tenant-scoped
 * statement. A turnover: the freed table's TS-2 manual status must not linger onto the next party
 * (design §4). Shared by `moveTab` (freeing the source) and `mergeTabs`'s consolidate branch.
 */
async function freeTablesCoveredBy(tx: Transaction, cfg: TillConfig, tabId: string): Promise<void> {
  await tx
    .update(diningTables)
    .set({ tabId: null, statusId: null })
    .where(and(eq(diningTables.tenantId, cfg.tenantId), eq(diningTables.tabId, tabId)));
}

/**
 * Relocate a party to a free table (design §3). Validates `tabId` is an `open` working order
 * (`tab.not_open`) and `toTableId` is `active` (`table.not_found`/`table.inactive`) and FREE — its
 * `tab_id` is null or points at a settled/abandoned order (a stale pointer, TS-1 §2b), else
 * `table.occupied` ("use merge"). Then frees the tab's current source table(s) and points the target at
 * the tab. NO line-move, no fiscal effect.
 *
 * Locks the involved `dining_tables` rows (target + the tab's current source table(s)) `FOR UPDATE` in
 * ASCENDING `id` order — a DEFENSIVE, plan-independent lock-order discipline shared across the
 * table-service verbs, NOT a deadlock-safety property any concurrent test exercises (this verb's race
 * test proves the single TARGET-row lock below, not the multi-row ordering). Locking the target
 * is the concurrency guard: a second concurrent move onto the same free table blocks, then re-reads its
 * now-set `tab_id` and is refused `table.occupied` (proven by deletion of this lock — §7). The tab's own
 * `working_orders` row is NOT locked (a move neither settles nor abandons it — unlike merge); a race
 * with a concurrent pay leaves at worst a harmless stale pointer, which the occupancy read ignores.
 *
 * The freed source table(s) get `tab_id → NULL` AND `status_id → NULL` in one statement — a move is a
 * turnover for the source, so its TS-2 manual status must not linger onto the next party (design §4).
 * The TARGET table is turned over too: pointing the tab at it also clears its `status_id → NULL`, so a
 * stale status left from the target's PREVIOUS party does not linger onto the moved-in one — exactly as
 * `openTab` clears status when a fresh tab opens on a table (design §4). The TS-2 settle-trigger does
 * not fire on a move (the tab stays open), so both clears are EXPLICIT here.
 */
export async function moveTab(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  toTableId: string,
): Promise<void> {
  await assertTabOpen(tx, tabId);

  const involved = await tx
    .select({ id: diningTables.id, tabId: diningTables.tabId, active: diningTables.active })
    .from(diningTables)
    .where(or(eq(diningTables.id, toTableId), eq(diningTables.tabId, tabId)))
    .orderBy(diningTables.id)
    .for("update");
  await assertTableAvailable(
    tx,
    involved.find((t) => t.id === toTableId),
    toTableId,
  );

  // Free the source table(s) the tab currently covers, then point the target — clearing ITS status_id
  // too, since the moved-in party turns the target over (openTab parity, design §4).
  await freeTablesCoveredBy(tx, cfg, tabId);
  await tx
    .update(diningTables)
    .set({ tabId, statusId: null })
    .where(eq(diningTables.id, toTableId));
}

/**
 * Join an active, free table to an open tab. Lock the target table before checking
 * occupancy so concurrent joins serialize. The existing tab lines remain in place.
 */
export async function joinTable(
  tx: Transaction,
  _cfg: TillConfig,
  tabId: string,
  tableId: string,
): Promise<void> {
  await assertTabOpen(tx, tabId);

  const [table] = await tx
    .select({ id: diningTables.id, tabId: diningTables.tabId, active: diningTables.active })
    .from(diningTables)
    .where(eq(diningTables.id, tableId))
    .for("update");
  await assertTableAvailable(tx, table, tableId);

  await tx.update(diningTables).set({ tabId }).where(eq(diningTables.id, tableId));
}

/**
 * Combine two tabs onto one bill (design §3). Validates both are DISTINCT (`tab.merge_self`) `open`
 * working orders (`tab.not_open`), then moves ALL of `fromTab`'s lines onto `intoTab`, re-points
 * `fromTab`'s table(s), and abandons the now-empty `fromTab`. The merged `intoTab` (holding every line)
 * files ONE sale on pay; `fromTab`, abandoned and empty, files nothing — no double-file (H2, §5).
 *
 * `freeSourceTable = true` frees the source table (`tab_id` + `status_id → NULL` — the 2+2 CONSOLIDATE
 * case, the source turns over); `false` re-points it at `intoTab` (both tables now covered by the one
 * bill — the 4+4 JOIN case, and the joined table KEEPS its status, design §4).
 *
 * Lock order — both `working_orders` rows `FOR UPDATE` ASCENDING id FIRST, THEN the involved
 * `dining_tables` rows (those covered by either tab) `FOR UPDATE` ASCENDING id. This MATCHES the
 * sale/settle/abandon path: `payWorkingOrder` (till-sale.ts) locks the `working_orders` row `FOR UPDATE`,
 * then its settle UPDATE fires the 0050 `working_orders_clear_table_status` trigger, which UPDATEs
 * `dining_tables WHERE tab_id = NEW.id` — i.e. `working_orders` then `dining_tables`; `collectOrder`
 * (settle, which locks its `working_orders` row with an explicit `SELECT … FOR UPDATE`) and
 * `abandonHeldOrder` (abandon, via its conditional `UPDATE working_orders`) each lock the
 * `working_orders` row BEFORE the same trigger touches `dining_tables` — the identical two-class order.
 * Acquiring in that identical order is what PREVENTS a mergeTabs-vs-pay/settle/abandon DEADLOCK:
 * a concurrent merge and pay both take `working_orders` before `dining_tables`, so they cannot
 * cross-lock and trip a 40P01. THIS leg's order is load-bearing and proven — the concurrent merge/pay
 * race test (move-merge.pg.test.ts) asserts no 40P01, and by deletion the previous
 * `dining_tables`-first order reproduces the 40P01 against the real trigger.
 *
 * The `dining_tables` leg's OWN ascending-id order is, by contrast, DEFENSIVE not proven load-bearing:
 * for a merge-vs-merge (same-verb) race the `dining_tables` lock is on the UNINDEXED `tab_id`, so both
 * backends seq-scan the two rows in identical heap order and serialise on the first regardless of the
 * `.orderBy`. The ascending-id discipline on that leg only future-proofs against a schema/plan change
 * that lets scan orders diverge; a same-verb race cannot prove it load-bearing (a §1 "both answers look
 * alike" measurement). The deterministic hazard control (move-merge.pg.test.ts) proves the general
 * inconsistent-order 40P01 hazard is real.
 *
 * ORDER MATTERS (Plan note 2): the re-point (step 2) precedes the abandon (step 3). The TS-2
 * `working_orders_clear_table_status` trigger fires on the `open → abandoned` transition and clears
 * `status_id` WHERE `tab_id = fromTabId`; because step 2 has already re-pointed every such table away
 * from `fromTabId`, that trigger matches nothing. Were the abandon first, it would clear the status on a
 * table that stays JOINED (`freeSourceTable:false`) — contradicting design §4.
 */
export async function mergeTabs(
  tx: Transaction,
  cfg: TillConfig,
  intoTabId: string,
  fromTabId: string,
  options: { freeSourceTable: boolean },
): Promise<void> {
  if (intoTabId === fromTabId) {
    throw new AppError("tab.merge_self", { tabId: intoTabId });
  }

  // Lock working-order rows before dining-table rows, with each set ordered by id.
  // Check the order status before acquiring table locks.
  const tabs = await tx
    .select({ id: workingOrders.id, status: workingOrders.status })
    .from(workingOrders)
    .where(or(eq(workingOrders.id, intoTabId), eq(workingOrders.id, fromTabId)))
    .orderBy(workingOrders.id)
    .for("update");
  const into = tabs.find((t) => t.id === intoTabId);
  const from = tabs.find((t) => t.id === fromTabId);
  if (into === undefined || into.status !== "open") {
    throw new AppError("tab.not_open", { tabId: intoTabId });
  }
  if (from === undefined || from.status !== "open") {
    throw new AppError("tab.not_open", { tabId: fromTabId });
  }
  await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .where(or(eq(diningTables.tabId, intoTabId), eq(diningTables.tabId, fromTabId)))
    .orderBy(diningTables.id)
    .for("update");

  // 1. Move ALL of fromTab's lines onto intoTab (locked prices preserved), both still open.
  //    moveTabLines re-locks + re-validates these two rows as open — a deliberate no-op re-lock here
  //    (we already hold and checked them), because moveTabLines is a standalone primitive TS-4 calls
  //    directly and must self-validate; the extra round trip is accepted rather than couple the two.
  await moveTabLines(tx, fromTabId, intoTabId);

  // 2. Re-point fromTab's table(s) BEFORE the abandon (Plan note 2).
  if (options.freeSourceTable) {
    await freeTablesCoveredBy(tx, cfg, fromTabId);
  } else {
    await tx
      .update(diningTables)
      .set({ tabId: intoTabId })
      .where(and(eq(diningTables.tenantId, cfg.tenantId), eq(diningTables.tabId, fromTabId)));
  }

  // 3. Abandon the now-empty fromTab (open → abandoned; the working_orders_enforce_transition state
  //    machine permits it).
  await tx
    .update(workingOrders)
    .set({ status: "abandoned" })
    .where(eq(workingOrders.id, fromTabId));
}

/**
 * The GROSS (VAT-inclusive) line total for `quantity` units at a LOCKED gross unit price, at
 * {@link MONEY_SCALE}, half away from zero — the SAME composition `@waitron/catalogue`'s `priceRows`
 * uses for a line's gross total (`toScale(multiplyDecimal(grossUnit, decimal(quantity)), MONEY_SCALE)`),
 * which is what `priceBasket` writes at add-time and `priceLockedLines` recomputes at file-time. Used by
 * {@link transferLines}' split path so a split line's `working_order_lines.line_total` is byte-identical
 * to an add-time line's — the identical helper composition, over the line's OWN locked
 * `working_order_lines.unit_price_gross`, never a catalogue re-read. Both arguments arrive as
 * `numeric`-as-text (a stored `unit_price_gross`, a transfer or remainder quantity); `decimal()`
 * validates each into the branded-`Decimal` helpers, and accepts an already-branded `Decimal` unchanged.
 */
function grossLineTotal(grossUnit: string, quantity: string): string {
  return toScale(multiplyDecimal(decimal(grossUnit), decimal(quantity)), MONEY_SCALE);
}

/**
 * Refuse a carve-off batch that names the same source `line_no` more than once, BEFORE any lock, mint or
 * write (`tab.transfer_duplicate_line`, naming the FIRST line_no that repeats). A repeated line_no does
 * NOT conserve quantity: every entry is validated against the STATIC pre-batch snapshot of the line's
 * quantity (never updated between entries) and the split write sets the source to `original − q` (a plain
 * set, not a cumulative decrement), so two partial "1"s off a café×3 line both pass and the destination
 * gains 1.000+1.000 while the source only drops to 2.000 — 4 from an original 3. A whole-line + partial
 * pair on one line is worse and contradictory: the whole-line path DELETEs the line while the split's
 * `UPDATE … WHERE line_no=…` then matches zero rows and its INSERT still fabricates a destination line.
 * Neither shape folds into a cumulative decrement, so a duplicate is simply refused (a 400 request-shape
 * fault). Shared by {@link transferLines} (both ends tabs) and {@link splitOffCheck} (detached check); a
 * duplicate WHOLE-line pair — already harmless via `moveTabLines`' `inArray` set semantics — is refused
 * too, which is fine/stricter.
 */
function assertDistinctTransferLines(tabId: string, transfers: { lineNo: number }[]): void {
  const seenLineNos = new Set<number>();
  for (const { lineNo } of transfers) {
    if (seenLineNos.has(lineNo)) {
      throw new AppError("tab.transfer_duplicate_line", { tabId, lineNo });
    }
    seenLineNos.add(lineNo);
  }
}

/**
 * Transfer selected lines between two open tabs in the caller's transaction.
 * Whole-line transfers move the line; partial transfers preserve its stored unit
 * prices and divide its quantity. Validate the entire batch before any move.
 * Lock both working-order rows in ascending id order so opposite transfers acquire
 * the same first lock. Each tab files its own sale when paid.
 */
export async function transferLines(
  tx: Transaction,
  cfg: TillConfig,
  fromTabId: string,
  toTabId: string,
  transfers: { lineNo: number; quantity?: string }[],
): Promise<void> {
  // A tab cannot transfer to itself — refused before any lock (which would take the row twice).
  if (fromTabId === toTabId) {
    throw new AppError("tab.transfer_self", { tabId: fromTabId });
  }

  // A batch may name each source line_no AT MOST once — refused before any lock or write (the same
  // pre-lock rejection this verb has always made; see {@link assertDistinctTransferLines} for why a
  // repeated line_no cannot conserve quantity).
  assertDistinctTransferLines(fromTabId, transfers);

  // Acquire both working-order locks in ascending id order. lockOpenTab also
  // requires each order to be open and referenced by a dining table.
  for (const tabId of [fromTabId, toTabId].sort()) {
    await lockOpenTab(tx, tabId);
  }

  // The origin and destination row locks are held; carry the items over (whole lines + partial splits).
  await carveOffLines(tx, cfg, fromTabId, toTabId, transfers);
}

/**
 * Carry `transfers` (whole lines and/or partial-quantity splits) from `fromTabId` onto `toTabId`, keeping
 * each unit's LOCKED price columns (no catalogue re-read) and CONSERVING quantity — the shared move/split
 * core of {@link transferLines} (TS-4) and {@link splitOffCheck} (TS-5). It performs NO locking of its
 * own: the CALLER must already hold the `FOR UPDATE` row locks on both orders (`transferLines` via its
 * `lockOpenTab` loop, requiring both ends to be TABS; `splitOffCheck` via its own origin lock, its
 * destination being a freshly-minted, uncontended check). Every transfer is VALIDATED before any move or
 * split runs (`tab.line_not_found` for an absent `line_no`, `tab.transfer_quantity_invalid` for a
 * quantity outside `0 < q ≤ line.quantity` or a malformed literal, `tab.transfer_modifier_line` for a
 * modifier child named alone or a partial split of a dish carrying modifiers — ordering modifiers FIX
 * 2/4), so one bad entry leaves both orders untouched. The whole-line path delegates to
 * {@link moveTabLines} (which accepts any OPEN destination, so a table-less check is a valid target —
 * unlike `lockOpenTab`) and cascades a dish's modifier children along with it; the split path appends new
 * destination lines after the moves. `cfg` supplies the `tenant_id` stamped on each split-inserted line.
 */
async function carveOffLines(
  tx: Transaction,
  cfg: TillConfig,
  fromTabId: string,
  toTabId: string,
  transfers: { lineNo: number; quantity?: string }[],
): Promise<void> {
  // Read ALL of fromTab's lines ONCE, under the lock, into a map — not just the named ones: the
  // parent↔child structure (FIX 2/4) needs the WHOLE tab to know which named lines are dishes carrying
  // modifiers and which are modifier children. `id`/`parentLineId`/`optionGroupItemId` come too. The
  // per-unit locked values a split INHERITS also come from here — never a catalogue re-read.
  const sourceLines = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      optionGroupItemId: workingOrderLines.optionGroupItemId,
      productId: workingOrderLines.productId,
      descriptions: workingOrderLines.descriptions,
      quantity: workingOrderLines.quantity,
      unitPrice: workingOrderLines.unitPrice,
      unitPriceGross: workingOrderLines.unitPriceGross,
      vatRate: workingOrderLines.vatRate,
      category: workingOrderLines.category,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, fromTabId))
    .orderBy(workingOrderLines.lineNo);
  const byLineNo = new Map(sourceLines.map((l) => [l.lineNo, l]));
  // The `line_no`s of each dish's child modifier lines, keyed by the PARENT's `line_no` — so a
  // whole-line move of a dish can cascade its modifiers along (FIX 2), and a partial split can refuse a
  // dish that has any (FIX 4). Built from `parent_line_id → parent's line_no` over the same tab.
  const lineNoById = new Map(sourceLines.map((l) => [l.id, l.lineNo]));
  const childLineNosByParent = new Map<number, number[]>();
  for (const l of sourceLines) {
    if (l.parentLineId == null) {
      continue;
    }
    const parentLineNo = lineNoById.get(l.parentLineId);
    if (parentLineNo === undefined) {
      continue;
    }
    const siblings = childLineNosByParent.get(parentLineNo) ?? [];
    siblings.push(l.lineNo);
    childLineNosByParent.set(parentLineNo, siblings);
  }

  // Validate EVERY transfer before moving/splitting anything (Task 5), then partition: a WHOLE-line
  // move (`quantity` omitted, OR equal to the line's full quantity) vs a PARTIAL split (`quantity`
  // given and strictly less). A quantity equal to the line's own quantity is routed to the whole-line
  // path rather than the split path — splitting it would REDUCE the source to zero, which violates
  // `working_order_lines_quantity_ck` (`quantity <> 0`). `compareDecimal` is value-wise across scales,
  // so "2" == "2.000" and a weighed "0.320" == "0.320" both count as whole-line moves.
  const wholeLineNos: number[] = [];
  const partials: { line: (typeof sourceLines)[number]; quantity: string }[] = [];
  for (const t of transfers) {
    const line = byLineNo.get(t.lineNo);
    if (line === undefined) {
      throw new AppError("tab.line_not_found", { tabId: fromTabId, lineNo: t.lineNo });
    }
    // FIX 2: a modifier CHILD line may not be named directly — it transfers only WITH its dish (a
    // parent whole-line move cascades its children below). Naming it alone would orphan it: the source
    // child would reference a deleted parent (23503) or land ungrouped on the destination. Refuse.
    if (line.parentLineId != null) {
      throw new AppError("tab.transfer_modifier_line", { tabId: fromTabId, lineNo: t.lineNo });
    }
    const childLineNos = childLineNosByParent.get(t.lineNo) ?? [];
    if (t.quantity === undefined) {
      // Whole-line move of a dish (or a plain line): cascade its modifier children so a parent takes
      // them with it and `moveTabLines` remaps the child→parent link onto the destination (FIX 2).
      wholeLineNos.push(t.lineNo, ...childLineNos);
      continue;
    }
    // Validate the requested quantity: a well-formed decimal in `0 < quantity ≤ line.quantity`. A
    // malformed literal makes `decimal()` throw `shared.invalid_decimal` — treated as invalid and
    // reported as the SAME domain code as an out-of-range one (one throw site), so a bad quantity
    // never surfaces as that raw code or as a `working_order_lines_quantity_ck`/other DB CHECK violation.
    let inRange: boolean;
    try {
      const q = decimal(t.quantity);
      inRange =
        compareDecimal(q, decimal("0")) > 0 && compareDecimal(q, decimal(line.quantity)) <= 0;
    } catch {
      inRange = false;
    }
    if (!inRange) {
      throw new AppError("tab.transfer_quantity_invalid", {
        tabId: fromTabId,
        lineNo: t.lineNo,
        quantity: t.quantity,
      });
    }
    // Full quantity → a whole-line move (no zero remnant, Task 4), cascading any modifier children;
    // otherwise a split. The quantity is now known valid, so this re-compare's `decimal()` cannot throw.
    if (compareDecimal(decimal(t.quantity), decimal(line.quantity)) === 0) {
      wholeLineNos.push(t.lineNo, ...childLineNos);
    } else {
      // FIX 4: a PARTIAL split of a dish that carries modifiers has no coherent meaning this slice
      // (there is no per-option quantity, so the children's quantity would desync from the split dish).
      // Refuse rather than file an inconsistent draft; a plain line (no children) splits as before.
      if (childLineNos.length > 0) {
        throw new AppError("tab.transfer_modifier_line", { tabId: fromTabId, lineNo: t.lineNo });
      }
      partials.push({ line, quantity: t.quantity });
    }
  }

  // Whole lines first: `moveTabLines` keeps each locked price and appends at the destination's next
  // `line_no`(s).
  if (wholeLineNos.length > 0) {
    await moveTabLines(tx, fromTabId, toTabId, wholeLineNos);
  }

  // Then the splits. Allocate destination `line_no`s AFTER the moves (so they don't collide with moved
  // rows): read the current max under the lock and hand out max+1, max+2, ... in order — the same
  // per-tab allocation `addTabRound`/`moveTabLines` make, safe against the
  // `(working_order_id, line_no)` unique because the destination row is held FOR UPDATE by the lock loop.
  if (partials.length > 0) {
    const [{ maxLineNo }] = await tx
      .select({ maxLineNo: sql<number>`coalesce(max(${workingOrderLines.lineNo}), 0)::int` })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, toTabId));
    for (let i = 0; i < partials.length; i++) {
      const { line, quantity } = partials[i]!;
      const remaining = subtractDecimal(decimal(line.quantity), decimal(quantity));
      // Source line: quantity drops, `line_total` recomputed from the SAME locked gross (no re-price).
      await tx
        .update(workingOrderLines)
        .set({ quantity: remaining, lineTotal: grossLineTotal(line.unitPriceGross, remaining) })
        .where(
          and(
            eq(workingOrderLines.workingOrderId, fromTabId),
            eq(workingOrderLines.lineNo, line.lineNo),
          ),
        );
      // Destination: a NEW line inheriting every per-unit value, `quantity = transferred`, `line_total`
      // = round(transferred × locked gross). NEVER re-fetched from the catalogue.
      await tx.insert(workingOrderLines).values({
        // Stamp the destination line with the configured tenant id.
        tenantId: cfg.tenantId,
        workingOrderId: toTabId,
        lineNo: maxLineNo! + i + 1,
        productId: line.productId,
        // FIX 4: carry the catalogue traceability across, as `moveTabLines` does — a split must not
        // drop `option_group_item_id`. `parent_line_id` is deliberately NOT carried: the refusal above
        // guarantees a splittable line is top-level (no parent, no children), so it is always NULL here;
        // carrying the source's raw id would (were the refusal relaxed) point at a line on the SOURCE.
        optionGroupItemId: line.optionGroupItemId,
        descriptions: line.descriptions,
        quantity,
        unitPrice: line.unitPrice,
        unitPriceGross: line.unitPriceGross,
        vatRate: line.vatRate,
        lineTotal: grossLineTotal(line.unitPriceGross, quantity),
        category: line.category,
      });
    }
  }
}

/**
 * Spin selected items off an OPEN tab into a NEW, separately-filing CHECK (split-bill, TS-5). A check
 * is an ordinary `open` working order — created lineless via `createOpenOrder` (inheriting the origin's
 * node/till and, at pay, `cfg.seriesId`) — that NO table points at: it is a payment unit, not a seat
 * (design §2), so unlike a tab there is no `dining_tables.tab_id` back-pointer to set. Because the check
 * is table-less, the items are carried over by {@link carveOffLines} directly (TS-4's whole/partial
 * move/split core, which delegates whole lines to `moveTabLines`) rather than by `transferLines` — whose
 * `lockOpenTab` loop requires BOTH ends to be tabs and would reject a detached check. The move keeps each
 * unit's LOCKED `unit_price_gross` (no catalogue re-look-up) and CONSERVES quantity, so the check and the
 * origin remainder each stay internally consistent and each files its OWN correct desglose on its own pay
 * (design §4), and it raises TS-4's inherited `tab.transfer_quantity_invalid` / `tab.line_not_found`.
 *
 * Pay the check with the EXISTING `payWorkingOrder` (till-sale.ts) — there is NO new pay verb, and the
 * `sales_working_order_id_key` UNIQUE (tenant_id, working_order_id) makes it file AT MOST ONE sale.
 * Called once per check; the origin holds the remainder (emptied ⇒ abandon it with the existing
 * `abandonHeldOrder`, or pay it as the last check — design §3). Runs on the CALLER's tx/tenant scope.
 *
 * Refuses an EMPTY `transfers` array with `sale.empty_basket`, BEFORE minting the check: `carveOffLines`
 * renders `inArray(col, [])` as `false`, a no-op WHERE clause, so without this guard the call would
 * otherwise succeed and leave an orphan — a table-less `open` working order with zero lines and a
 * consumed order_number.
 */
export async function splitOffCheck(
  tx: Transaction,
  cfg: TillConfig,
  fromTabId: string,
  transfers: { lineNo: number; quantity?: string }[],
): Promise<{ checkId: string }> {
  // Refuse an EMPTY transfers array BEFORE minting anything. carveOffLines' `inArray(col, [])` renders
  // `false` — a no-op WHERE clause — so without this guard the call below would SUCCEED after
  // createOpenOrder had already minted a check: a table-less `open` working order, zero lines, a
  // consumed order_number. An orphan. Same "nothing to work with" shape as the walk-up/park/round paths'
  // `sale.empty_basket` (see this file's own doc comment at line ~221).
  if (transfers.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }

  // Refuse a batch naming a source line_no twice BEFORE locking, minting the check, or moving anything —
  // the same up-front guard `transferLines` makes (a duplicate does not conserve quantity: two "1"s off a
  // 3× line would leave 2 on the origin AND 2 on the check, 4 from an original 3). Reused so split-bill
  // inherits it, naming the origin tab.
  assertDistinctTransferLines(fromTabId, transfers);

  // Lock + validate the origin is an OPEN TAB (table-anchored) before minting the check — fail fast
  // with the `tab.not_open` guard design §3 names, before the needless work of `createOpenOrder` (its
  // catalogue read + `allocateOrderNumber`). The origin MUST be a tab, not merely any open order: the
  // spec §3 and the `/api/tabs/:id/split` route require a table-anchored tab, so a detached CHECK (a
  // table-less open order minted by a prior split) must NOT be a split origin. `lockOpenTab` adds the
  // is-a-tab `dining_tables` back-pointer assertion `lockOpenTabRow` (status-only) lacks; it holds NO
  // `dining_tables` lock (the pointer read is a plain SELECT, {@link lockOpenTab}), so this reintroduces
  // no lock-order/deadlock concern. Ordering is about doing LESS WORK, not saving an order number:
  // everything here runs on the caller's `tx`, so a later rollback undoes the mint AND the counter
  // increment together (`allocateOrderNumber` is a transactional UPSERT into `working_order_counters`,
  // `packages/db/src/allocate-order-number.ts` — a rolled-back allocation leaves no gap). The FOR UPDATE
  // also serialises a concurrent carve-off of the same tab (TS-3/TS-4 lock discipline).
  await lockOpenTab(tx, fromTabId);

  // Mint + create the DETACHED check: a lineless `open` working order (createOpenOrder's empty-lines
  // guard, TS-1), with NO `dining_tables.tab_id` pointing at it. It inherits node/till from `cfg`.
  const checkId = randomUUID();
  await createOpenOrder(tx, cfg, checkId, [], null);

  // Move the selected items (whole lines + partial splits) onto the check — TS-4's shared move/split
  // core, which keeps the locked gross, conserves quantity, and raises the inherited
  // `tab.transfer_quantity_invalid` / `tab.line_not_found` guards. The origin row is already locked
  // above and the check is a fresh, uncontended row, so no further lock is needed here. A failure rolls
  // back the whole tx, check included — no orphan.
  await carveOffLines(tx, cfg, fromTabId, checkId, transfers);

  return { checkId };
}

/**
 * Detach a table from a joined tab (TS-5, deferred from TS-3). WITH items: the table keeps running its
 * OWN bill — create a new `open` tab ANCHORED to it (its `tab_id` repointed) and move the items over
 * (TS-4's {@link transferLines}). WITHOUT items: just free it (`tab_id → NULL`) and clear its TS-2
 * manual `status_id` (a turnover — the same "clear on turnover" TS-3's `moveTab` applies at the move
 * boundary). Unlike a split-off CHECK, an un-joined table's new tab IS table-anchored: it is still a
 * seat, not a payment unit (design §2). Returns the new `tabId` (with items) or `{}` (freed). Runs on
 * the caller's tx scope.
 *
 * Lock order — the shared `working_orders` tab row `FOR UPDATE` FIRST (via {@link lockOpenTabRow}), THEN
 * the `dining_tables[tableId]` row. This MATCHES the sale/settle path and {@link mergeTabs}:
 * `payWorkingOrder` locks the tab's `working_orders` row, then its settle UPDATE fires the 0050
 * `working_orders_clear_table_status` trigger UPDATE-ing `dining_tables WHERE tab_id = NEW.id` (which
 * includes `tableId` while it is joined) — i.e. `working_orders` THEN `dining_tables`. Acquiring in that
 * SAME class order is what PREVENTS an unjoin-vs-pay/settle DEADLOCK: a concurrent unjoin and pay both
 * take `working_orders` before `dining_tables`, so they cannot cross-lock and trip a 40P01. This is
 * load-bearing and proven — the concurrent unjoin/pay race test (split-bill.pg.test.ts) asserts no
 * 40P01, and by deletion the previous `dining_tables`-first order reproduces the 40P01 against the real
 * trigger. (The status check therefore fires BEFORE the `dining_tables` lock; in every tested scenario
 * only one guard fails at a time, so the thrown code is unchanged from the old order.)
 *
 * The with-items branch repoints the detached table BEFORE the move, so both `tabId` (still covered by
 * its origin table(s)) and `newTabId` (now covered by the detached table) are TABS when {@link
 * transferLines} runs — which is exactly why the reuse is `transferLines` here, not `splitOffCheck`'s
 * bare `carveOffLines`: `splitOffCheck`'s destination is table-LESS and would be rejected by
 * `transferLines`' `lockOpenTab` back-pointer check, whereas an un-joined table's new tab passes it. So
 * `transferLines` gives the correct is-a-tab validation AND the ascending-id lock ordering for free,
 * over a `newTabId` that is a freshly-minted, uncontended row (no deadlock hazard against the origin
 * lock this verb already holds). `transferLines` re-locks `tabId` (a no-op — already held above) and
 * only ever takes further `working_orders` locks over `newTabId`, so the class order stays
 * working_orders-before-dining_tables throughout.
 */
export async function unjoinTable(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  tableId: string,
  transfers?: { lineNo: number; quantity?: string }[],
): Promise<{ tabId?: string }> {
  // Lock the shared tab's working_orders row FIRST (see the docstring's lock-order note): it must be
  // OPEN — you cannot re-carve a settled/abandoned bill — else `tab.not_open`. Taking this BEFORE the
  // dining_tables lock is the deadlock-safe order the sale/settle path uses.
  await lockOpenTabRow(tx, tabId);

  // Then lock the table row; it must currently be joined to THIS tab (else `table.not_joined` — an
  // absent/foreign table, a free table, or one joined to a DIFFERENT tab all read as tab_id ≠ tabId and
  // fail closed, design §3).
  const [table] = await tx
    .select({ tabId: diningTables.tabId })
    .from(diningTables)
    .where(eq(diningTables.id, tableId))
    .for("update");
  if (table?.tabId !== tabId) {
    throw new AppError("table.not_joined", { tableId, tabId });
  }

  if (transfers === undefined || transfers.length === 0) {
    // Free it: null the back-pointer AND the TS-2 status in ONE statement (turnover — the tab left this
    // table, the same idiom `moveTab`/`openTab` use). Files nothing (pre-fiscal). Other tables joined to
    // the tab keep pointing at it.
    await tx
      .update(diningTables)
      .set({ tabId: null, statusId: null })
      .where(eq(diningTables.id, tableId));
    return {};
  }

  // With items: split them off onto a NEW tab. This only makes sense when `tableId` is one of ≥2 tables
  // sharing `tabId` — you un-join a table FROM a join. If `tableId` is the SOLE table anchoring `tabId`,
  // the repoint below would leave `tabId` anchorless and `transferLines`' `lockOpenTab` back-pointer
  // check would throw a MISLEADING `tab.not_open` on a tab that IS open. Reject honestly, before minting
  // anything, when no OTHER table anchors this tab.
  const [otherAnchor] = await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .where(and(eq(diningTables.tabId, tabId), ne(diningTables.id, tableId)))
    .limit(1);
  if (otherAnchor === undefined) {
    throw new AppError("table.not_shared", { tableId, tabId });
  }

  // Create a new lineless `open` tab, ANCHOR it to this table, then move the items onto it
  // with `transferLines` — repointing FIRST makes `newTabId` a real tab (back-pointer set) so
  // `transferLines`' is-a-tab lock passes. `transferLines` re-locks `tabId` (a no-op — already held
  // above) and `newTabId` (fresh), in ascending-id order.
  const newTabId = randomUUID();
  await createOpenOrder(tx, cfg, newTabId, [], null);
  await tx.update(diningTables).set({ tabId: newTabId }).where(eq(diningTables.id, tableId));
  await transferLines(tx, cfg, tabId, newTabId, transfers);
  return { tabId: newTabId };
}

/** One row of the held-orders list the counter shows to retrieve a parked order. */
export interface HeldOrderSummary {
  id: string;
  orderNumber: number;
  /** The operator-supplied label ("Mesa 4"), or null when the order was parked without one. */
  label: string | null;
  /** Number of lines on the order (`count(lines)`, so 0 for a lineless order), a whole number. */
  itemCount: number;
  /**
   * Sum of the lines' `line_total`, which for a working-order DRAFT is the GROSS (VAT-inclusive)
   * customer-facing total — EQUAL to the basket grand total the operator saw (`priceBasket(...).total`).
   * A numeric(12,2) as text, the codebase's money shape. (The FILED `sale_lines.line_total` is net;
   * the draft deliberately diverges — see `working_order_lines.line_total`'s schema comment.)
   */
  total: string;
  openedAt: string;
}

/** A retrieved order: enough to name it in the UI plus the inputs to rebuild its basket. */
export interface HeldOrder {
  id: string;
  orderNumber: number;
  label: string | null;
  /**
   * `product_id` + `quantity` per line, in `line_no` order — the till re-adds each to the basket.
   * `productId` is nullable since ordering modifiers (Task 2) made `working_order_lines.product_id`
   * nullable for child modifier lines; the till re-pricing that reads it (child-line handling) lands
   * in Tasks 4/6, so today every parked line still carries a product.
   */
  lines: { productId: string | null; quantity: string }[];
}

/**
 * List the venue's open parked orders (venue-wide, till-reroute §3.6 — not node-scoped), ordered by
 * order number. Aggregate stored gross line totals and line counts, retaining orders with no lines.
 */
export async function listHeldOrders(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
): Promise<HeldOrderSummary[]> {
  return withTenant(deps.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return (
      tx
        .select({
          id: workingOrders.id,
          orderNumber: workingOrders.orderNumber,
          label: workingOrders.label,
          itemCount: sql<number>`count(${workingOrderLines.id})::int`,
          total: sql<string>`coalesce(sum(${workingOrderLines.lineTotal}), 0)::numeric(12, 2)::text`,
          openedAt: workingOrders.openedAt,
        })
        .from(workingOrders)
        // Composite join predicate (tenant_id too, not order id alone): the same tenant-consistency the
        // schema's composite FKs enforce, so a line only aggregates onto an order of its own tenant.
        .leftJoin(
          workingOrderLines,
          and(
            eq(workingOrderLines.workingOrderId, workingOrders.id),
            eq(workingOrderLines.tenantId, workingOrders.tenantId),
          ),
        )
        // Venue-wide, not node-scoped (till-reroute design §3.6): under warm standby one node sells at a time,
        // and a promoted node inherits the venue's open tabs tagged with the dead node's id (swap spec §4.3).
        // `node_id` is still written at create — the writer's id, for replication — and never filtered on here.
        // Scoped to the tenant (the venue), the way report-api's venue-wide reads are: `withTenant` no longer
        // isolates SELECTs since RLS was dropped, so the tenant predicate is the read's own scope.
        .where(and(eq(workingOrders.tenantId, cfg.tenantId), eq(workingOrders.status, "open")))
        .groupBy(
          workingOrders.id,
          workingOrders.orderNumber,
          workingOrders.label,
          workingOrders.openedAt,
        )
        .orderBy(workingOrders.orderNumber)
    );
  });
}

/**
 * Read an open parked order anywhere in the venue (venue-wide, till-reroute §3.6 — not node-scoped).
 * Return product ids and quantities in line-number order so the till can rebuild and re-price the basket.
 * Scoped to the tenant, not the id alone: `withTenant` no longer isolates SELECTs since RLS was dropped
 * (#255), so the tenant predicate is this by-id read's own boundary — a foreign-tenant id reads as absent.
 */
export async function getHeldOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
): Promise<HeldOrder> {
  return withTenant(deps.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);

    const [order] = await tx
      .select({
        id: workingOrders.id,
        orderNumber: workingOrders.orderNumber,
        label: workingOrders.label,
      })
      .from(workingOrders)
      .where(
        and(
          eq(workingOrders.tenantId, cfg.tenantId),
          eq(workingOrders.id, id),
          eq(workingOrders.status, "open"),
        ),
      );

    if (order === undefined) {
      throw new AppError("working_order.not_found", { workingOrderId: id });
    }

    const lines = await tx
      .select({
        productId: workingOrderLines.productId,
        quantity: workingOrderLines.quantity,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);

    return { id: order.id, orderNumber: order.orderNumber, label: order.label, lines };
  });
}

/**
 * An edit to a parked order: the whole new basket (`lines`) plus an optional new `label`. Like
 * `ParkOrderRequest` it carries NO price — the server re-reads the catalogue and re-prices with
 * `priceBasket`, so a browser cannot influence the snapshot. It carries no `id` (that addresses the
 * order, a separate argument) and no `order_number`/`node_id` (those are fixed at park and never move).
 * The basket is a full REPLACEMENT, not a delta: whatever the till sends becomes the order's lines.
 */
export interface UpdateHeldOrderRequest {
  // A line MAY carry per-line `LineExtras` (NON-FISCAL), forwarded to `priceOrderLines`.
  lines: ({ productId: string; quantity: string } & LineExtras)[];
  label?: string;
}

/**
 * Update an open held order anywhere in the venue (venue-wide, till-reroute §3.6) using the current
 * catalogue prices. The caller's transaction keeps the order and replacement lines together.
 */
export async function updateHeldOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
  req: UpdateHeldOrderRequest,
): Promise<void> {
  return withTenant(
    deps.db,
    cfg.tenantId,
    async (tx) => {
      await asAppUser(tx);

      // Lock the order row for the life of the tx, then read its status off the locked copy. Absent or
      // not-open → `working_order.not_open`; the DB triggers (enforce_transition on the label update,
      // require_open_parent on the line delete/insert) are the backstop if this app check is ever wrong.
      // Scoped to the tenant, then venue-wide within it (till-reroute §3.6 — any node's open tab is
      // editable): the tenant predicate is this read's own boundary since RLS was dropped (#255), so a
      // foreign-tenant id misses the lock and reads as absent rather than reaching the line insert (a
      // raw 23503). `status` stays off the WHERE so a closed order is told from an absent one in the tx.
      const [order] = await tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(and(eq(workingOrders.tenantId, cfg.tenantId), eq(workingOrders.id, id)))
        .for("update");

      if (order === undefined || order.status !== "open") {
        throw new AppError("working_order.not_open", { workingOrderId: id });
      }

      // Refused before any line is touched: an empty basket has nothing to price, and rewriting an
      // order to zero lines is a discard, which is `abandonHeldOrder`'s job, not this one's. The same
      // unconditional guard `parkOrder` makes.
      if (req.lines.length === 0) {
        throw new AppError("sale.empty_basket", {});
      }

      // Price the new basket (refusing an unknown product) BEFORE deleting anything, so a bad line
      // aborts the tx with the parked order still intact. Then swap the lines wholesale: the parent is
      // open (checked above, held under the lock), so the line delete and the re-insert both satisfy
      // `require_open_parent`, and the re-numbered `line_no`s start from 1.
      // An edit only rewrites the persisted lines; `priced` is `payWorkingOrder`'s walk-up shortcut, unused here.
      const { lineRows } = await priceOrderLines(tx, cfg, id, req.lines);
      await tx.delete(workingOrderLines).where(eq(workingOrderLines.workingOrderId, id));
      await tx.insert(workingOrderLines).values(lineRows);

      // Runs over the `enforce_transition` trigger (OLD.status = 'open', so it passes). `req.label`
      // absent clears any prior label to NULL — the whole request is the new state, labels included.
      await tx
        .update(workingOrders)
        .set({ label: req.label ?? null })
        .where(eq(workingOrders.id, id));
    },
    { nodeId: cfg.nodeId },
  );
}

/**
 * Abandon an open held order anywhere in the venue (venue-wide, till-reroute §3.6). The conditional
 * status update leaves settled_at null because abandonment does not settle an order. Scoped to the
 * tenant, not the id alone: `withTenant` no longer isolates writes' row selection since RLS was dropped
 * (#255), so the tenant predicate is this by-id abandon's own boundary — a foreign-tenant id matches
 * nothing and reads as `working_order.not_open` rather than abandoning another tenant's order.
 */
export async function abandonHeldOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
): Promise<void> {
  return withTenant(
    deps.db,
    cfg.tenantId,
    async (tx) => {
      await asAppUser(tx);

      const updated = await tx
        .update(workingOrders)
        .set({ status: "abandoned" })
        .where(
          and(
            eq(workingOrders.tenantId, cfg.tenantId),
            eq(workingOrders.id, id),
            eq(workingOrders.status, "open"),
          ),
        )
        .returning({ id: workingOrders.id });

      if (updated.length === 0) {
        throw new AppError("working_order.not_open", { workingOrderId: id });
      }
    },
    { nodeId: cfg.nodeId },
  );
}

/**
 * The result of placing an order. In Task 7 (Mode T / generic placing) an order goes `open → placed`
 * and NO fiscal document is filed, so only `id` and `status: "placed"` are returned. The optional
 * fiscal fields are the shape Task 8's mode dispatch fills for the modes that DO file at placing:
 * Mode P (prepay) pays + issues → `settled`, and Mode I (invoice-first) issues the deferred invoice.
 * Kept on this interface now so the placing surface does not change shape when those modes land.
 */
export interface PlaceOrderResult {
  id: string;
  status: "placed" | "settled";
  invoiceNumber?: string;
  issuedAt?: string;
  total?: string;
  qr?: string;
  vatBreakdown?: { rate: string; base: string; tax: string }[];
}

/**
 * Place an open order, append its genesis amendment and fire kitchen items in one
 * transaction. invoice_first also files a deferred invoice from the stored prices.
 * Lock the order before checking status so concurrent placement cannot file twice.
 * The operator and trusted clock identify the amendment; saleTillId identifies the
 * authenticated device's register on the fiscal record.
 */
export async function placeOrder(
  deps: TillSaleDeps,
  cfg: TillConfig,
  id: string,
  operatorId: string,
  saleTillId: TillId,
): Promise<PlaceOrderResult> {
  return withTenant(
    deps.db,
    cfg.tenantId,
    async (tx) => {
      await asAppUser(tx);

      // Lock the order for the life of the tx and read its status off the locked copy. Absent (nothing
      // to lock) or not-open → `working_order.not_open`; the enforce_transition trigger is the DB
      // backstop if this app check is ever wrong.
      const [locked] = await tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, id))
        .for("update");
      if (locked === undefined || locked.status !== "open") {
        throw new AppError("working_order.not_open", { workingOrderId: id });
      }

      // Mode dispatch (design §3). Mode I files the DEFERRED invoice HERE, before the transition, from
      // the order's stored locked lines (never a re-price — the composition was locked at add-time); the
      // read-back invoice number rides on the result. Modes T and P file nothing at placing. The
      // deferred file tags the sale with `working_order_id = id`, so the FOR UPDATE lock above already
      // guarantees one invoice per order (a second place sees `placed` and is refused before reaching
      // this).
      let placeResult: PlaceOrderResult = { id, status: "placed" };
      if (cfg.orderFlow === "invoice_first") {
        const priced = await priceStoredOrder(tx, id);
        // SP-A.2 §16.4 split: the fiscal record's `till_id` is the DEVICE till (`saleTillId`), while the
        // `order_placed` amendment below records the box's CONFIGURED register (`cfg.tillId`). `nodeId`/
        // `seriesId` stay `cfg` — the chain is keyed by the node's SIF, not the device.
        const { saleId, fiscal } = await recordSale(tx, deps.backend, {
          tenantId: cfg.tenantId,
          tillId: saleTillId,
          nodeId: cfg.nodeId,
          seriesId: cfg.seriesId,
          workingOrderId: brandWorkingOrderId(id),
          locale: cfg.locale,
          invoiceLocales: cfg.invoiceLocales,
          total: priced.total,
          lines: priced.lines,
          vatBreakdown: priced.vatBreakdown,
          clock: deps.clock,
          operatorId,
          // A chained invoice with NO tender and NO settlement — the legitimate unsettled steady state
          // an invoice-first sale sits in until `collectOrder` settles it (design §3, Ordering 1).
          settlement: { kind: "deferred" },
        });
        // The human-facing "A/1" is read back from the sale row + its series (the FiscalRecordRef is
        // regime-opaque), in this same transaction — the shared `readInvoiceNumber` reader.
        placeResult = {
          id,
          status: "placed",
          invoiceNumber: await readInvoiceNumber(tx, saleId),
          issuedAt: fiscal.issuedAt.toISOString(),
          total: priced.total,
          qr: fiscal.verificationUrl ?? "",
          vatBreakdown: toVatBreakdown(priced.vatBreakdown),
        };
      }

      // open → placed. `working_orders_enforce_transition` validates OLD.status = 'open'; no `settled_at`
      // (the biconditional requires it stay NULL for a non-settled status).
      await tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, id));

      // Open the amendment log with its `order_placed` genesis. `appendOrderAmendment` owns the
      // parent-row-lock serialisation, the per-order sequence and the tamper-evident hash (Task 3); the
      // genesis carries NO contest reason (a placement has none). The venue's trusted-clock instant +
      // wall offset are hashed and stored so the entry reprints in venue time (#52).
      // `capturedByTillId` is the box's CONFIGURED register (`cfg.tillId`), NOT the device till the
      // fiscal record above carries (SP-A.2 §16.4) — this matches `cancelPlacedOrder`, so a re-homed
      // box's `order_placed`/`order_cancelled` pair for one order stays on the same register.
      const now = deps.clock.now();
      await appendOrderAmendment(tx, {
        tenantId: cfg.tenantId,
        workingOrderId: id,
        kind: "order_placed",
        actorId: operatorId,
        reason: null,
        capturedByTillId: cfg.tillId,
        capturedByNodeId: cfg.nodeId,
        eventAt: now.instant,
        eventOffsetMinutes: now.offsetMinutes,
      });

      // Placing = firing to the kitchen (KDS-1 §3b): one `ticket_items` row per PARENT dish line, each
      // routed to a station (product ?? category ?? default) SNAPSHOTTED at fire time, replacing #63's
      // single `order_prep` row per order. Read ALL the order's lines (id + product + parent link, in
      // line order) and hand them to `fireLines`, which fires the parents and skips child modifier lines
      // (a modifier is part of its dish, not its own ticket item). Ticket items advance queued →
      // preparing → ready freely even after the order is fiscally frozen, so they live in their own
      // MUTABLE table, as `order_prep` did.
      const firedLines = await tx
        .select({
          id: workingOrderLines.id,
          productId: workingOrderLines.productId,
          courseId: workingOrderLines.courseId,
          parentLineId: workingOrderLines.parentLineId,
          note: workingOrderLines.note,
          doneness: workingOrderLines.doneness,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id))
        .orderBy(workingOrderLines.lineNo);
      await fireLines(tx, cfg, id, firedLines);

      return placeResult;
    },
    { nodeId: cfg.nodeId },
  );
}

/**
 * Cancel a placed order and append its reasoned amendment in one transaction.
 * Require a non-empty reason before database work, then lock and check the order.
 * The operator and trusted clock identify the cancellation amendment.
 */
export async function cancelPlacedOrder(
  deps: TillSaleDeps,
  cfg: TillConfig,
  id: string,
  reason: string,
  operatorId: string,
): Promise<void> {
  // Refused before any database work: a cancel with no reason is not a loggable amendment (its reason
  // is the accountable content), so an empty/whitespace reason neither transitions the order nor
  // appends a reasonless entry. Its own code — this fires BEFORE the status is read, so a missing
  // reason is a request-shape error, not the state conflict `not_placed` names (§1).
  if (reason.trim() === "") {
    throw new AppError("working_order.reason_required", { workingOrderId: id });
  }

  return withTenant(
    deps.db,
    cfg.tenantId,
    async (tx) => {
      await asAppUser(tx);

      const [locked] = await tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, id))
        .for("update");
      if (locked === undefined || locked.status !== "placed") {
        throw new AppError("working_order.not_placed", { workingOrderId: id });
      }

      // Terminal transition `placed → abandoned` (enforce_transition permits it; no `settled_at`, which
      // the biconditional requires stay NULL for a non-settled status).
      await tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));

      // Append the `order_cancelled` amendment — the cancel is itself a logged amendment (design §4),
      // carrying the operator's reason, linked to the genesis via `appendOrderAmendment`'s per-order hash.
      const now = deps.clock.now();
      await appendOrderAmendment(tx, {
        tenantId: cfg.tenantId,
        workingOrderId: id,
        kind: "order_cancelled",
        actorId: operatorId,
        reason,
        capturedByTillId: cfg.tillId,
        capturedByNodeId: cfg.nodeId,
        eventAt: now.instant,
        eventOffsetMinutes: now.offsetMinutes,
      });
    },
    { nodeId: cfg.nodeId },
  );
}

/**
 * Fire a settled prepay order through fireLines. Reject other statuses before any
 * kitchen write; the unique item-per-line constraint rejects a repeated fire.
 */
export async function sendToPrep(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
): Promise<void> {
  return withTenant(deps.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);

    // Only settled orders are eligible for firing. Settled is a terminal status.
    const [order] = await tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    if (order === undefined || order.status !== "settled") {
      throw new AppError("working_order.not_settled", { workingOrderId: id });
    }

    // Fire the settled order's lines to the kitchen: read them ALL (id + product + parent link, in line
    // order) and hand them to `fireLines`, which inserts one ticket item per PARENT dish line (station
    // resolved + snapshotted) and skips child modifier lines — the same fire `placeOrder` runs at placing.
    const firedLines = await tx
      .select({
        id: workingOrderLines.id,
        productId: workingOrderLines.productId,
        courseId: workingOrderLines.courseId,
        parentLineId: workingOrderLines.parentLineId,
        note: workingOrderLines.note,
        doneness: workingOrderLines.doneness,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    await fireLines(tx, cfg, id, firedLines);
  });
}

/**
 * Stamp a settled, fired order as collected so it leaves the kitchen queue.
 * Refuse an already-collected or never-fired order. The conditional update stamps
 * only an unset collected_at, leaving a concurrent second stamp as a no-op.
 */
export async function markCollected(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
): Promise<void> {
  return withTenant(deps.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);

    // Only settled orders are eligible for collection. Settled is a terminal status.
    const [order] = await tx
      .select({ status: workingOrders.status, collectedAt: workingOrders.collectedAt })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    if (order === undefined || order.status !== "settled") {
      throw new AppError("working_order.not_settled", { workingOrderId: id });
    }
    // Already handed over — refuse the repeat HERE, before the NULL → non-null-only trigger (0056) would
    // RAISE a P0001 that becomes an opaque 500.
    if (order.collectedAt !== null) {
      throw new AppError("working_order.already_collected", { workingOrderId: id });
    }
    // Must have been fired — an order with no ticket items is on no station display to hand over.
    const [fired] = await tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, id))
      .limit(1);
    if (fired === undefined) {
      throw new AppError("ticket.not_fired", { workingOrderId: id });
    }

    // Stamp the handover marker. enforce_transition (0056) permits this settled → settled UPDATE ONLY
    // because it sets collected_at NULL → non-null and touches nothing else. The `collected_at IS NULL`
    // predicate keeps a concurrent double-collect a no-op for the loser rather than a trigger RAISE.
    await tx
      .update(workingOrders)
      .set({ collectedAt: sql`now()` })
      .where(and(eq(workingOrders.id, id), isNull(workingOrders.collectedAt)));
  });
}

/** The kitchen state a ticket item advances through (KDS-1 §2d) — `queued → preparing → ready`, from
 *  the `ticket_state` enum (the successor to `order_prep`'s dropped `prep_state`). */
export type TicketState = (typeof ticketState.enumValues)[number];

/** The working order's own status (`open → placed → settled|abandoned`, orders.ts) — surfaced on a
 *  station-queue group so the till knows which orders are COLLECTABLE (a settled Mode-P order awaiting
 *  its counter handover, {@link markCollected}) versus still open (a tab building) or placed (awaiting
 *  the fiscal {@link collectOrder}). */
export type WorkingOrderStatus = (typeof workingOrderStatus.enumValues)[number];

/** The forward kitchen transitions (KDS-1 §2d), keyed by the state a move goes TO: the one legal
 *  predecessor it comes `from` and the timestamp column it stamps. The per-line {@link advanceTicketItem}
 *  and whole-ticket {@link advanceTicket} verbs both drive their predecessor-WHERE and stamp off this ONE
 *  table, so the state machine lives in a single place. `queued` is not a target (a FIRE reaches it,
 *  {@link fireLines}), so only the two forward moves are keyed. */
const TICKET_TRANSITIONS = {
  preparing: { from: "queued", stampedAt: "preparingAt" },
  ready: { from: "preparing", stampedAt: "readyAt" },
} as const satisfies Record<
  Exclude<TicketState, "queued">,
  { from: TicketState; stampedAt: "preparingAt" | "readyAt" }
>;

/** The typed `.set()` payload for a forward move: the new state plus the stamp column the transition
 *  names, set to `now()`. A ternary on the (two-valued) stamp column keeps each branch a concrete object
 *  Drizzle infers against `ticket_items`' update shape — a computed key would widen it to a string index
 *  and drop the typing the per-verb switch/ternary existed to hold. */
function advanceSet(to: Exclude<TicketState, "queued">) {
  return TICKET_TRANSITIONS[to].stampedAt === "preparingAt"
    ? { state: to, preparingAt: sql`now()` }
    : { state: to, readyAt: sql`now()` };
}

/**
 * Advance one fired ticket item from queued to preparing or preparing to ready.
 * The conditional update enforces the predecessor and held-item gate together.
 * On a miss, distinguish a held item from an invalid transition. Reject an unknown
 * target before looking up its transition.
 */
export async function advanceTicketItem(
  tx: Transaction,
  _cfg: TillConfig,
  itemId: string,
  to: TicketState,
): Promise<void> {
  // `to as Exclude<TicketState, "queued">` only satisfies the index type — it asserts nothing at
  // runtime, so "queued" (not a key of TICKET_TRANSITIONS) and any missing/garbage `to` both read back
  // `undefined` here and are refused together, before `advanceSet`/`.from` ever run.
  const table = TICKET_TRANSITIONS as Record<
    string,
    (typeof TICKET_TRANSITIONS)[Exclude<TicketState, "queued">] | undefined
  >;
  const transition = table[to];
  if (transition === undefined) {
    throw new AppError("ticket.invalid_transition", { ticketItemId: itemId });
  }
  const validTo = to as Exclude<TicketState, "queued">;

  // A held item cannot advance. Read back an unsuccessful update to distinguish
  // ticket.item_held from ticket.invalid_transition.
  const updated = await tx
    .update(ticketItems)
    .set(advanceSet(validTo))
    .where(
      and(
        eq(ticketItems.id, itemId),
        eq(ticketItems.state, transition.from),
        isNotNull(ticketItems.firedAt),
      ),
    )
    .returning({ id: ticketItems.id });
  if (updated.length === 0) {
    const [item] = await tx
      .select({ firedAt: ticketItems.firedAt })
      .from(ticketItems)
      .where(eq(ticketItems.id, itemId));
    if (item !== undefined && item.firedAt === null) {
      throw new AppError("ticket.item_held", { ticketItemId: itemId });
    }
    throw new AppError("ticket.invalid_transition", { ticketItemId: itemId });
  }
}

/**
 * Advance fired items of one order and station from the legal predecessor state.
 * Held items and items already past that predecessor are skipped; an empty match
 * is a no-op.
 */
export async function advanceTicket(
  tx: Transaction,
  _cfg: TillConfig,
  orderId: string,
  stationId: string,
  to: Exclude<TicketState, "queued">,
): Promise<void> {
  await tx
    .update(ticketItems)
    .set(advanceSet(to))
    .where(
      and(
        eq(ticketItems.workingOrderId, orderId),
        eq(ticketItems.stationId, stationId),
        eq(ticketItems.state, TICKET_TRANSITIONS[to].from),
        isNotNull(ticketItems.firedAt),
      ),
    );
}

/** One ticket item on a station's queue — its id (the bump target for {@link advanceTicketItem}), the
 *  line it was fired from, its current kitchen state, and the DISPLAY fields a cook reads: the line's
 *  snapshotted `descriptions` (locale → text, the dish name — so the kitchen shows "2× Paella", not a
 *  bare line number) and its `quantity` (numeric(12,3) as text, e.g. "2.000"). Both are carried from
 *  the joined `working_order_lines` row; the description is the SNAPSHOT frozen at fire, never a live
 *  catalogue lookup. */
/** The course a queue item was fired for (KDS-2) — its snapshotted `course_id` joined to the LIVE
 *  `kitchen_courses` row, so the display renders the course header and orders the coursing sequence by
 *  `displayOrder` without a second fetch. The name/order are the current config (a display convenience,
 *  not a fiscal snapshot); the item's `course_id` snapshot is the anchor. `null` on the item when the
 *  line carried no course. Not filtered by `active`, so a course deactivated after the item was fired
 *  still names its header. */
export interface StationQueueCourse {
  id: string;
  name: string;
  displayOrder: number;
}

/** One selected option (ordering modifier) on a queue item — the child modifier line's SNAPSHOTTED
 *  `descriptions` map (locale → text), so the KDS UI localises it client-side exactly as it does the
 *  dish name (never a pre-flattened string, the repo's never-store-formatted rule). A modifier is never
 *  its own ticket item; it rides here as sub-text beneath its parent dish. */
export interface QueueModifier {
  descriptions: Record<string, string>;
}

export interface StationQueueItem {
  id: string;
  workingOrderLineId: string;
  state: TicketState;
  descriptions: Record<string, string>;
  quantity: string;
  /** The dish's selected options (ordering modifiers), in selection (`line_no`) order — the KDS UI
   *  renders them as indented sub-text under this item. Empty for a plain dish. */
  modifiers: QueueModifier[];
  /** The AS-SERVED allergen profile (modifier↔allergen, Task 8) — the parent product's published
   *  allergens folded with its selected options' overlays (Cautious: a `remove` strips a code, an `add`
   *  merges one). `pending` is true when the dish's own allergens are unreviewed (a null base), so the
   *  KDS shows the plate as unverified. Display-only — never a fiscal value. Defaults to
   *  `{ allergens: {}, pending: true }` when the parent line is absent from the read (belt-and-braces).
   *  The fold's `removed` rides as the sibling {@link removed} field, not nested here. */
  asServed: { allergens: ProductAllergens; pending: boolean };
  /** The AS-SERVED diet profile (Task 5) — the diet twin of {@link asServed}: the parent product's
   *  recipe-derived origins folded with its selected options' origin overlays (a `remove` strips an
   *  origin, an `add` merges one), then the staff override re-applied. `vegan`/`vegetarian` read
   *  "unknown" while the derivation is pending. Display-only; defaults to a derived-empty
   *  `{ vegan: "unknown", vegetarian: "unknown", contains: [] }` when the parent line is absent from
   *  the read (belt-and-braces, parity with {@link asServed}'s `{ allergens: {}, pending: true }`). */
  asServedDiet?: DietProfile;
  /** The base allergen codes the selected options SUBTRACTED (present in the product but not in
   *  {@link asServed}) — the "swap made this safe" chip. Empty for a pending base (a remove cannot
   *  subtract from an unknown base) or when nothing was removed. */
  removed: string[];
  /** The item's course (KDS-2 §3d/§5a), or `null` for a line with no course — the client groups the
   *  queue by this and renders a per-course header in `displayOrder`. */
  course: StationQueueCourse | null;
  /** `null` while the item's course is HELD — the client renders it GREYED and non-advanceable
   *  (`advanceTicketItem` refuses it, `ticket.item_held`); a timestamp once fired (auto-fired earliest
   *  course, or released via `fireCourse`). */
  firedAt: string | null;
  /** The per-line kitchen customisation (order-line customisation, spec §2/§3, NON-FISCAL), read from the
   *  SNAPSHOTTED `ticket_items.note`/`doneness` (frozen at fire) rather than the live line, so a later
   *  draft edit never changes what the kitchen already sees. `note` is a free-text instruction, `doneness`
   *  the meat-doneness enum; both `null` when the line carried neither. The KDS renders the doneness
   *  prominently and the note as sub-text beside the modifiers. */
  note: string | null;
  doneness: Doneness | null;
  /** `ticket_items.queued_at` — the moment this line reached its station (KDS order-timing alerts, design
   *  §3), so the client's `TickingClock` can re-derive {@link band} between refreshes from this plus the
   *  group's {@link StationQueueGroup.thresholds}. */
  queuedAt: string;
  /** The line's age band against its station's thresholds, computed on the DB clock at fetch time (§3, §6)
   *  — authoritative for the first render; the client re-ticks it locally afterward. */
  band: TimingBand;
}

/** One order's lines at a station, grouped for the per-station display (KDS-1 §3c) — the order's id and
 *  operator label, the `queued_at` of its OLDEST line at this station (the group's oldest-first ordering
 *  key + elapsed-time anchor), and the lines themselves. */
export interface StationQueueGroup {
  orderId: string;
  orderNumber: number;
  label: string | null;
  queuedAt: string;
  /** The order's own status (KDS-1 collect fix). Every order on the queue is non-abandoned and
   *  not-yet-collected (the query filters both), so the till reads COLLECTABLE off this alone: a
   *  `settled` order is a Mode-P pickup awaiting the counter handover ({@link markCollected}); `open`
   *  (a tab) and `placed` (awaiting the fiscal collect) are not collectable via this path. */
  status: WorkingOrderStatus;
  items: StationQueueItem[];
  /** This station's order-timing thresholds (KDS order-timing alerts, design §3/§6/§11) — every group
   *  from one `listStationQueue` call shares the same station, hence the same thresholds, but they ride
   *  per-group (not as a separate fetch) so the client's `TickingClock` can re-derive each item's
   *  {@link StationQueueItem.band} locally without a second round trip. */
  thresholds: StationThresholds;
}

/**
 * The per-station kitchen queue (KDS-1 §3c) — the venue's ticket items AT `stationId` (venue-wide,
 * till-reroute §3.6 — not node-scoped, so a promoted node keeps serving the tabs it inherited), joined to their
 * working order for the display fields and GROUPED BY ORDER (each group = one order's lines at this
 * station), oldest order first. The per-line/per-station successor to #63's order-level `listPrepQueue`,
 * over `ticket_items` rather than `order_prep`.
 *
 * Two order-level exclusions, mirroring `listPrepQueue`'s abandoned filter and adding the collect
 * handover: an `abandoned` working order (`ne(status, "abandoned")` — a cancelled placed order's items
 * are cascaded only if the LINE is deleted, so the status join is what retires a still-present item's
 * order, as `listPrepQueue` relied on) and a COLLECTED order (`collected_at IS NULL` — the default-station
 * display drops an order once handed to the customer, §3e) both drop out. Ticket items are NOT filtered
 * by state: a `ready` line stays on the display until its order collects, so the group carries the
 * order's queued/preparing/ready lines alike (the Nuevo/Preparando/Listo columns are a client lens).
 *
 * Ordered by `ticket_items.queued_at` ascending, so within the grouping the oldest line seen for an
 * order fixes that group's position (oldest-first) and its `queuedAt`. Venue-wide (till-reroute §3.6 —
 * not node-scoped): the station's queue is the whole venue's, so a promoted node keeps serving the
 * dead node's fired items. Runs on the CALLER's transaction under its tenant/app_user scope. PGlite
 * proves the join, the exclusions, the grouping and the ordering; the venue-wide, cross-node read is
 * real-Postgres's job (working-order.pg.test.ts), the CLAUDE.md §4 split.
 */
/**
 * Read modifier descriptions and allergen overlays for the supplied parent lines,
 * then their base product allergens. Both reads have explicit tenant predicates.
 * An empty parent list skips the reads; a missing base leaves allergens pending.
 */
async function readQueueSubItems(
  tx: Transaction,
  tenantId: string,
  parentLineIds: string[],
): Promise<{
  modifiersByParent: Map<string, QueueModifier[]>;
  asServedByParent: Map<
    string,
    {
      asServed: { allergens: ProductAllergens; pending: boolean };
      removed: string[];
      asServedDiet: DietProfile;
    }
  >;
}> {
  const modifiersByParent = new Map<string, QueueModifier[]>();
  const asServedByParent = new Map<
    string,
    {
      asServed: { allergens: ProductAllergens; pending: boolean };
      removed: string[];
      asServedDiet: DietProfile;
    }
  >();
  if (parentLineIds.length === 0) return { modifiersByParent, asServedByParent };

  // ONE child read: the modifier descriptions AND the allergen overlay, both from the child modifier
  // lines (LEFT join on the nullable `option_group_item_id`), in `line_no` (selection) order. Builds the
  // modifiers map and the per-parent overlay list in a single pass — the overlay rides the same join
  // rather than needing a second child read.
  const childRows = await tx
    .select({
      parentLineId: workingOrderLines.parentLineId,
      descriptions: workingOrderLines.descriptions,
      addAllergens: optionGroupItems.addAllergens,
      removeAllergens: optionGroupItems.removeAllergens,
      addOrigins: optionGroupItems.addOrigins,
      removeOrigins: optionGroupItems.removeOrigins,
    })
    .from(workingOrderLines)
    .leftJoin(
      optionGroupItems,
      and(
        eq(optionGroupItems.tenantId, tenantId),
        eq(optionGroupItems.id, workingOrderLines.optionGroupItemId),
      ),
    )
    .where(
      and(
        eq(workingOrderLines.tenantId, tenantId),
        inArray(workingOrderLines.parentLineId, parentLineIds),
      ),
    )
    .orderBy(workingOrderLines.lineNo);
  const overlaysByParent = new Map<
    string,
    { add: AllergenMap | null; remove: string[] | null }[]
  >();
  // The DIET twin of `overlaysByParent` (Task 5) — each parent's options' ORIGIN overlays, built from
  // the SAME child rows/join, so the diet fold rides the one child read the allergen fold already does.
  const originOverlaysByParent = new Map<string, OptionOriginOverlay[]>();
  for (const child of childRows) {
    // `parentLineId` is non-null on every row (the `inArray` matched it).
    const mods = modifiersByParent.get(child.parentLineId!) ?? [];
    mods.push({ descriptions: child.descriptions });
    modifiersByParent.set(child.parentLineId!, mods);
    const overlays = overlaysByParent.get(child.parentLineId!) ?? [];
    overlays.push({ add: child.addAllergens ?? null, remove: child.removeAllergens ?? null });
    overlaysByParent.set(child.parentLineId!, overlays);
    const originOverlays = originOverlaysByParent.get(child.parentLineId!) ?? [];
    // `add_origins`/`remove_origins` are stored `string[]`; narrow to the origin union at the query
    // boundary, as the allergen fold casts `AllergenMap`.
    originOverlays.push({
      add: (child.addOrigins ?? null) as DietaryOrigin[] | null,
      remove: (child.removeOrigins ?? null) as DietaryOrigin[] | null,
    });
    originOverlaysByParent.set(child.parentLineId!, originOverlays);
  }

  // Base allergens per parent line — the PARENT line's product (LEFT join: a null/pending base is
  // allowed and yields `pending: true`). Fold each parent's base with its options' overlays.
  const parents = await tx
    .select({
      lineId: workingOrderLines.id,
      allergens: products.allergens,
      dietDerivation: products.dietDerivation,
      dietOverride: products.dietOverride,
    })
    .from(workingOrderLines)
    .leftJoin(
      products,
      and(eq(products.tenantId, tenantId), eq(products.id, workingOrderLines.productId)),
    )
    .where(
      and(eq(workingOrderLines.tenantId, tenantId), inArray(workingOrderLines.id, parentLineIds)),
    );
  for (const p of parents) {
    const base = (p.allergens ?? null) as ProductAllergens | null;
    const asServed = deriveAsServedAllergens(base, overlaysByParent.get(p.lineId) ?? []);
    // The DIET twin (Task 5) — fold the product's recipe-derived origins with its options' origin
    // overlays, then re-apply the staff override. A null derivation folds as "no recipe" (empty
    // origins but PENDING), the same default `republishProductDiet` uses when publishing the product's
    // own diet, so the as-served vegan/vegetarian read "unknown" for an unreviewed dish (the CAUTIOUS
    // posture — never assert a positive diet claim on a plate whose ingredients were never reviewed).
    const asServedDiet = deriveAsServedDiet(
      (p.dietDerivation ?? { origins: [], pending: true }) as DietDerivation,
      (p.dietOverride ?? null) as DietOverride | null,
      originOverlaysByParent.get(p.lineId) ?? [],
    );
    // Project only `{ allergens, pending }` onto the wire — `removed` rides as a sibling top-level field
    // (the client reads that one), so the nested copy would be dead weight.
    asServedByParent.set(p.lineId, {
      asServed: { allergens: asServed.allergens, pending: asServed.pending },
      removed: asServed.removed,
      asServedDiet,
    });
  }
  return { modifiersByParent, asServedByParent };
}

export async function listStationQueue(
  tx: Transaction,
  cfg: TillConfig,
  stationId: string,
): Promise<StationQueueGroup[]> {
  const rows = await tx
    .select({
      itemId: ticketItems.id,
      workingOrderLineId: ticketItems.workingOrderLineId,
      state: ticketItems.state,
      queuedAt: ticketItems.queuedAt,
      // The DISPLAY fields the kitchen renders — the line's snapshotted dish description + quantity,
      // carried from the joined working_order_lines row (the snapshot, never a live catalogue lookup).
      descriptions: workingOrderLines.descriptions,
      quantity: workingOrderLines.quantity,
      lineNo: workingOrderLines.lineNo,
      // KDS-2: the item's snapshotted course (or null) + its held/fired marker. `course_id` is the
      // item's own snapshot; the name/order ride from the LEFT-joined live `kitchen_courses` row (a
      // display convenience — see StationQueueCourse). `fired_at` null = HELD (greyed, non-advanceable).
      courseId: ticketItems.courseId,
      courseName: kitchenCourses.name,
      courseDisplayOrder: kitchenCourses.displayOrder,
      firedAt: ticketItems.firedAt,
      // The per-line kitchen customisation (order-line customisation, spec §2/§3) — read from the
      // SNAPSHOTTED `ticket_items` columns (frozen at fire), NOT the live `working_order_lines`, so a
      // later draft edit never moves what the kitchen already sees.
      note: ticketItems.note,
      doneness: ticketItems.doneness,
      orderId: workingOrders.id,
      orderNumber: workingOrders.orderNumber,
      label: workingOrders.label,
      // The order's status — surfaced so the till shows the collect action only on a collectable
      // (settled Mode-P) order (see StationQueueGroup.status). Non-abandoned + uncollected is already
      // guaranteed by the WHERE, so this is the only remaining collectability signal.
      status: workingOrders.status,
      // KDS order-timing alerts (design §3/§6): this line's age on the DB clock, in whole minutes since
      // `queued_at` — the same `now()`-based idiom `listExpoQueue`'s `openedMinutes` uses, so the band
      // classification below is immune to any app-server/DB clock skew (reconstructed as an offset from
      // `Date.now()`, never by parsing `queued_at` with the app clock).
      ageMinutes: sql<number>`floor(extract(epoch from (now() - ${ticketItems.queuedAt})) / 60)::int`,
      warmAfterMinutes: kitchenStations.warmAfterMinutes,
      overdueAfterMinutes: kitchenStations.overdueAfterMinutes,
      forgottenAfterMinutes: kitchenStations.forgottenAfterMinutes,
    })
    .from(ticketItems)
    // Composite join predicate (tenant_id too) — the tenant-consistency `listPrepQueue`'s own join
    // enforced, matching the composite shape the ticket_items → working_order_lines FK carries.
    .innerJoin(
      workingOrders,
      and(
        eq(ticketItems.workingOrderId, workingOrders.id),
        eq(ticketItems.tenantId, workingOrders.tenantId),
      ),
    )
    // The line this item was fired from, for its display name + quantity. Composite (tenant_id too),
    // mirroring the tenant-consistent (tenant_id, working_order_line_id) FK ticket_items carries.
    .innerJoin(
      workingOrderLines,
      and(
        eq(ticketItems.workingOrderLineId, workingOrderLines.id),
        eq(ticketItems.tenantId, workingOrderLines.tenantId),
      ),
    )
    // The item's OWN station, for its order-timing thresholds (KDS order-timing alerts, design §3/§6).
    // A plain INNER JOIN — never a correlated subquery (CLAUDE.md §3's caution) — keyed on the
    // tenant-consistent (tenant_id, station_id) FK `ticket_items.station_id` carries; every row here is
    // already filtered to `stationId` below, so this always resolves.
    .innerJoin(
      kitchenStations,
      and(
        eq(ticketItems.stationId, kitchenStations.id),
        eq(ticketItems.tenantId, kitchenStations.tenantId),
      ),
    )
    // The item's course, for the display header + coursing order (KDS-2 §5a). LEFT join — `course_id`
    // is nullable (a courseless line), and it is NOT filtered by `active`, so a course deactivated after
    // the item was fired still names its header. Composite (tenant_id too), mirroring the
    // tenant-consistent (tenant_id, course_id) → kitchen_courses FK ticket_items carries.
    .leftJoin(
      kitchenCourses,
      and(
        eq(ticketItems.courseId, kitchenCourses.id),
        eq(ticketItems.tenantId, kitchenCourses.tenantId),
      ),
    )
    .where(
      and(
        eq(ticketItems.tenantId, cfg.tenantId),
        eq(ticketItems.stationId, stationId),
        ne(workingOrders.status, "abandoned"),
        isNull(workingOrders.collectedAt),
      ),
    )
    // Primary `queued_at` keeps the oldest-order-first grouping (each group's position + `queuedAt`
    // anchor is its oldest line, unchanged), with `line_no` breaking the tie so an order's lines —
    // fired together with an identical `queued_at` — render in a stable line order within the group.
    .orderBy(ticketItems.queuedAt, workingOrderLines.lineNo);

  // The selected options AND the as-served allergen profile (Task 8) of every queued dish, keyed by the
  // parent line ids just returned — attached below as each item's `modifiers` sub-text and
  // `asServed`/`removed`. One child read + one base read, no N+1.
  const { modifiersByParent, asServedByParent } = await readQueueSubItems(
    tx,
    cfg.tenantId,
    rows.map((row) => row.workingOrderLineId),
  );

  // Group by order, preserving first-seen (= oldest queued_at) order — the Map keeps insertion order,
  // so the returned groups are oldest-order-first and each group's `queuedAt` is its oldest line's.
  const groups = new Map<string, StationQueueGroup>();
  for (const row of rows) {
    // This station's thresholds — identical on every row (the query is filtered to one `stationId`),
    // reconstructed once per row rather than hoisted so the shape stays a plain per-row projection.
    const thresholds: StationThresholds = {
      warmAfterMinutes: row.warmAfterMinutes,
      overdueAfterMinutes: row.overdueAfterMinutes,
      forgottenAfterMinutes: row.forgottenAfterMinutes,
    };
    let group = groups.get(row.orderId);
    if (group === undefined) {
      group = {
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        label: row.label,
        queuedAt: row.queuedAt,
        status: row.status,
        items: [],
        thresholds,
      };
      groups.set(row.orderId, group);
    }
    group.items.push({
      id: row.itemId,
      workingOrderLineId: row.workingOrderLineId,
      state: row.state,
      descriptions: row.descriptions,
      quantity: row.quantity,
      modifiers: modifiersByParent.get(row.workingOrderLineId) ?? [],
      // The as-served allergen profile (Task 8) — a safe default `{ allergens: {}, pending: true }`
      // when the parent line is somehow absent from the read (belt-and-braces; every queued line is
      // present in practice).
      asServed: asServedByParent.get(row.workingOrderLineId)?.asServed ?? {
        allergens: {},
        pending: true,
      },
      // The as-served diet profile (Task 5). An UNREVIEWED dish already reads "unknown" from the fold
      // (a null derivation folds as empty-but-PENDING, the cautious posture), so this "unknown" default
      // is only the belt-and-braces case where the parent line is absent from the read entirely — and
      // it agrees with the fold, parity with `asServed`'s `{ allergens: {}, pending: true }` default.
      asServedDiet: asServedByParent.get(row.workingOrderLineId)?.asServedDiet ?? {
        vegan: "unknown",
        vegetarian: "unknown",
        contains: [],
      },
      removed: asServedByParent.get(row.workingOrderLineId)?.removed ?? [],
      // A non-null `course_id` always matches a `kitchen_courses` row (the FK guarantees it), so when
      // `courseId` is present its name/order are too; a null course serialises `course: null`.
      course:
        row.courseId === null
          ? null
          : { id: row.courseId, name: row.courseName!, displayOrder: row.courseDisplayOrder! },
      firedAt: row.firedAt,
      // The snapshotted per-line customisation (order-line customisation, spec §2/§3).
      note: row.note,
      doneness: row.doneness,
      queuedAt: row.queuedAt,
      // Reconstruct a `queuedAtMs` offset from `Date.now()` using the DB-computed age, rather than
      // `Date.parse(row.queuedAt)` directly — the DB's `now()` and this process's clock can skew, and
      // this keeps the classification anchored to the DB clock exactly as `ageMinutes` was computed.
      band: classifyBand(Date.now() - Number(row.ageMinutes) * 60_000, Date.now(), thresholds),
    });
  }
  return [...groups.values()];
}

/** One item on the cross-station expo/pass board (KDS-3 §3a) — a fired-or-held ticket item of an order,
 *  carrying the display fields the pass renders: the line's SNAPSHOTTED description map + quantity (the
 *  same snapshot `StationQueueItem` serialises, never a live catalogue lookup), the resolved STATION name
 *  (the cross-station join `listStationQueue` deliberately omits — the pass sees the grill lagging the
 *  cold station), the kitchen `state`, and the `fired`/`away` lifecycle stamps. `name` is the
 *  locale→description map (localised client-side, per the repo's never-store-formatted rule), mirroring
 *  `StationQueueItem.descriptions` rather than a pre-flattened string. */
export interface ExpoItem {
  id: string;
  name: Record<string, string>;
  qty: string;
  stationName: string;
  state: TicketState;
  firedAt: string | null;
  awayAt: string | null;
  /** The per-line kitchen customisation (order-line customisation, spec §2/§3, NON-FISCAL), read from the
   *  SNAPSHOTTED `ticket_items.note`/`doneness` (frozen at fire) — the same snapshot
   *  {@link StationQueueItem.note}/`doneness` carries, never the live line. Both `null` when the line
   *  carried neither. The pass renders the doneness prominently and the note as sub-text. */
  note: string | null;
  doneness: Doneness | null;
  /** The dish's selected options (ordering modifiers), in selection (`line_no`) order — the pass renders
   *  them as sub-text under this item. Each is the child modifier line's snapshotted `descriptions` map
   *  (localised client-side, as `name` is). Empty for a plain dish. */
  modifiers: QueueModifier[];
  /** The AS-SERVED allergen profile (modifier↔allergen, Task 8) — the same fold `StationQueueItem`
   *  carries: the parent product's published allergens minus the options' removes plus their adds,
   *  `pending` when the dish's base is unreviewed. Display-only; defaults to `{ allergens: {}, pending:
   *  true }` when the parent line is absent from the read. The fold's `removed` rides as the sibling
   *  {@link removed} field, not nested here. */
  asServed: { allergens: ProductAllergens; pending: boolean };
  /** The AS-SERVED diet profile (Task 5) — the same fold {@link StationQueueItem.asServedDiet} carries:
   *  the parent product's recipe-derived origins minus the options' removes plus their adds, the staff
   *  override re-applied, "unknown" while the derivation is pending. Display-only; defaults to a
   *  derived-empty `{ vegan: "unknown", vegetarian: "unknown", contains: [] }` when the parent line is
   *  absent from the read. */
  asServedDiet?: DietProfile;
  /** The base allergen codes the selected options SUBTRACTED — see {@link StationQueueItem.removed}. */
  removed: string[];
  /** `ticket_items.queued_at` (KDS order-timing alerts, design §3/§6/§11) — the expo spans stations, so
   *  UNLIKE `StationQueueGroup.thresholds` this rides PER ITEM (Controller Ruling A): the client's
   *  `TickingClock` re-derives {@link band} from this plus {@link thresholds} between refreshes. */
  queuedAt: string;
  /** This item's OWN station's order-timing thresholds — per item, not per order, because one order's
   *  items can span several stations each with different thresholds. */
  thresholds: StationThresholds;
  /** This item's age band against its own station's thresholds, computed on the DB clock at fetch time.
   *  Authoritative for the first render; the client re-ticks it locally afterward. */
  band: TimingBand;
}

/** One course section of an expo order (KDS-3 §3a) — the order's items for one course, grouped under the
 *  course header and ordered by `displayOrder` (a null-course line has no course row: `courseId`/
 *  `courseName`/`displayOrder` are null and it sorts EARLIEST, the same null-first coursing
 *  `listStationQueue`'s client renders). Two roll-up flags drive the pass's per-course lever: `fired` is
 *  true once EVERY item of the course carries `fired_at` (so the "Curso listo" bump is offered — a held
 *  course reads `false`), `away` true once every item carries `away_at` (the drop-off signal the screen
 *  uses to retire the course). */
export interface ExpoCourse {
  courseId: string | null;
  courseName: string | null;
  displayOrder: number | null;
  fired: boolean;
  away: boolean;
  items: ExpoItem[];
}

/** One open order on the cross-station expo board (KDS-3 §3a) — its id, the human order number and
 *  optional dining-table label, how long it has been open (`openedMinutes`, from `opened_at`), and its
 *  `ticket_items` grouped BY COURSE in `display_order`. `tableLabel` is present only when the order maps
 *  to a table (a tab back-pointer or a counter delivery); it is omitted for a bare walk-up (the `?`). */
export interface ExpoOrder {
  orderId: string;
  tableLabel?: string;
  orderNumber: number;
  openedMinutes: number;
  courses: ExpoCourse[];
  /** The worst age band across the order's UNSERVED lines (design §3 — a served line, `working_order_
   *  lines.served_at` set, has reached the guest and drops off the clock; the reduction skips it). The
   *  card head's escalation signal, `worstBand` over every {@link ExpoItem.band} whose line is unserved;
   *  `"fresh"` when none are, or when every remaining unserved item is itself fresh. */
  worstBand: TimingBand;
}

/**
 * The cross-station expo/pass read (KDS-3 §3a) — every OPEN order in the venue with at least one
 * not-yet-away item, its `ticket_items` gathered ACROSS all stations and grouped by course, so the
 * expediter sees a whole order's coursing at once. The counterpart to KDS-1's per-station
 * `listStationQueue`, which filters to ONE station and never needs the station's name; this joins
 * `kitchen_stations` to label each item with its station, so the pass reads "the grill is lagging the
 * cold station" off one query.
 *
 * Three order-level exclusions, computed at query time (there is no per-order "done" column):
 *  - `abandoned` orders (`ne(status,"abandoned")`) and COLLECTED orders (`collected_at IS NULL`), the
 *    same two `listStationQueue` drops;
 *  - FULLY-AWAY orders — an order leaves the pass once the expediter has dispatched every course (every
 *    item carries `away_at`). Expressed as an EXISTS of one still-not-away item in the venue (§2a: `away`
 *    is the KDS-3 dispatch marker; the waiter's `served_at` is a separate floor ack, not consulted here),
 *    so the order stays while ANY item is undispatched and drops the instant the last one goes away. Done
 *    in SQL rather than post-grouping so a venue's fully-dispatched orders are never hauled into memory.
 *  A SURVIVING order still carries ALL its items — including away ones — so a per-course `away` flag can
 *  be rolled up; the SCREEN (a later task) hides fully-away courses, the READ does not.
 *
 * Venue-wide (till-reroute §3.6 — not node-scoped, so a promoted node keeps expediting the dead node's
 * live orders), exactly as `listStationQueue`'s queue now is. `locationId` (default `cfg.locationId`)
 * scopes only the dining-table label lookup, keeping the `(tx, cfg, locationId?)` signature symmetric
 * with `listTablesWithState`; a node sits in one location, so the default is the till's own venue.
 *
 * Ordered by `opened_at` (oldest order first — the most urgent to dispatch), then course `display_order`
 * NULLS FIRST (the null course fires earliest), then `line_no`/item id for a stable within-course order.
 * Runs on the CALLER's transaction under its tenant/`app_user` scope. PGlite proves the join, the
 * exclusions, the course grouping and the fired/away roll-ups — plain SQL a single backend proves; the
 * venue-wide, cross-node read is real-Postgres's job (working-order.pg.test.ts), the same split
 * `listStationQueue` uses (CLAUDE.md §4).
 */
export async function listExpoQueue(
  tx: Transaction,
  cfg: TillConfig,
  locationId?: string,
): Promise<ExpoOrder[]> {
  const loc = locationId ?? cfg.locationId;
  const rows = await tx
    .select({
      itemId: ticketItems.id,
      // The fired PARENT line — the key its child modifier lines point at (`parent_line_id`), for the
      // modifier sub-item read below.
      lineId: ticketItems.workingOrderLineId,
      state: ticketItems.state,
      firedAt: ticketItems.firedAt,
      awayAt: ticketItems.awayAt,
      // The per-line kitchen customisation (order-line customisation, spec §2/§3) — the SNAPSHOTTED
      // `ticket_items` columns (frozen at fire), the same snapshot `listStationQueue` reads, so a later
      // draft edit never moves what the pass sees.
      note: ticketItems.note,
      doneness: ticketItems.doneness,
      // The DISPLAY snapshot the pass renders — the line's frozen description map + quantity, carried
      // from working_order_lines (never a live catalogue lookup), exactly as `listStationQueue` serialises.
      descriptions: workingOrderLines.descriptions,
      quantity: workingOrderLines.quantity,
      lineNo: workingOrderLines.lineNo,
      // The line's own delivery marker (design §3 — a line ages until it reaches the guest). NOT
      // exposed on `ExpoItem` itself; consulted only to exclude a served line from `ExpoOrder.worstBand`.
      servedAt: workingOrderLines.servedAt,
      // The item's STATION name — the cross-station label listStationQueue omits (it filters by one
      // station, so it never needs it). `station_id` is notNull, so this inner join drops nothing.
      stationName: kitchenStations.name,
      // KDS order-timing alerts (design §3/§6/§11, Controller Ruling A): this item's own queued-at plus
      // its OWN station's thresholds — an order's items can span several stations, so unlike
      // `listStationQueue` (one station per call) these ride per item, not per order.
      queuedAt: ticketItems.queuedAt,
      ageMinutes: sql<number>`floor(extract(epoch from (now() - ${ticketItems.queuedAt})) / 60)::int`,
      warmAfterMinutes: kitchenStations.warmAfterMinutes,
      overdueAfterMinutes: kitchenStations.overdueAfterMinutes,
      forgottenAfterMinutes: kitchenStations.forgottenAfterMinutes,
      // The item's snapshotted course (or null) + its live header/order from the LEFT-joined
      // kitchen_courses row — a courseless line serialises `course* : null` and sorts earliest.
      courseId: ticketItems.courseId,
      courseName: kitchenCourses.name,
      courseDisplayOrder: kitchenCourses.displayOrder,
      orderId: workingOrders.id,
      orderNumber: workingOrders.orderNumber,
      // Minutes since the order opened — the pass's urgency clock. `::int` so pg/PGlite hand back a
      // number; `now()` is transaction time, so an order opened earlier in this same tx reads 0.
      openedMinutes: sql<number>`floor(extract(epoch from (now() - ${workingOrders.openedAt})) / 60)::int`,
      // The dining-table label, resolved by a FAN-OUT-PROOF scalar subquery (a LEFT JOIN could multiply
      // an order's item rows if two tables pointed at it — tab_id carries no DB unique, only an app lock).
      // Covers both directions a table binds an order: a TAB (`dining_tables.tab_id` back-points at the
      // order) or a counter DELIVERY (`working_orders.delivery_table_id` points at the table). Scoped to
      // `loc` (the expo's location, the `locationId?` param defaulting to the till's own venue) — the one
      // place this read consumes the location, keeping the (tx, cfg, locationId?) signature symmetric with
      // listTablesWithState while the READ itself is venue-wide (§3.6). The `order by` — a seated-tab match
      // (`dt.tab_id = ` the order) first, then the unique `dt.id` as a total tiebreak — makes the single
      // label deterministic (a bare `limit 1` is NOT: two rows can match — the order's own tab table AND
      // a table it delivers to — and PostgreSQL could then return either label across calls).
      tableLabel: sql<string | null>`(
        select dt.label from dining_tables dt
        where dt.tenant_id = ${workingOrders.tenantId}
          and dt.location_id = ${loc}
          and (dt.tab_id = ${workingOrders.id} or ${workingOrders.deliveryTableId} = dt.id)
        order by (dt.tab_id = ${workingOrders.id}) desc nulls last, dt.id
        limit 1)`,
    })
    .from(ticketItems)
    // The owning order, for the display fields + the open/collected/abandoned exclusions. Composite
    // (tenant_id too), the tenant-consistent shape ticket_items' FKs carry, mirroring listStationQueue.
    .innerJoin(
      workingOrders,
      and(
        eq(ticketItems.workingOrderId, workingOrders.id),
        eq(ticketItems.tenantId, workingOrders.tenantId),
      ),
    )
    // The line this item was fired from, for its display name + quantity. Composite (tenant_id too).
    .innerJoin(
      workingOrderLines,
      and(
        eq(ticketItems.workingOrderLineId, workingOrderLines.id),
        eq(ticketItems.tenantId, workingOrderLines.tenantId),
      ),
    )
    // The item's STATION, for its name — the join that makes this read cross-station. Composite
    // (tenant_id too), mirroring the tenant-consistent (tenant_id, station_id) → kitchen_stations FK.
    .innerJoin(
      kitchenStations,
      and(
        eq(ticketItems.stationId, kitchenStations.id),
        eq(ticketItems.tenantId, kitchenStations.tenantId),
      ),
    )
    // The item's course, for the header + coursing order. LEFT join — `course_id` is nullable, and (as
    // in listStationQueue) it is NOT filtered by `active`, so a course deactivated after the item was
    // fired still names its header. Composite (tenant_id too).
    .leftJoin(
      kitchenCourses,
      and(
        eq(ticketItems.courseId, kitchenCourses.id),
        eq(ticketItems.tenantId, kitchenCourses.tenantId),
      ),
    )
    .where(
      and(
        eq(ticketItems.tenantId, cfg.tenantId),
        ne(workingOrders.status, "abandoned"),
        isNull(workingOrders.collectedAt),
        // Fully-away exclusion, order-level, computed at query time (there is no per-order "done"
        // column): keep the order while ANY of its items is still not-away, drop it once every item
        // carries `away_at` (§2a — `away` is KDS-3's dispatch marker; `served_at` is a separate floor
        // ack, not consulted). Venue-wide like the outer read (till-reroute §3.6), so items from any
        // node count. A surviving order still returns ALL its items (away ones included) so a per-course
        // `away` roll-up can be formed; the screen hides fully-away courses.
        sql`exists (
          select 1 from ${ticketItems} tix
          where tix.tenant_id = ${workingOrders.tenantId}
            and tix.working_order_id = ${workingOrders.id}
            and tix.away_at is null)`,
      ),
    )
    // Oldest order first (opened_at), then course display_order NULLS FIRST (the null course fires
    // earliest), then line_no and item id for a stable within-course order. Grouping preserves this.
    .orderBy(
      workingOrders.openedAt,
      sql`${kitchenCourses.displayOrder} asc nulls first`,
      workingOrderLines.lineNo,
      ticketItems.id,
    );

  // Group rows into orders → courses → items, preserving the SQL order (Maps keep insertion order), so
  // orders come out oldest-first and each order's courses in display_order. A null course_id collapses
  // to one "no course" bucket per order. `fired`/`away` start true and flip false on the first item
  // that lacks the stamp — i.e. true only when EVERY item of the course carries it.
  // The selected options AND the as-served allergen profile (Task 8) of every fired dish line, keyed on
  // the parent line ids — attached below as each expo item's `modifiers` sub-text and `asServed`/
  // `removed`. One child read + one base read, no N+1.
  const { modifiersByParent, asServedByParent } = await readQueueSubItems(
    tx,
    cfg.tenantId,
    rows.map((row) => row.lineId),
  );

  const orders = new Map<string, ExpoOrder>();
  const courseMaps = new Map<string, Map<string, ExpoCourse>>();
  for (const row of rows) {
    let order = orders.get(row.orderId);
    if (order === undefined) {
      order = {
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        openedMinutes: Number(row.openedMinutes),
        courses: [],
        // `tableLabel` is present only when the order maps to a table (the `?` in ExpoOrder).
        ...(row.tableLabel === null ? {} : { tableLabel: row.tableLabel }),
        // Folded in below, per row, over UNSERVED lines only (design §3) — starts `fresh` (worstBand's
        // own empty-set default) and only ever climbs as rows are processed.
        worstBand: "fresh",
      };
      orders.set(row.orderId, order);
      courseMaps.set(row.orderId, new Map());
    }
    const byCourse = courseMaps.get(row.orderId)!;
    const courseKey = row.courseId ?? "__none__";
    let course = byCourse.get(courseKey);
    if (course === undefined) {
      course = {
        courseId: row.courseId,
        // A non-null course_id always matches a kitchen_courses row (the FK guarantees it), so its
        // name/order are present; a null course serialises both as null.
        courseName: row.courseId === null ? null : row.courseName!,
        displayOrder: row.courseId === null ? null : row.courseDisplayOrder!,
        fired: true,
        away: true,
        items: [],
      };
      byCourse.set(courseKey, course);
      order.courses.push(course);
    }
    const thresholds: StationThresholds = {
      warmAfterMinutes: row.warmAfterMinutes,
      overdueAfterMinutes: row.overdueAfterMinutes,
      forgottenAfterMinutes: row.forgottenAfterMinutes,
    };
    // Reconstructed from the DB-computed age (not `Date.parse(row.queuedAt)`) so the classification is
    // immune to app-server/DB clock skew — the same idiom `listStationQueue` uses.
    const band = classifyBand(Date.now() - Number(row.ageMinutes) * 60_000, Date.now(), thresholds);
    course.items.push({
      id: row.itemId,
      name: row.descriptions,
      qty: row.quantity,
      stationName: row.stationName,
      state: row.state,
      firedAt: row.firedAt,
      awayAt: row.awayAt,
      // The snapshotted per-line customisation (order-line customisation, spec §2/§3).
      note: row.note,
      doneness: row.doneness,
      modifiers: modifiersByParent.get(row.lineId) ?? [],
      // Task 8 — the same as-served profile the station read attaches, safe-defaulted identically.
      asServed: asServedByParent.get(row.lineId)?.asServed ?? {
        allergens: {},
        pending: true,
      },
      // Task 5 — the same as-served diet profile the station read attaches (an unreviewed dish reads
      // "unknown" from the fold's pending default), safe-defaulted identically for the absent-parent case.
      asServedDiet: asServedByParent.get(row.lineId)?.asServedDiet ?? {
        vegan: "unknown",
        vegetarian: "unknown",
        contains: [],
      },
      removed: asServedByParent.get(row.lineId)?.removed ?? [],
      queuedAt: row.queuedAt,
      thresholds,
      band,
    });
    if (row.firedAt === null) course.fired = false;
    if (row.awayAt === null) course.away = false;
    // The order's worst band is a reduction over UNSERVED lines only (design §3 — a served line has
    // reached the guest and drops off the clock). `workingOrderLines.servedAt` is written only while the
    // parent order is `open` (ruling R4), so a settled/placed order's lines always fold in here.
    if (row.servedAt === null) order.worstBand = worstBand([order.worstBand, band]);
  }
  return [...orders.values()];
}

/** One row of the occupancy read-model (design §4). The raw signals (`hasOpenTab`, `pendingDeliveries`)
 *  are exposed alongside the rolled-up `state` so the floor plan can render a richer badge. */
export interface TableState {
  id: string;
  label: string;
  /** The `floor_zones` row this table sits in (FP-1), or null — the successor to the former free-text
   *  `zone` string (a composite FK to `floor_zones`, not an arbitrary label). */
  zoneId: string | null;
  capacity: number | null;
  state: "free" | "open-tab" | "delivery-pending";
  hasOpenTab: boolean;
  tabId?: string;
  tabLineCount?: number;
  /** The open tab's gross draft total (sum of `line_total`), numeric(12,2) as text — present iff a tab. */
  tabTotal?: string;
  pendingDeliveries: number;
  /** Count of the open tab's lines STILL to serve (`working_order_lines` with `served_at IS NULL`), for
   *  the floor screen's "N still to serve" badge (FP-1). `0` for a free table (no open tab) — the
   *  LEFT-join branch. DISTINCT from `pendingDeliveries` (uncollected counter deliveries to this table);
   *  both are kept. */
  pendingToServe: number;
  /** Count of the open tab's lines that are KITCHEN-DONE but NOT yet carried out — the ticket item is
   *  `ready` AND the line's `served_at IS NULL` (KDS-1 §3d, the floor's "N listos"). DISTINCT from
   *  `pendingToServe` (unserved lines regardless of kitchen state) and from `pendingDeliveries` (counter
   *  deliveries): a line is counted here only in the window between the kitchen bumping it `ready` and the
   *  waiter marking it served. `0` for a free table (no open tab — the LEFT-join branch). */
  readyToServe: number;
  /** Count of the open tab's lines the pass has DISPATCHED to the floor but the waiter has not yet
   *  acknowledged — the ticket item carries `away_at IS NOT NULL` (KDS-3's dispatch marker, set by
   *  `markCourseAway`) AND the line's `served_at IS NULL` (KDS-3 §3c, the floor's "en camino"). DISTINCT
   *  from `readyToServe` (kitchen-done, may not yet be dispatched) and `pendingToServe` (unserved lines
   *  regardless of kitchen/pass state): counted only in the window between the expediter sending a course
   *  away and the waiter marking it served, the same 1:1 ti-on-line join so no multiplication. The floor
   *  renders the MOST-ADVANCED hint per table — en camino (`enRoute`) over listos (`readyToServe`) over
   *  por servir (`pendingToServe`). `0` for a free table (no open tab — the LEFT-join branch). */
  enRoute: number;
  /** The worst age band across the OPEN TAB's unserved lines (KDS order-timing alerts, design §3/§6) —
   *  `"fresh"` for a free table (no open tab) or one whose unserved lines are all still fresh. A served
   *  line (`served_at` set) has reached the guest and never contributes: this is the floor's flash-red
   *  signal, driving a table tile from steady amber/red through to a flashing-red "forgotten" tile. Scoped
   *  to the open TAB only, the same scope `pendingToServe`/`readyToServe`/`enRoute` already use — a
   *  counter delivery to this table (`pendingDeliveries`) is not a per-line detail this read carries, so
   *  it does not feed this band (see the read-model's own doc comment). */
  timingBand: TimingBand;
  /** The table's MANUAL service status (design §4), or null. Independent of occupancy — a `free` table
   *  may carry one. Joined from `table_service_statuses` on `dining_tables.status_id`. */
  status: { id: string; label: string; color: string } | null;
  /** FP-2 spatial placement on the floor-plan canvas — canvas coordinates, rendered shape, and
   *  rotation in degrees, or `null` for an unplaced table. Written by `setTablePlacement` /
   *  `clearPlacement`. Non-optional `| null` (unconditionally present, `null` when unplaced), matching
   *  the `zoneId`/`capacity`/`status` siblings above rather than the conditionally-spread `tab*`
   *  fields below — so the canvas can read a placement field without a presence check. */
  posX: number | null;
  posY: number | null;
  shape: FloorTableShape | null;
  rotation: number | null;
  /** The table's NEXT imminent `booked` reservation (Bookings-1 §4, reserved-on-floor) — the earliest
   *  reservation for the venue's TODAY at or after the grace floor (the venue's current wall-clock rolled
   *  back by `RESERVATION_GRACE_MINUTES`, so a due/late guest's badge lingers), or `null`. The floor
   *  renders "Reserved HH:MM" from it. `time` is HH:MM (venue-local); "today"/"now" derive from
   *  `locations.time_zone` at read time (§2b), computed in JS from the injected clock — never in SQL.
   *  A non-optional `| null` sibling (like `status`/`posX`), unconditionally present.
   *  Data-minimisation: only `time` is projected — the floor badge renders "Reserved HH:MM" and nothing
   *  else, so the customer's `party_size`/`contact_name` are deliberately kept off every till device. */
  nextReservation: { time: string } | null;
}

/**
 * Read active tables in the location with open-tab and pending-delivery occupancy.
 * An open tab takes precedence over a delivery; otherwise the table is free.
 * Pending deliveries must have kitchen items and remain uncollected and unabandoned.
 */
/** Resolve a stored IANA time zone, substituting the schema default for an unrecognised value.
 *  `locations.time_zone` is free-text with NO CHECK constraint (`.notNull().default("Europe/Madrid")`),
 *  so a typo or a legacy value can be anything. `Intl.DateTimeFormat({ timeZone })` throws `RangeError`
 *  on an unknown zone, which would turn the floor read (GET /api/tables/state) into a 500 — corrupt
 *  venue config must not take out the operational floor (house §5 spirit). A zone `Intl` rejects falls
 *  back to the column's own default rather than throwing. */
function safeTimeZone(timeZone: string): string {
  try {
    // Constructing the formatter is what validates the zone; it throws RangeError for an unknown one.
    new Intl.DateTimeFormat(undefined, { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** Venue-local wall-clock derived from an instant + IANA time zone, for the reserved-on-floor read
 *  (Bookings-1 §2b/§4). Computed in JS via `Intl` — never in SQL — so no offset is stored: a booking is
 *  a wall-clock intention, and "today"/"now" for the imminence check are the venue's local values at
 *  read time. Returns the local calendar date (`YYYY-MM-DD`) and time-of-day (`HH:MM`, 24-hour). */
function venueWallClock(now: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/** How long a `booked` reservation keeps surfacing on the floor AFTER its time (Bookings-1 §4,
 *  reserved-on-floor grace window). The floor cue is most useful exactly when a guest is due or running
 *  late, so the reserved badge lingers for this window past the booking time rather than vanishing on
 *  the minute. A sensible fixed default; a per-venue configurable value is a later slice — not built
 *  here. Only ever SUBTRACTED from the venue's local "now", clamped to the start of today (below), so it
 *  never widens the scan to yesterday. */
const RESERVATION_GRACE_MINUTES = 30;

/** The earliest booking time still surfaced on the floor: the venue-local "now" (`HH:MM`) rolled back by
 *  `RESERVATION_GRACE_MINUTES`, clamped to `"00:00"` so it never crosses to the previous day (the read
 *  only scans today, §4). Pure HH:MM minute-of-day arithmetic — no timezone math, that already happened
 *  in `venueWallClock`. */
function reservationGraceFloor(venueNow: string): string {
  const [h, m] = venueNow.split(":").map(Number);
  const floorMinutes = Math.max(0, h * 60 + m - RESERVATION_GRACE_MINUTES);
  const hh = String(Math.floor(floorMinutes / 60)).padStart(2, "0");
  const mm = String(floorMinutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export async function listTablesWithState(
  tx: Transaction,
  cfg: TillConfig,
  locationId?: string,
  now: Date = new Date(),
): Promise<TableState[]> {
  const loc = locationId ?? cfg.locationId;
  // Compute the reservation date and time using the location's time zone, then
  // bind those wall-clock values into the query. Missing locations use the default.
  const tzRow = await tx.execute<{ time_zone: string }>(
    sql`select time_zone from locations where id = ${loc}`,
  );
  // Use the default for a missing location and safeTimeZone for an invalid stored zone.
  const timeZone = safeTimeZone(tzRow.rows[0]?.time_zone ?? DEFAULT_TIME_ZONE);
  const { date: venueToday, time: venueNow } = venueWallClock(now, timeZone);
  // Reserved-on-floor grace window (§4): surface reservations from `RESERVATION_GRACE_MINUTES` BEFORE
  // the venue's now, so a due/late guest's badge lingers rather than vanishing on the minute. Clamped to
  // "00:00" so the scan never reaches into yesterday (we bound to today's date below).
  const graceFloor = reservationGraceFloor(venueNow);
  const result = await tx.execute<{
    id: string;
    label: string;
    zone_id: string | null;
    capacity: number | null;
    tab_id: string | null;
    tab_line_count: number;
    tab_total: string | null;
    pending_to_serve: number;
    ready_to_serve: number;
    en_route: number;
    // KDS order-timing alerts (design §3/§6): one entry per unserved, fired line on the open tab, each
    // carrying its DB-clock age plus its OWN station's thresholds — the raw material `classifyBand`/
    // `worstBand` reduce in JS below (never classified in SQL, so server and client share one classifier).
    tab_unserved_lines: {
      ageMinutes: number;
      warmAfterMinutes: number;
      overdueAfterMinutes: number;
      forgottenAfterMinutes: number;
    }[];
    pending_deliveries: number;
    status_id: string | null;
    status_label: string | null;
    status_color: string | null;
    pos_x: number | null;
    pos_y: number | null;
    shape: FloorTableShape | null;
    rotation: number | null;
    next_reservation_time: string | null;
  }>(sql`
    select
      dt.id, dt.label, dt.zone_id, dt.capacity,
      dt.pos_x, dt.pos_y, dt.shape, dt.rotation,
      res.booking_time as next_reservation_time,
      tab.id as tab_id,
      coalesce(tab.line_count, 0)::int as tab_line_count,
      tab.tab_total,
      coalesce(tab.pending_to_serve, 0)::int as pending_to_serve,
      coalesce(tab.ready_to_serve, 0)::int as ready_to_serve,
      coalesce(tab.en_route, 0)::int as en_route,
      coalesce(tab.unserved_lines, '[]') as tab_unserved_lines,
      coalesce(del.pending, 0)::int as pending_deliveries,
      tss.id as status_id, tss.label as status_label, tss.color as status_color
    from dining_tables dt
    left join lateral (
      select wo.id,
             count(wol.id)::int as line_count,
             (count(wol.id) filter (where wol.served_at is null))::int as pending_to_serve,
             -- KDS-1 section 3d "N listos": lines the kitchen has bumped ready but the waiter has not
             -- yet carried out (served_at is null). The ticket item is joined 1:1 on the line -- its
             -- (tenant_id, working_order_line_id) UNIQUE gives at most one ti per wol, so this LEFT JOIN
             -- neither multiplies wol rows (line_count / tab_total stay correct) nor double-counts. An
             -- unfired or not-yet-ready line has ti.state null or != 'ready' and is excluded by the filter.
             (count(*) filter (where ti.state = 'ready' and wol.served_at is null))::int as ready_to_serve,
             -- KDS-3 section 3c "en camino": lines the pass has DISPATCHED (ti.away_at is not null, set by
             -- markCourseAway) that the waiter has not yet carried out (served_at is null). Same 1:1
             -- ti-on-line join as ready_to_serve, so no wol multiplication; an away item is still ready
             -- and unserved, so it counts here AND in ready_to_serve until served -- the client applies the
             -- en-camino > listos precedence off the two counts.
             (count(*) filter (where ti.away_at is not null and wol.served_at is null))::int as en_route,
             coalesce(sum(wol.line_total), 0)::numeric(12, 2)::text as tab_total,
             -- KDS order-timing alerts (design §3/§6): the raw age + thresholds of each unserved, FIRED
             -- (ti.id is not null) line, one JSON object per line -- the age is computed here on the DB
             -- clock (never a band label; §3's "authoritative on the DB clock, classified in JS" split),
             -- reduced with classifyBand/worstBand in JS below. An unfired line (no ticket_items row) has
             -- not reached a station yet, so it carries no age and is excluded, same as a served one.
             json_agg(
               json_build_object(
                 'ageMinutes', floor(extract(epoch from (now() - ti.queued_at)) / 60)::int,
                 'warmAfterMinutes', ks.warm_after_minutes,
                 'overdueAfterMinutes', ks.overdue_after_minutes,
                 'forgottenAfterMinutes', ks.forgotten_after_minutes
               )
             ) filter (where wol.served_at is null and ti.id is not null) as unserved_lines
      from working_orders wo
      left join working_order_lines wol
        on wol.working_order_id = wo.id and wol.tenant_id = wo.tenant_id
      left join ticket_items ti
        on ti.working_order_line_id = wol.id and ti.tenant_id = wol.tenant_id
      -- The unserved line's OWN station thresholds, for the json_agg above. LEFT (not INNER): a row
      -- with no ticket item (ti null) must survive so line_count/tab_total/the other aggregates above
      -- are unaffected by this join — such a row is excluded from unserved_lines by the FILTER instead.
      left join kitchen_stations ks
        on ks.tenant_id = ti.tenant_id and ks.id = ti.station_id
      where wo.tenant_id = dt.tenant_id and wo.id = dt.tab_id and wo.status = 'open'
      group by wo.id
    ) tab on true
    left join lateral (
      select count(*)::int as pending
      from working_orders d
      where d.tenant_id = dt.tenant_id and d.delivery_table_id = dt.id
        and d.status <> 'abandoned' and d.collected_at is null
        and exists (
          select 1 from ticket_items ti
          where ti.tenant_id = d.tenant_id and ti.working_order_id = d.id
        )
    ) del on true
    left join table_service_statuses tss
      on tss.tenant_id = dt.tenant_id and tss.id = dt.status_id
    -- Reserved-on-floor (Bookings-1 section 4): the table's NEXT still-booked reservation for the
    -- venue's TODAY at/after the grace floor -- the venue's wall-clock rolled back by
    -- RESERVATION_GRACE_MINUTES so a due/late guest's badge lingers. venueToday/graceFloor are computed
    -- in JS from locations.time_zone (bound params below), so this sub-select does no timezone arithmetic.
    -- Correlated to the BASE dining_tables dt on qualified outer columns (dt.tenant_id / dt.id) -- the
    -- CLAUDE.md scalar-subquery trap is about BARE interpolated columns binding inward; these are
    -- explicit dt.-qualified references, so they resolve to the outer table.
    left join lateral (
      select b.booking_time
      from bookings b
      where b.tenant_id = dt.tenant_id and b.table_id = dt.id
        and b.status = 'booked'
        and b.booking_date = ${venueToday}
        and b.booking_time >= ${graceFloor}
      order by b.booking_time asc
      limit 1
    ) res on true
    where dt.location_id = ${loc} and dt.active = true
    order by dt.label
  `);

  return result.rows.map((r) => {
    const hasOpenTab = r.tab_id !== null;
    const pendingDeliveries = Number(r.pending_deliveries);
    const state: TableState["state"] = hasOpenTab
      ? "open-tab"
      : pendingDeliveries > 0
        ? "delivery-pending"
        : "free";
    // KDS order-timing alerts (design §3/§6): classify each unserved line in JS (never in SQL, so this
    // read-model and the client's `TickingClock` share one classifier), then worst-wins across the open
    // tab. `worstBand([])` is `"fresh"`, covering a free table or one whose lines are all still fresh.
    const timingBand = worstBand(
      r.tab_unserved_lines.map((line) =>
        classifyBand(Date.now() - Number(line.ageMinutes) * 60_000, Date.now(), {
          warmAfterMinutes: line.warmAfterMinutes,
          overdueAfterMinutes: line.overdueAfterMinutes,
          forgottenAfterMinutes: line.forgottenAfterMinutes,
        }),
      ),
    );
    return {
      id: r.id,
      label: r.label,
      zoneId: r.zone_id,
      capacity: r.capacity,
      state,
      hasOpenTab,
      pendingToServe: Number(r.pending_to_serve),
      readyToServe: Number(r.ready_to_serve),
      enRoute: Number(r.en_route),
      timingBand,
      pendingDeliveries,
      status:
        r.status_id !== null
          ? { id: r.status_id, label: r.status_label!, color: r.status_color! }
          : null,
      // Unconditionally present, null when unplaced (the smallint/enum columns return null directly).
      posX: r.pos_x,
      posY: r.pos_y,
      shape: r.shape,
      rotation: r.rotation,
      // Reserved-on-floor (§4): the imminent booking, or null. The DB `time` arrives as `HH:MM:SS`;
      // normalise to `HH:MM` at the presentation edge (controller ruling) so the floor reads "Reserved
      // HH:MM" straight off it.
      nextReservation:
        r.next_reservation_time !== null ? { time: r.next_reservation_time.slice(0, 5) } : null,
      ...(hasOpenTab
        ? { tabId: r.tab_id!, tabLineCount: Number(r.tab_line_count), tabTotal: r.tab_total! }
        : {}),
    };
  });
}
