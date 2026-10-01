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
export type { EscSetting } from "./escpos.js";
export { escPosCommands } from "./escpos-commands.js";
export type { EscPosCommand } from "./escpos-commands.js";
export { prepareText } from "./text.js";
export { TEXT_BAND_HEIGHT, drawTextBand, readRasterText } from "./raster-text.js";
export type { Alignment } from "./raster-text.js";
export {
  DOTS_PER_COLUMN,
  QR_QUIET_ZONE,
  chooseQrDots,
  columnsFor,
  dpiValue,
  gridForWidth,
  labelAmountLines,
  safeWidthDots,
  textGrid,
  withQuietZone,
  wrapText,
} from "./layout.js";
export type { PaperWidth, Resolution, TextGrid } from "./layout.js";
export {
  BLUETOOTH_PRINTING_UNAVAILABLE,
  MAX_DELIVERY_ATTEMPTS,
  PRINTER_UNPAIRED,
  PULL_BATCH_LIMIT,
  claimPrintJobs,
  endUnpairedPrinterJobs,
  failUnprintableBluetoothJobs,
  reportPrintJob,
  runAgentOnce,
} from "./runtime.js";
export type { AgentRunResult, AgentRuntimeDeps, ClaimedJob, JobOutcome } from "./runtime.js";
