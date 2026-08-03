// The entire public surface of @waitron/shared. Re-exports only — no logic here.
//
// Excluded from coverage in vitest.config.ts, not merely ignored in-place: a pure
// `export { x } from "y"` barrel like this one is, under @vitest/coverage-v8, sometimes reported
// with zero instrumented functions (trivially 100%) and sometimes with one phantom "get" entry
// per re-exported binding — some of which show as uncovered even though index.test.ts imports
// and exercises every one of them — non-deterministically, run to run, against unchanged code
// and unchanged tests (confirmed by diffing coverage-final.json's branchMap/fnMap across
// repeated identical runs). A `v8 ignore file` comment here was tried first and was itself
// unreliable against this: the buggy runs collapse this file's source positions into one bogus
// whole-file range, and an ignore comment that is matched by AST position doesn't reliably
// exclude a range the remapper has already garbled. Excluding the path in vitest.config.ts acts
// before instrumentation, which is unaffected by how the remap behaves afterward.
export { AppError, hasCode, isAppError } from "./errors.js";
export type { ErrorCode, ErrorParams } from "./errors.js";
export type {
  Branded,
  FiscalRecordId,
  LocationId,
  NodeId,
  SaleId,
  SaleLineId,
  SeriesId,
  TenantId,
  TenderId,
  TillId,
  WorkingOrderId,
  WorkingOrderLineId,
} from "./ids.js";
export {
  fiscalRecordId,
  locationId,
  nodeId,
  saleId,
  saleLineId,
  seriesId,
  tenantId,
  tenderId,
  tillId,
  workingOrderId,
  workingOrderLineId,
} from "./ids.js";
export type { Decimal } from "./money.js";
export {
  addDecimal,
  assertMoney,
  compareDecimal,
  decimal,
  divideDecimal,
  isZeroDecimal,
  MAX_MONEY_INTEGER_DIGITS,
  MONEY_SCALE,
  multiplyDecimal,
  negateDecimal,
  subtractDecimal,
  sumDecimals,
  toScale,
} from "./money.js";
