import type { Transport } from "./transport.js";

/**
 * The seam between the agent's logic and the machine it runs on (base spec §2.1). A container host reads
 * env + a state directory and serves a setup page; a native till host later reads a settings screen.
 * The loop never touches the filesystem, a clock, a timer or a logger directly — only this.
 */
export interface AgentConfig {
  serverUrl: string;
  name: string;
  /** Fixed by the first successful probe of the configured address; pins which environment's jobs the
   * agent will ever pull (CLAUDE.md §5). */
  environment?: string;
}

export type AgentPhase =
  "unconfigured" | "pending" | "pairing_closed" | "running" | "unauthorized" | "unreachable";

export interface AgentStatus {
  phase: AgentPhase;
  serverUrl: string | null;
  current: string | null;
  /** The two-digit number the admin matches in the dashboard. Held in memory from the join reply; a
   * restart while pending loses it (see the resumed plan's decision 4). */
  verificationCode?: string;
  lastJobAt?: number;
  lastError?: string;
}

export interface HostLog {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface Host {
  config(): Promise<AgentConfig | null>;
  saveConfig(config: AgentConfig): Promise<void>;
  token(): Promise<string | null>;
  saveToken(token: string | null): Promise<void>;
  transport: Transport;
  fetch: typeof fetch;
  now(): number;
  sleep(ms: number): Promise<void>;
  log: HostLog;
  status(status: AgentStatus): void;
}
