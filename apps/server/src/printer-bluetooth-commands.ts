import { randomUUID } from "node:crypto";
import type {
  BluetoothCommand,
  BluetoothCommandKind,
  BluetoothCommandOutcome,
} from "@waitron/print-agent";
import { AppError } from "@waitron/shared";
import "./errors.js";

export interface BluetoothCommandStatus {
  id: string;
  kind: BluetoothCommandKind;
  address: string;
  state: "pending" | "succeeded" | "failed";
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

const MAX_PER_AGENT = 8;
const COMMAND_TTL_MS = 60_000;
const RESULT_TTL_MS = 60_000;

function statusOf({ id, kind, address }: BluetoothCommand): BluetoothCommandStatus {
  return { id, kind, address, state: "pending" };
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
  accept(agentId: string, outcomes: BluetoothCommandOutcome[]): void;
  latest(agentId: string, address: string): BluetoothCommandStatus | undefined;
} {
  const now = options.now ?? Date.now;
  const newId = options.id ?? randomUUID;
  const agents = new Map<string, AgentCommands>();

  function prune(): number {
    const instant = now();
    for (const [agentId, agent] of agents) {
      for (const [address, entry] of agent.pending)
        if (entry.expiresAt <= instant) agent.pending.delete(address);
      for (const [address, entry] of agent.results)
        if (entry.expiresAt <= instant) agent.results.delete(address);
      if (agent.pending.size === 0 && agent.results.size === 0) agents.delete(agentId);
    }
    return instant;
  }

  function agentFor(agentId: string): AgentCommands {
    let agent = agents.get(agentId);
    if (!agent) {
      agent = { pending: new Map(), results: new Map() };
      agents.set(agentId, agent);
    }
    return agent;
  }

  return {
    enqueue(agentId, kind, address, pin) {
      const instant = prune();
      const heldPin = kind === "pair" ? pin : undefined;
      const existing = agents.get(agentId)?.pending.get(address);
      if (existing?.command.kind === kind && existing.command.pin === heldPin)
        return statusOf(existing.command);
      if (!existing && (agents.get(agentId)?.pending.size ?? 0) >= MAX_PER_AGENT)
        throw new AppError("printer.bluetooth_command_busy", {});
      // A changed kind or PIN takes a fresh id: the agent never reruns an id it has taken.
      const command: BluetoothCommand = { id: newId(), kind, address };
      if (heldPin !== undefined) command.pin = heldPin;
      const agent = agentFor(agentId);
      agent.pending.set(address, { command, expiresAt: instant + COMMAND_TTL_MS });
      agent.results.delete(address);
      return statusOf(command);
    },

    current(agentId) {
      prune();
      const pending = agents.get(agentId)?.pending.values() ?? [];
      return [...pending].map(({ command }) => ({ ...command }));
    },

    accept(agentId, outcomes) {
      const instant = prune();
      const agent = agents.get(agentId);
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
          if (!outcome.ok && outcome.error !== undefined) status.error = outcome.error;
          agent.results.set(address, { status, expiresAt: instant + RESULT_TTL_MS });
          if (agent.results.size > MAX_PER_AGENT)
            agent.results.delete(agent.results.keys().next().value!);
          break;
        }
      }
    },

    latest(agentId, address) {
      prune();
      const agent = agents.get(agentId);
      const pending = agent?.pending.get(address);
      if (pending) return statusOf(pending.command);
      const result = agent?.results.get(address);
      return result ? { ...result.status } : undefined;
    },
  };
}
