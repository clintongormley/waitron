// The public barrel of @waitron/printing. Task 3 adds the print-agent enrolment + auth core; Task 4
// the enqueue outbox + createPrinter; Task 5 the agent runtime (runAgentOnce), the transport layer
// (Transport + network_tcp/usb adapters, the routing transport, and the fake sink), and the ESC/POS
// builder. Task 6 (the HTTP API) and the dashboard add the remaining exports here.

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
export { EscBuilder, esc } from "./escpos.js";
export { FakeSink, NetworkTcpTransport, RoutingTransport, UsbTransport } from "./transport.js";
export type { PrinterTarget, Transport, TransportAdapters } from "./transport.js";
export { MAX_DELIVERY_ATTEMPTS, runAgentOnce } from "./runtime.js";
export type { AgentRunResult, AgentRuntimeDeps } from "./runtime.js";
