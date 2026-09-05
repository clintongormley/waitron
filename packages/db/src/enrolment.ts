import { type EnrolledTable, enrol } from "@waitron/sync-enrolment";
import {
  catalogues,
  categories,
  diningTables,
  floorZones,
  kitchenCourses,
  kitchenStations,
  products,
  saleLines,
  saleSettlements,
  saleSubstitutions,
  saleVoids,
  sales,
  tableServiceStatuses,
  tenders,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "./schema/index.js";

/**
 * The sync enrolment for the tables `@waitron/db` (the `core` module) owns — the 17 tenant-scoped,
 * non-fiscal `core`-resident tables that cross the wire. Metadata copied verbatim from the former
 * central `packages/sync/src/registry.ts` ENROLLED (SP-2a inversion, spec §2d); `columns` derived by
 * `enrol`. `@waitron/payments` (payments/payment_refunds/payment_policy) and `@waitron/identity`
 * (persons/webauthn_credentials) declare their own — this array is exactly the core-owned subset.
 *
 * Imports the Drizzle tables from the schema barrel `./schema/index.js`, NOT the package barrel
 * `./index.js`: `index.ts` re-exports this module, so importing it here would be a within-package
 * circular import (the barrel is mid-evaluation → undefined tables at module load).
 */
export const CORE_ENROLMENT: readonly EnrolledTable[] = [
  // Group A — append-only → insert-only apply.
  enrol(sales, {
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 3,
    lane: "ordered",
  }),
  enrol(saleLines, {
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 4,
    lane: "ordered",
  }),
  enrol(tenders, {
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 4,
    lane: "ordered",
  }),
  enrol(saleSettlements, {
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 4,
    lane: "ordered",
  }),
  enrol(saleSubstitutions, {
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 4,
    lane: "ordered",
  }),
  enrol(saleVoids, {
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 4,
    lane: "ordered",
  }),

  // Group B — mutable with a monotonic `updated_at` watermark → watermark upsert.
  enrol(catalogues, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
  }),
  enrol(categories, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    fkRank: 1,
    lane: "ordered",
  }),
  enrol(products, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    fkRank: 2,
    lane: "ordered",
  }),

  // Group C — mutable, NO watermark column, DELETE-capable → single ordered lane.
  enrol(workingOrders, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update", "delete"],
    fkRank: 2,
    lane: "ordered",
  }),
  enrol(workingOrderLines, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update", "delete"],
    fkRank: 3,
    lane: "ordered",
  }),

  // Group D — table-service floor closure (C1): mutable, NO watermark, NO delete.
  enrol(floorZones, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
  }),
  enrol(tableServiceStatuses, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
  }),
  enrol(diningTables, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 1,
    lane: "ordered",
  }),

  // Group F — kitchen KDS closure: mutable, NO watermark, NO delete.
  enrol(kitchenStations, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
  }),
  enrol(kitchenCourses, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
  }),
  enrol(ticketItems, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 4,
    lane: "ordered",
  }),
];
