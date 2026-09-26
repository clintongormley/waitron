export {
  isLocked,
  isVenueHolderFresh,
  lockVenueDatabase,
  openVenueDatabase,
  readVenueHolder,
  readVenueHolderAsync,
  setVenueHolderKind,
  VENUE_HOLDER_KINDS,
} from "./client.js";
export {
  applicationVersion,
  LOG_FILE_NAME,
  resolveLogDir,
  setVenueHolderIdentity,
} from "./venue-holder-identity.js";
export type {
  Database,
  OpenVenueOptions,
  Schema,
  Transaction,
  VenueDatabase,
  VenueHolder,
  VenueHolderKind,
  VenueLock,
} from "./client.js";
export { runMigrations } from "./migrate.js";
export type { MigrationOptions } from "./migrate.js";
export { claimRows } from "./job-claim.js";
export type { ClaimSpec } from "./job-claim.js";
// The column vocabulary. Another package reaches it only through this barrel (CLAUDE.md §3), and
// its names are listed by hand rather than starred. Guards: `schema/columns.test.ts` for what each
// helper emits, `scripts/column-vocabulary.test.ts` for nobody else naming the engine's types.
export {
  bigCount,
  binary,
  count,
  day,
  enumCheck,
  enumText,
  enumType,
  flag,
  id,
  json,
  label,
  labelList,
  money,
  newId,
  now,
  nowIso,
  quantity,
  rate,
  smallCount,
  table,
  timeOfDay,
  ts,
  tsString,
} from "./schema/columns.js";
export * from "./schema/tenants.js";
export { readTenant } from "./read-tenant.js";
export type { Tenant } from "./read-tenant.js";
export { nodes } from "./schema/nodes.js";
export { invoiceSeries } from "./schema/series.js";
export { workingOrderLines, workingOrders, workingOrderStatus } from "./schema/orders.js";
export { orderAmendmentKind, orderAmendments } from "./schema/order-amendments.js";
export { appendOrderAmendment } from "./append-order-amendment.js";
export type { AppendAmendmentInput } from "./append-order-amendment.js";
export { computeAmendmentHash, verifyAmendmentChain } from "./order-amendment-hash.js";
export type {
  AmendmentHashInput,
  AmendmentVerification,
  VerifiableAmendment,
} from "./order-amendment-hash.js";
export { diningTables, floorTableShape } from "./schema/dining-tables.js";
export { floorZones } from "./schema/floor-zones.js";
export { kitchenStations } from "./schema/kitchen-stations.js";
export { kitchenCourses } from "./schema/kitchen-courses.js";
export { ticketItems, ticketState } from "./schema/ticket-items.js";
export { devices } from "./schema/devices.js";
export { joinRequestKind, joinRequests } from "./schema/join-requests.js";
export { printAgents } from "./schema/print-agents.js";
export {
  printCharacterSet,
  printPaperWidth,
  printResolution,
  printTicketScope,
  printTransport,
  printers,
} from "./schema/printers.js";
export { printJobStatus, printJobs } from "./schema/print-jobs.js";
export { stationPrinters } from "./schema/station-printers.js";
export { type AllergenMap, catalogues, categories, products } from "./schema/catalogue.js";
export { locationCatalogues } from "./schema/location-catalogues.js";
export { ingredients, recipeLines } from "./schema/recipes.js";
export {
  purchaseInvoiceVat,
  purchaseInvoices,
  purchaseRegime,
  purchaseVatKind,
} from "./schema/purchase-invoices.js";
export { canvases } from "./schema/canvases.js";
export { deviceProfiles } from "./schema/device-profiles.js";
export { tenantThemes } from "./schema/tenant-themes.js";
export { tenantReceipts } from "./schema/tenant-receipts.js";
export { tableServiceStatuses } from "./schema/table-service-statuses.js";
export { workingOrderCounters } from "./schema/working-order-counters.js";
export {
  fiscalState,
  saleLines,
  sales,
  saleSettlements,
  saleSubstitutions,
  tenderMethod,
  tenders,
} from "./schema/sales.js";
export { saleVoids } from "./schema/sale-voids.js";
export { CORE_ALERTS } from "./alerts.js";
export { CORE_CLASSIFICATION } from "./classification.js";
export { CORE_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";
export { drawerOpens } from "./schema/drawer-opens.js";
export type { DrawerOpenReason } from "./schema/drawer-opens.js";
export { dailyCloseChain, dailyCloses } from "./schema/daily-closes.js";
export type { DailyCloseSnapshot } from "./schema/daily-closes.js";
export { incidents } from "./schema/incidents.js";
export type { IncidentSeverity } from "./schema/incidents.js";
export {
  deploymentTableExists,
  readBreakGlassVerifier,
  readDeploymentAxes,
  readDeploymentEnvironment,
  readDeploymentMode,
  readSingletonRole,
  setBreakGlassVerifierTx,
  setDeploymentMode,
  setDeploymentModeTx,
  setSingletonRole,
  setSingletonRoleTx,
  stampDeployment,
} from "./deployment.js";
export type { DeploymentEnvironment, DeploymentMode, SingletonRole } from "./deployment.js";
export * from "./schema/deployment.js";
export * from "./schema/node-roles.js";
export * from "./schema/node-sealed-state.js";
export { readMirrorConfig, writeMirrorConfig } from "./mirror-config.js";
export type { MirrorConnection } from "./mirror-config.js";
export {
  persistNodeMembershipIfNewer,
  persistNodeMembershipIfNewerTx,
  readNodeMembership,
  readNodeMembershipRow,
  writeNodeMembership,
  writeNodeMembershipTx,
} from "./node-membership.js";
export { readMembershipTrustSet, setNodePublicKey, setNodePublicKeyTx } from "./node-identity.js";
export {
  insertReservedNodeTx,
  insertReservedSeriesTx,
  readNodeEndorsement,
  readStandardSeriesId,
  readStandardSeriesIdTx,
  retireNodeSeriesTx,
  insertNodeSeriesTx,
  type ReservedNodeInput,
  type ReservedSeriesInput,
} from "./reserved-identity.js";
export { allocateInvoiceNumber } from "./allocate-number.js";
export { allocateOrderNumber } from "./allocate-order-number.js";
export { withTransaction } from "./tenancy.js";
export { isRefusal, isUniqueViolation } from "./unique-violation.js";
export {
  checkFailed,
  constraintTarget,
  indexViolated,
  refusalOn,
  sameTarget,
  triggerRaised,
  type ConstraintTarget,
} from "./constraint-target.js";
export {
  COVERAGE_REFUSAL,
  FORM_FACTOR_REFUSAL,
  LOCALES_REFUSAL,
  OPEN_PARENT_REFUSAL,
  POST_SETTLEMENT_REFUSAL,
  TRANSITION_REFUSAL,
  VARIANT_LOCALES_REFUSAL,
  VARIANT_ONE_LEVEL_REFUSAL,
  VARIANT_PARENT_FIXED_REFUSAL,
} from "./trigger-refusals.js";
export {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  NOT_NULL_VIOLATION,
  RESTRICT_VIOLATION,
  TRIGGER_ABORT,
  UNIQUE_VIOLATION,
} from "./sql-state.js";
export { CORE_MIGRATIONS } from "./migrations.js";

/**
 * Testing infrastructure exported for reuse by a module package's OWN test suite. Nothing that
 * drags a test-only dependency in with it belongs here — it would become a transitive dependency of
 * the production surface for every consumer of this package.
 */
export { captureError, driverErrorCode, engineErrorMessage } from "./testing/errors.js";
export { refusalError, type Refusal, type RefusalError } from "./testing/refusals.js";

// english-only.ts is deliberately NOT re-exported here. It computes `PACKAGES_ROOT` from
// `import.meta.dirname` at MODULE LOAD TIME, and `drizzle-kit generate` loads this barrel
// transitively through its own CJS-transformed loader, where `import.meta.dirname` is `undefined`
// and the top-level `join` throws.
export { installChangeFeed } from "./change-feed.js";
export { CORE_CHANGE_SOURCES } from "./classification.js";
// The in-process change feed. Only the subscribe half is public: draining the log and handing the
// rows over are `withTransaction`'s own two steps, and a caller doing either itself would take the
// changes away from the listeners or announce a change that has not committed.
export { subscribeToChanges } from "./change-log.js";
