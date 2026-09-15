import type { Transaction } from "@waitron/db";

export type AlertSeverity = "warning" | "error";

/** One alert as the dashboard receives it. An event is a recorded incident and stays until someone
 * marks it handled; an ongoing alert exists only while the check that raised it still finds it. */
export interface Alert {
  readonly key: string;
  readonly kind: "event" | "ongoing";
  readonly code: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly severity: AlertSeverity;
  readonly since: string | null;
  readonly area: string;
  readonly screen?: string;
  readonly handledAt?: string;
  readonly handledBy?: string | null;
}

/** What a source returns; the registry stamps `kind` and `area` from the source itself. */
export type OngoingAlert = Pick<Alert, "key" | "code" | "params" | "severity" | "since" | "screen">;

export interface AlertReadContext {
  readonly tx: Transaction;
  readonly now: Date;
}

/** An ongoing check, asked only when the session holds `permission`. */
export interface AlertSource {
  readonly area: string;
  readonly permission: string;
  read(ctx: AlertReadContext): Promise<readonly OngoingAlert[]>;
}

/** Incidents whose code starts with `prefix` belong to `area` and need `permission` to see. */
export interface AlertEventClaim {
  readonly prefix: string;
  readonly area: string;
  readonly permission: string;
}

export interface ModuleAlerts {
  readonly events?: readonly AlertEventClaim[];
  readonly sources?: readonly AlertSource[];
}
