import type { OfficePrinterReport } from "@waitron/print-agent";

export interface IppQueue {
  port: number;
  resourcePath: string;
}
export interface DiscoveredEntry {
  agentId: string;
  transport: string;
  localKey?: string;
  host?: string;
  port?: number;
  make?: string;
  model?: string;
  name?: string;
  serverName?: string;
  pagePrinter?: true;
  ipp?: IppQueue;
  ippOnly?: true;
  office?: OfficePrinterReport;
  printerLike?: true;
  /** The latest paired report's answer; absent when the agent could not tell. */
  pairedPrinterLike?: boolean;
  /** Calendar time sent to the dashboard. */
  lastSeenAt: number;
  /** Steady time of the latest report of any kind. */
  reportedAt: number;
  /** Only a scan sets this, and only it authorizes Pair. */
  scannedAt?: number;
  /** Only a paired report sets this and qualifies the box for unpairing on Delete. */
  pairedAt?: number;
  /** Only a visible report sets this: the agent can print to the device. */
  visibleAt?: number;
}
