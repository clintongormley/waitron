// Side-effect only: keeps this package's `printer.*` codes (errors.ts) reachable from the file that
// throws them — the reachability convention every code-throwing file in the tree follows, guarded
// tree-wide by scripts/errors-reachable.test.ts. See errors.ts.
import "./errors.js";
import { AppError } from "@waitron/shared";
import { printers } from "@waitron/db";
import type { Transaction } from "@waitron/db";

/**
 * The tenant + venue scope every central printing verb (`createPrinter`, `enqueuePrintJob`) runs
 * under. The route resolves it (single-tenant deli deployment, `deps.tenantId` + the location) and
 * passes it down, so these verbs never derive scope from client input — the same discipline
 * `PrintAgentConfig` (agent.ts) states for the agent verbs, and structurally identical to it.
 */
export interface PrintConfig {
  tenantId: string;
  locationId: string;
}

/** How a printer is reached — the `print_transport` pgEnum (packages/db schema/printers.ts). */
export type PrintTransport = "usb" | "network_tcp" | "cloud_poll";

/**
 * The minimal shape `createPrinter` accepts (printing subsystem, §2b). The connection fields are all
 * transport-specific and optional at the type level; which ones a given transport REQUIRES is checked
 * before the write (see `createPrinter`). `port` defaults to 9100 in the DB when omitted. `ticket_scope`
 * (Slice B) and `poll_token_hash` (cloud_poll auth) are deliberately NOT here — this is the minimal
 * create verb Task 4's outbox needs; richer printer config is Task 6/7.
 */
export interface CreatePrinterInput {
  name: string;
  transport: PrintTransport;
  agentId?: string;
  host?: string;
  port?: number;
  usbPath?: string;
  pollId?: string;
}

/**
 * The connection fields each transport's adapter REQUIRES present (printing subsystem §2b) — the
 * app-layer mirror of the `printers_transport_fields_ck` CHECK in 0063_printing_rls.sql: usb needs an
 * agent + a device path; network_tcp needs an agent + a host (port defaults to 9100); cloud_poll needs
 * a poll id (no agent — it self-polls). The DB CHECK + the composite FK remain the INTEGRITY backstop;
 * this pre-check exists only to turn a missing field into a friendly `printer.invalid_config` instead
 * of a raw 23514 constraint violation. It asserts required fields are PRESENT, not that the others are
 * absent — matching the CHECK exactly (a transport none of the three is already unrepresentable: the
 * `transport` column is the `print_transport` enum).
 */
const REQUIRED_FIELDS: Record<PrintTransport, readonly (keyof CreatePrinterInput)[]> = {
  usb: ["agentId", "usbPath"],
  network_tcp: ["agentId", "host"],
  cloud_poll: ["pollId"],
};

/**
 * Create a managed printer (printing subsystem, §2b) — a single INSERT into `printers`. This is the
 * MINIMAL create verb Task 4's outbox test needs (Controller Ruling 1); update/deactivate/list are
 * Task 6 and the config UI is Task 7.
 *
 * The only app-layer validation is a required-field presence pre-check (`REQUIRED_FIELDS`), which
 * throws `printer.invalid_config` with a stable English `reason` (e.g. `network_tcp_missing_host`).
 * Everything else — tenant consistency of the `agent_id` binding, the transport CHECK — is enforced
 * by the DB (the composite FK + `printers_transport_fields_ck`), proven in packages/db's
 * printing.rls.test.ts, so this verb stays a thin insert.
 */
export async function createPrinter(
  tx: Transaction,
  cfg: PrintConfig,
  input: CreatePrinterInput,
): Promise<{ id: string }> {
  const missing = REQUIRED_FIELDS[input.transport].find((field) => input[field] === undefined);
  if (missing !== undefined) {
    throw new AppError("printer.invalid_config", {
      reason: `${input.transport}_missing_${missing}`,
    });
  }

  const [row] = await tx
    .insert(printers)
    .values({
      tenantId: cfg.tenantId,
      locationId: cfg.locationId,
      name: input.name,
      transport: input.transport,
      // Undefined connection fields are OMITTED by drizzle, so each falls to its column default —
      // NULL for the transport-specific columns, 9100 for `port` (schema/printers.ts).
      agentId: input.agentId,
      host: input.host,
      port: input.port,
      usbPath: input.usbPath,
      pollId: input.pollId,
    })
    .returning({ id: printers.id });
  return { id: row!.id };
}
