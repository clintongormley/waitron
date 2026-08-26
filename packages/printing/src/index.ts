// The public barrel of @waitron/printing. Task 3 adds the print-agent enrolment + auth core; later
// tasks (T4 enqueue, T5 runtime, T3d ESC/POS builder) add the remaining exports here.

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from
// this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts (and
// guarded tree-wide by scripts/errors-reachable.test.ts). agent.ts also imports it, so the edge holds
// through this re-export too.
import "./errors.js";

export { PAIRING_TTL_MS, authenticateAgent, enrolAgent, generateAgentCode } from "./agent.js";
export type { PrintAgentConfig } from "./agent.js";
export { createPrinter } from "./printers.js";
export type { CreatePrinterInput, PrintConfig, PrintTransport } from "./printers.js";
export { enqueuePrintJob } from "./outbox.js";
