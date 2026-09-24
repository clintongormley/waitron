// Keeps errors.ts's registry augmentation reachable from the barrel (scripts/errors-reachable.test.ts).
import "./errors.js";

export { authenticateAgent } from "./agent.js";
export type { PrintAgentConfig } from "./agent.js";
export { createPrinter, deactivatePrinter, listPrinters, updatePrinter } from "./printers.js";
export type {
  CreatePrinterInput,
  PrintConfig,
  PrinterRow,
  PrintTransport,
  UpdatePrinterInput,
} from "./printers.js";
export { enqueuePrintJob, resendPrintJob, canResendPrintJob } from "./outbox.js";
export { FEED_BEFORE_CUT, EscBuilder, esc } from "./escpos.js";
export {
  DEFAULT_CHARACTER_TABLE,
  decodeBytes,
  encodeText,
  prepareText,
  selectCharacterTable,
} from "./charset.js";
export type { CharacterSet } from "./charset.js";
export {
  QR_QUIET_ZONE,
  chooseQrDots,
  columnsFor,
  dpiValue,
  labelAmountLines,
  safeWidthDots,
  withQuietZone,
  wrapText,
} from "./layout.js";
export type { PaperWidth, Resolution } from "./layout.js";
export {
  MAX_DELIVERY_ATTEMPTS,
  PULL_BATCH_LIMIT,
  claimPrintJobs,
  reportPrintJob,
  runAgentOnce,
} from "./runtime.js";
export type { AgentRunResult, AgentRuntimeDeps, ClaimedJob, JobOutcome } from "./runtime.js";
