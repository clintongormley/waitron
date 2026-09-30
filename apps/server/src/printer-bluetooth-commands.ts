import { randomUUID } from "node:crypto";
import {
  BLUETOOTH_COMMAND_LIMIT,
  MAX_OUTCOME_ERROR_LENGTH,
  withholdPin,
  type BluetoothCommand,
  type BluetoothCommandKind,
  type BluetoothCommandOutcome,
} from "@waitron/print-agent";
import { AppError } from "@waitron/shared";
import "./errors.js";

export interface BluetoothCommandStatus {
  id: string;
  kind: BluetoothCommandKind;
  address: string;
  state: "pending" | "succeeded" | "failed";
  /** On a pending command only: how long until the server drops it unanswered. */
  expiresInMs?: number;
  error?: string;
}

interface Pending {
  command: BluetoothCommand;
  expiresAt: number;
}

interface Result {
  status: BluetoothCommandStatus;
  expiresAt: number;
}

interface AgentCommands {
  pending: Map<string, Pending>;
  results: Map<string, Result>;
}

/** No more than the agent reads from one reply, so every pending command reaches it in each reply. */
const MAX_PENDING_PER_AGENT = BLUETOOTH_COMMAND_LIMIT;
/** As many as one full queue settles, so no outcome evicts another from the same pull. */
const MAX_RESULTS_PER_AGENT = BLUETOOTH_COMMAND_LIMIT;
/** Outlasts one command the agent starts at once: 10 s to register, a 75 s pair timeout and 5 s exit
 * grace (apps/print-agent/src/bluetooth-command.ts), then the pull that carries its outcome. A
 * command queued behind another can still expire. */
const COMMAND_TTL_MS = 120_000;
const RESULT_TTL_MS = 60_000;
/** `enqueue`, `current`, `accept` and `latest` each prune the agent they name, and at most once per
 * interval every agent, so an agent none of them names again still loses its expired entries at the
 * first of those calls after the interval. */
const SWEEP_INTERVAL_MS = 60_000;

function statusOf({ command, expiresAt }: Pending, instant: number): BluetoothCommandStatus {
  const { id, kind, address } = command;
  return { id, kind, address, state: "pending", expiresInMs: expiresAt - instant };
}

/** A pending pair holds the operator's PIN in memory only, so each pull can resend it until the
 * outcome arrives; no status ever carries it. */
export function createPrinterBluetoothCommands(
  options: { now?: () => number; id?: () => string } = {},
): {
  enqueue(
    agentId: string,
    kind: BluetoothCommandKind,
    address: string,
    pin?: string,
  ): BluetoothCommandStatus;
  current(agentId: string): BluetoothCommand[];
  /** The addresses whose pending unpairing `outcomes` report succeeded; settles nothing. */
  unpaired(agentId: string, outcomes: BluetoothCommandOutcome[]): string[];
  accept(agentId: string, outcomes: BluetoothCommandOutcome[]): void;
  latest(agentId: string, address: string): BluetoothCommandStatus | undefined;
  /** How many agents hold entries. */
  agentsHeld(): number;
} {
  const now = options.now ?? (() => Date.now());
  const newId = options.id ?? randomUUID;
  const agents = new Map<string, AgentCommands>();
  let nextSweepAt = 0;

  function pruneAgent(agentId: string, agent: AgentCommands, instant: number): void {
    for (const [address, entry] of agent.pending)
      if (entry.expiresAt <= instant) agent.pending.delete(address);
    for (const [address, entry] of agent.results)
      if (entry.expiresAt <= instant) agent.results.delete(address);
    if (agent.pending.size === 0 && agent.results.size === 0) agents.delete(agentId);
  }

  /** Prunes the named agent, or every agent when a sweep is due, and returns the instant used. */
  function prune(agentId: string): { instant: number; agent: AgentCommands | undefined } {
    const instant = now();
    if (instant >= nextSweepAt) {
      for (const [id, agent] of agents) pruneAgent(id, agent, instant);
      nextSweepAt = instant + SWEEP_INTERVAL_MS;
    } else {
      const agent = agents.get(agentId);
      if (agent) pruneAgent(agentId, agent, instant);
    }
    return { instant, agent: agents.get(agentId) };
  }

  return {
    enqueue(agentId, kind, address, pin) {
      const { instant, agent: held } = prune(agentId);
      const heldPin = kind === "pair" ? pin : undefined;
      const existing = held?.pending.get(address);
      if (existing?.command.kind === kind && existing.command.pin === heldPin)
        return statusOf(existing, instant);
      if (!existing && (held?.pending.size ?? 0) >= MAX_PENDING_PER_AGENT)
        throw new AppError("printer.bluetooth_command_busy", {});
      // A changed kind or PIN takes a fresh id: the agent never reruns an id it has taken.
      const command: BluetoothCommand = { id: newId(), kind, address };
      if (heldPin !== undefined) command.pin = heldPin;
      const agent = held ?? { pending: new Map(), results: new Map() };
      agents.set(agentId, agent);
      const entry = { command, expiresAt: instant + COMMAND_TTL_MS };
      agent.pending.set(address, entry);
      agent.results.delete(address);
      return statusOf(entry, instant);
    },

    current(agentId) {
      const pending = prune(agentId).agent?.pending.values() ?? [];
      return [...pending].map(({ command }) => ({ ...command }));
    },

    unpaired(agentId, outcomes) {
      const succeeded = new Set(outcomes.filter(({ ok }) => ok).map(({ id }) => id));
      const pending = prune(agentId).agent?.pending ?? new Map<string, Pending>();
      return [...pending]
        .filter(([, { command }]) => command.kind === "forget" && succeeded.has(command.id))
        .map(([address]) => address);
    },

    accept(agentId, outcomes) {
      const { instant, agent } = prune(agentId);
      if (!agent) return;
      for (const outcome of outcomes) {
        for (const [address, { command }] of agent.pending) {
          if (command.id !== outcome.id) continue;
          agent.pending.delete(address);
          const status: BluetoothCommandStatus = {
            id: command.id,
            kind: command.kind,
            address,
            state: outcome.ok ? "succeeded" : "failed",
          };
          if (!outcome.ok && outcome.error !== undefined) {
            status.error = withholdPin(outcome.error, command.pin).slice(
              0,
              MAX_OUTCOME_ERROR_LENGTH,
            );
          }
          agent.results.set(address, { status, expiresAt: instant + RESULT_TTL_MS });
          if (agent.results.size > MAX_RESULTS_PER_AGENT)
            agent.results.delete(agent.results.keys().next().value!);
          break;
        }
      }
    },

    latest(agentId, address) {
      const { instant, agent } = prune(agentId);
      const pending = agent?.pending.get(address);
      if (pending) return statusOf(pending, instant);
      const result = agent?.results.get(address);
      return result ? { ...result.status } : undefined;
    },

    agentsHeld() {
      return agents.size;
    },
  };
}
