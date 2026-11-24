import "./errors.js";
import {
  workingOrders,
  workingOrderLines,
  orderTableLabels,
  billSetMenuCopies,
  products,
} from "@waitron/db";
import { productDeclarationValues, extraDeclarationValues } from "@waitron/menu";
import type { ServiceMode, KitchenNoteSnapshot } from "@waitron/module";
import {
  type KitchenSignal,
  type Dining,
  type BillSetMenuState,
  type ServedSetMenuCopy,
  type OptionSnapshot,
  type ProductAllergens,
  type DietaryLabel,
  rawCentsToDecimal,
  AppError,
  thousandthsToDecimal,
  centsToDecimal,
} from "@waitron/shared";
import { sql, eq, and, isNull, type SQL, exists, or, ne } from "drizzle-orm";
import { type OrderEditAuthority, readBillEditState } from "./bill-editing.js";
import { outstandingOf } from "./bill-payment-money.js";
import { readPaymentsByBill } from "./bill-payments.js";
import { readFormerNumbers } from "./former-numbers.js";
import { readProductDeclarations } from "./line-nutrition.js";
import { VENUE_SERVICE } from "./modules.js";
import { type DiningChoice, readOrderDinings } from "./order-dining.js";
import { readOrderKitchenNotes } from "./order-kitchen-note.js";
import { perDishExtraPicks } from "./order-line-quantities.js";
import { type OrderPreviewItem, readOrderPreviewItems } from "./order-preview.js";
import { type OrderStateCounts, readOrderStateCounts } from "./order-state-counts.js";
import {
  type PartyBill,
  type BillInvoiceDelivery,
  storedBillRecipient,
  billInvoiceDelivery,
} from "./parties.js";
import { readBillsSetMenus } from "./set-menu-bill.js";
import { soldProduct } from "./stored-order-lines.js";
import { readBillSignals } from "./table-signals.js";
import type { WorkingOrderDeps } from "./working-order-context.js";
import { optional } from "./working-order-station-queue.js";

/** One row of the held-orders list the counter shows to retrieve a parked order. */
export interface HeldOrderSummary {
  items: OrderPreviewItem[];
  id: string;
  orderNumber: number;
  /**
   * The operator-supplied label; on an open bill moved to the counter, the party's display
   * name the server set; null when neither gave one.
   */
  label: string | null;
  tableLabel?: string;
  counts: OrderStateCounts;
  /** The GROSS total the operator saw; the filed `sale_lines.line_total` is net. */
  total: string;
  /** `total` less the money the bill has received. */
  outstanding: string;
  /** A payment is pending or received on the bill, one given back in full included. */
  hasPayments: boolean;
  /** The bill's own dishes ready at a station, and its long wait; the counter's list draws only the long wait. */
  signals: KitchenSignal[];
  /** {@link readFormerNumbers}; absent when there are none. */
  formerNumbers?: number[];
  /** Null for a counter order; a party's bill is listed here too. */
  partyId: string | null;
  /** The number the bill holds at its table; null for a counter order, or a fault in Waitron. */
  billNumber: number | null;
  /** The name staff gave the bill at its table; null for a counter order or an unnamed bill. */
  billName: string | null;
  openedAt: string;
  /** The service zone the order is recorded in; null for one with none. */
  zoneId: string | null;
}
/** A retrieved order with the stored commercial snapshot needed to rebuild its basket. */
export interface HeldOrder {
  id: string;
  serviceMode: ServiceMode | null;
  /** The service zone the order is recorded in; null for one with none. */
  zoneId: string | null;
  expectedEdit: OrderEditAuthority["expectedEdit"];
  kitchenNote: KitchenNoteSnapshot;
  orderNumber: number;
  label: string | null;
  /** What an edit of this copy sends back, so a save from a copy since changed is refused. */
  revision: number;
  /** The receipt language staff chose for the order; absent while the venue's own applies. */
  receiptLanguage?: string;
  /** The invoice the order is set to issue: `F1` once a full invoice has been chosen for it. */
  invoiceType: "F1" | "F2";
  /** The customer a full invoice names; absent on a simplified invoice or one without a customer. */
  recipient?: NonNullable<PartyBill["recipient"]>;
  /** How the invoice is to be delivered; absent while no delivery has been chosen. */
  invoiceDelivery?: BillInvoiceDelivery;
  /** The order's own way of selling, whatever its department now says. */
  dining: Dining;
  diningChoice: DiningChoice;
  setMenus?: BillSetMenuState;
  setMenuCopies?: ServedSetMenuCopy[];
  /**
   * PARENT rows only, each dish's child lines nested as `extras`.
   */
  lines: {
    /** The dish's recorded answers with their list ids and frozen names. */
    optionSnapshots?: OptionSnapshot[];
    workingOrderLineId?: string;
    menuItemId?: string;
    menuVersionId?: string;
    setMenuId?: string;
    /** The dish: on a line sold as a variant, the variant's parent. */
    productId: string | null;
    /** The variant the line was sold as, absent when it names none. */
    variantId?: string;
    quantity: string;
    makeAt: string | null;
    /** One entry per CHILD line: the frozen values, and the list the pick was taken from. */
    extras?: {
      productId: string | null;
      name: string;
      descriptions: Record<string, string>;
      kitchenName: string | null;
      price: string;
      quantity: number;
      listId: string | null;
      addAllergens: ProductAllergens | null;
      suitableFor: DietaryLabel[];
    }[];
    note?: string;
    product?: {
      id: string;
      productId: string;
      menuItemId: string;
      variantId?: string;
      /** The staff name frozen at add time. */
      name: string;
      /** The line's frozen customer-facing text, locale -> text. */
      customerName: Record<string, string>;
      /** Kept apart from the product's names, so the retrieving surface picks the one it shows. */
      variantName?: string;
      variantCustomerName?: Record<string, string> | null;
      variantKitchenName?: string | null;
      unit: {
        id: string;
        name: Readonly<Record<string, string>>;
        precision: number;
        hardwareUnit: "kg" | "g" | "mg" | null;
      };
      unitPrice: string;
      vatClass: "general" | "reduced" | "super_reduced" | "zero";
      category: string | null;
      allergens: Readonly<ProductAllergens> | null;
      courseId: string | null;
      menuId: string;
      menuName: string;
      dietaryDeclarations: DietaryLabel[];
      diet: unknown;
      dietOverride: unknown;
    };
  }[];
}
/** List the venue's open bills, a party's bill and lineless ones included. */
export async function listHeldOrders(deps: WorkingOrderDeps): Promise<HeldOrderSummary[]> {
  return deps.db.withWriteLock(async () => {
    const tx = deps.db;
    const rows = await tx
      .select({
        id: workingOrders.id,
        orderNumber: workingOrders.orderNumber,
        label: workingOrders.label,
        partyId: workingOrders.partyId,
        deliveryTableId: workingOrders.deliveryTableId,
        deliveryTableLabel: workingOrders.deliveryTableLabel,
        // Cast to text for `rawCentsToDecimal`; see its doc comment.
        total: sql<string>`cast(coalesce(sum(${workingOrderLines.lineTotal}), 0) as text)`,
        openedAt: workingOrders.openedAt,
      })
      .from(workingOrders)
      .leftJoin(workingOrderLines, eq(workingOrderLines.workingOrderId, workingOrders.id))
      // Venue-wide: `node_id` records the writer and is never filtered on here.
      .where(eq(workingOrders.status, "open"))
      .groupBy(
        workingOrders.id,
        workingOrders.orderNumber,
        workingOrders.label,
        workingOrders.partyId,
        workingOrders.openedAt,
      )
      .orderBy(workingOrders.orderNumber);
    const tableLabels = await orderTableLabels(
      tx,
      rows.map((row) => ({ ...row, label: null })),
    );
    const ids = rows.map((row) => row.id);
    const { received, holding } = await readPaymentsByBill(tx, ids);
    const signals = await readBillSignals(tx, ids, Date.now());
    const former = await readFormerNumbers(tx, ids);
    const items = await readOrderPreviewItems(tx, ids);
    const counts = await readOrderStateCounts(tx, ids);
    const zones = await VENUE_SERVICE.findOrderZones(tx, ids);
    const identities = await VENUE_SERVICE.readBillIdentities(
      tx,
      rows.flatMap((row) => (row.partyId === null ? [] : [row.id])),
    );
    return rows.map((row) => {
      const total = rawCentsToDecimal(row.total);
      const identity = identities.get(row.id);
      return {
        id: row.id,
        orderNumber: row.orderNumber,
        label: row.label,
        partyId: row.partyId,
        billNumber: identity?.number ?? null,
        billName: identity?.name ?? null,
        counts: counts.get(row.id)!,
        openedAt: row.openedAt,
        zoneId: zones.get(row.id) ?? null,
        ...optional("tableLabel", tableLabels.get(row.id) ?? undefined),
        items: items.get(row.id)!,
        total,
        outstanding: outstandingOf(total, received.get(row.id)),
        hasPayments: holding.has(row.id),
        signals: signals.get(row.id)!,
        ...optional("formerNumbers", former.get(row.id)),
      };
    });
  });
}
/** Read an open parked order anywhere in the venue, with the snapshots the till rebuilds its basket
 * from even when an offer has since been deactivated. */
export function getHeldOrder(deps: WorkingOrderDeps, id: string): Promise<HeldOrder> {
  return readBasketOrder(deps, id, eq(workingOrders.status, "open"));
}
/** A counter order sent without payment, read as {@link getHeldOrder} reads an open one, so the till
 * can take its payment. */
export function getPlacedCounterOrder(deps: WorkingOrderDeps, id: string): Promise<HeldOrder> {
  return readBasketOrder(
    deps,
    id,
    and(eq(workingOrders.status, "placed"), isNull(workingOrders.partyId))!,
  );
}

async function readBasketOrder(deps: WorkingOrderDeps, id: string, which: SQL): Promise<HeldOrder> {
  return deps.db.withWriteLock(async () => {
    const tx = deps.db;
    const [order] = await tx
      .select({
        id: workingOrders.id,
        serviceMode: workingOrders.serviceMode,
        orderNumber: workingOrders.orderNumber,
        label: workingOrders.label,
        revision: workingOrders.revision,
        receiptLocale: workingOrders.receiptLocale,
        invoiceType: workingOrders.invoiceType,
        invoiceDelivery: workingOrders.invoiceDelivery,
        taxId: workingOrders.recipientTaxId,
        identifierType: workingOrders.recipientIdentifierType,
        identifierCountryCode: workingOrders.recipientIdentifierCountryCode,
        legalName: workingOrders.recipientLegalName,
        address: workingOrders.recipientAddress,
        countryCode: workingOrders.recipientCountryCode,
        partyId: workingOrders.partyId,
        hasSetMenus: exists(
          tx
            .select({ id: billSetMenuCopies.workingOrderId })
            .from(billSetMenuCopies)
            .where(eq(billSetMenuCopies.workingOrderId, id)),
        ).mapWith(Boolean),
      })
      .from(workingOrders)
      .where(and(eq(workingOrders.id, id), which));

    if (order === undefined) {
      throw new AppError("working_order.not_found", { workingOrderId: id });
    }

    const storedLines = await tx
      .select({
        id: workingOrderLines.id,
        sentAt: workingOrderLines.sentAt,
        productId: workingOrderLines.productId,
        quantity: workingOrderLines.quantity,
        priceQuantity: workingOrderLines.priceQuantity,
        descriptions: workingOrderLines.descriptions,
        variantDescriptions: workingOrderLines.variantDescriptions,
        optionSnapshots: workingOrderLines.optionSnapshots,
        unitPriceGross: workingOrderLines.unitPriceGross,
        courseId: workingOrderLines.courseId,
        makeAt: workingOrderLines.makeAtStationId,
        parentLineId: workingOrderLines.parentLineId,
        extraListId: workingOrderLines.extraListId,
        note: workingOrderLines.note,
        productParentId: products.parentId,
        setMenuId: workingOrderLines.setMenuId,
        variantName: workingOrderLines.variantName,
        variantKitchenName: workingOrderLines.variantKitchenName,
        kitchenName: workingOrderLines.kitchenName,
        name: workingOrderLines.name,
      })
      .from(workingOrderLines)
      .leftJoin(products, eq(products.id, workingOrderLines.productId))
      .where(
        and(
          eq(workingOrderLines.workingOrderId, id),
          or(isNull(workingOrderLines.setMenuRole), ne(workingOrderLines.setMenuRole, "set_menu")),
        ),
      )
      .orderBy(workingOrderLines.lineNo);
    const declarations = await readProductDeclarations(
      tx,
      storedLines.flatMap((line) =>
        line.sentAt !== null || line.productId === null ? [] : [line.productId],
      ),
    );
    const captured = await VENUE_SERVICE.readSentLineNutrition(
      tx,
      storedLines.filter((line) => line.sentAt !== null).map((line) => line.id),
    );
    const lineRows = storedLines.map(({ productParentId, ...line }) => {
      const { productId, variantId } = soldProduct({ ...line, productParentId });
      return {
        ...line,
        productId,
        variantId,
        quantity: thousandthsToDecimal(line.quantity),
        priceQuantity: thousandthsToDecimal(line.priceQuantity),
        unitPriceGross: centsToDecimal(line.unitPriceGross),
      };
    });

    const declarationOf = (line: (typeof lineRows)[number]) => {
      if (line.sentAt === null) return declarations.get(line.variantId ?? line.productId!);
      const saved = captured.get(line.id);
      return productDeclarationValues({
        allergens: saved?.allergens ?? null,
        dietaryDeclarations: saved?.dietaryDeclarations ?? [],
        dietOverride: null,
      });
    };

    const contextByLine = new Map(
      (await VENUE_SERVICE.listLineContexts(tx, id)).map((line) => [line.workingOrderLineId, line]),
    );
    const childrenByParent = new Map<string, typeof lineRows>();
    for (const line of lineRows) {
      if (line.parentLineId === null) continue;
      const children = childrenByParent.get(line.parentLineId) ?? [];
      children.push(line);
      childrenByParent.set(line.parentLineId, children);
    }
    const lines = lineRows
      .filter((line) => line.parentLineId === null)
      .map((line) => {
        const context = contextByLine.get(line.id);
        if (context === undefined) {
          throw new AppError("order.service_context_missing", { workingOrderId: id });
        }
        if (line.productId === null) {
          return {
            productId: line.productId,
            quantity: line.quantity,
            makeAt: line.makeAt,
            optionSnapshots: line.optionSnapshots,
            ...(line.optionSnapshots.length ? { workingOrderLineId: line.id } : {}),
          };
        }
        const extras = (childrenByParent.get(line.id) ?? []).map((child) => ({
          productId: child.productId,
          name: child.name,
          descriptions: child.descriptions,
          kitchenName: child.kitchenName,
          price: child.unitPriceGross,
          quantity: perDishExtraPicks(child.quantity, line.quantity, child.priceQuantity),
          listId: child.extraListId,
          ...extraDeclarationValues(declarationOf(child)),
        }));
        return {
          workingOrderLineId: line.id,
          optionSnapshots: line.optionSnapshots,
          menuItemId: context.menuItemId,
          ...(line.setMenuId === null
            ? {}
            : {
                setMenuId: line.setMenuId,
                ...(context.menuVersionId === null ? {} : { menuVersionId: context.menuVersionId }),
              }),
          productId: line.productId,
          quantity: line.quantity,
          makeAt: line.makeAt,
          ...(extras.length === 0 ? {} : { extras }),
          ...(line.note === null ? {} : { note: line.note }),
          ...(line.variantId === null ? {} : { variantId: line.variantId }),
          product: {
            id: line.productId,
            productId: line.productId,
            menuItemId: context.menuItemId,
            name: line.name,
            customerName: line.descriptions,
            ...(line.variantId === null ? {} : { variantId: line.variantId }),
            ...(line.variantName === null ? {} : { variantName: line.variantName }),
            variantCustomerName: line.variantDescriptions,
            variantKitchenName: line.variantKitchenName,
            kitchenName: line.kitchenName,
            unit: {
              id: context.unitId,
              name: context.unitName,
              precision: context.unitPrecision,
              hardwareUnit: context.hardwareUnit,
            },
            unitPrice: line.unitPriceGross,
            vatClass: context.vatClass as "general" | "reduced" | "super_reduced" | "zero",
            category: context.categoryName,
            ...productDeclarationValues(declarationOf(line)),
            courseId: line.courseId,
            menuId: context.menuId,
            menuName: context.menuName,
          },
        };
      });

    const kitchenNote = (await readOrderKitchenNotes(tx, [order.id])).get(order.id)!;
    const edit = order.partyId === null ? null : await readBillEditState(tx, order.id);
    const zoneId = (await VENUE_SERVICE.findOrderZones(tx, [order.id])).get(order.id) ?? null;
    return {
      id: order.id,
      serviceMode: order.serviceMode,
      zoneId,
      expectedEdit:
        edit === null
          ? null
          : {
              billId: edit.billId,
              editorVersion: edit.editorVersion,
              draftId: edit.draftId,
              draftRevision: edit.draftRevision,
            },
      orderNumber: order.orderNumber,
      label: order.label,
      revision: order.revision,
      kitchenNote,
      ...(order.receiptLocale === null ? {} : { receiptLanguage: order.receiptLocale }),
      invoiceType: order.invoiceType,
      ...(order.invoiceType === "F1"
        ? optional("recipient", storedBillRecipient(order) ?? undefined)
        : {}),
      ...(order.invoiceDelivery === null
        ? {}
        : { invoiceDelivery: billInvoiceDelivery(order.invoiceDelivery) }),
      ...(await readOrderDinings(tx, [order.id])).get(order.id)!,
      ...(order.hasSetMenus ? (await readBillsSetMenus(tx, [id])).get(id)! : {}),
      lines,
    };
  });
}
