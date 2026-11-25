import type { DiscoveredPrinter, PagePrinterEntry, PrintAgentRow } from "../api/client.js";
import type { StringKey } from "../i18n/strings.js";

/** What an office printer's discovery row offers, judged against the venue's page printers. */
export type OfficeRow =
  | { kind: "add"; entry: PagePrinterEntry }
  | { kind: "repoint"; entry: PagePrinterEntry; agentGone: boolean }
  | { kind: "added" }
  | { kind: "refused"; reason: StringKey };

/** One printer found: `device` is the report its row shows, of all the `reports` of it. */
export interface FoundPrinter {
  key: string;
  device: DiscoveredPrinter;
  office: OfficeRow | undefined;
  reports: readonly DiscoveredPrinter[];
}

type Queue = { port: number; resourcePath: string };

const hostOf = (device: DiscoveredPrinter) => device.host?.toLowerCase();
const addressOf = (device: DiscoveredPrinter) => `${hostOf(device)}:${device.port ?? 9100}`;
const queueOf = (device: DiscoveredPrinter) => device.office ?? device.ipp;
const queueKey = (device: DiscoveredPrinter, queue: Queue) =>
  `ipp:${encodeURIComponent(JSON.stringify([hostOf(device), queue.port, queue.resourcePath]))}`;

export function deviceKey(device: DiscoveredPrinter): string {
  const queue = queueOf(device);
  if (device.ippOnly && queue) return queueKey(device, queue);
  return device.localKey ?? addressOf(device);
}

/** One agent's report of one device, where `FoundPrinter.key` spans the agents. */
export function reportKey(device: DiscoveredPrinter): string {
  return `${device.agentId}:${deviceKey(device)}`;
}

const OTHER_AGENT = 2;
const agentRank = ({ active, onThisBox }: PrintAgentRow) =>
  active ? (onThisBox ? 0 : 1) : OTHER_AGENT;

const SHOWN_FIRST: Record<OfficeRow["kind"], number> = { repoint: 0, added: 1, add: 2, refused: 3 };

/**
 * One entry per printer: an A4 printer's queue, any other network printer's address, or one agent's
 * USB or Bluetooth device.
 */
export function foundPrinters(
  devices: readonly DiscoveredPrinter[],
  officeRow: (device: DiscoveredPrinter) => OfficeRow | undefined,
  agents: readonly PrintAgentRow[],
): FoundPrinter[] {
  const ranks = new Map(agents.map((agent) => [agent.id, agentRank(agent)]));
  const reports = devices.map((device) => {
    const office = officeRow(device);
    const queue = office && queueOf(device);
    return {
      device,
      office,
      queue: queue && queueKey(device, queue),
      order: SHOWN_FIRST[office?.kind ?? "add"],
      agent: ranks.get(device.agentId) ?? OTHER_AGENT,
    };
  });
  const heard = reports.filter(({ device }) => device.ipp || device.ippOnly);
  const announced = new Set(heard.map(({ queue }) => queue));
  const queuesAt = (list: typeof reports) =>
    new Map(list.flatMap(({ device, queue }) => (queue ? [[addressOf(device), queue]] : [])));
  const queueAt = queuesAt(reports);
  const announcedAt = queuesAt(heard.filter(({ device }) => !device.ippOnly));
  // An agent that heard no announcement guesses `/ipp/print` (`endpointOf`, apps/print-agent/src/ipp-probe.ts).
  const printerQueue = ({ device, office, queue }: (typeof reports)[number]) => {
    if (!office || (queue && announced.has(queue))) return queue;
    const at = addressOf(device);
    return announcedAt.get(at) ?? queue ?? queueAt.get(at);
  };
  const groups = new Map<string, typeof reports>();
  for (const report of reports) {
    const { device } = report;
    const key =
      device.transport === "network_tcp"
        ? `network:${printerQueue(report) ?? addressOf(device)}`
        : reportKey(device);
    groups.set(key, [...(groups.get(key) ?? []), report]);
  }
  return [...groups].map(([key, group]) => {
    const [shown] = [...group].sort(
      (a, b) =>
        a.order - b.order || a.agent - b.agent || a.device.agentId.localeCompare(b.device.agentId),
    );
    const { device, office } = shown!;
    return { key, device, office, reports: group.map((report) => report.device) };
  });
}
