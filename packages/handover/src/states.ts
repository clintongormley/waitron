import { AppError } from "@waitron/shared";
import type { HandoverScenario } from "./binding.js";
import "./errors.js";

export type HandoverRole = "source" | "destination";

export const HANDOVER_STATES = [
  "prepared",
  "source_stepped_down",
  "filing_relinquished",
  "source_superseded",
  "copy_accepted",
  "filing_assumed",
  "emergency_declared",
  "activated",
  "return_pending",
  "return_complete",
  "return_abandoned",
  "replaced",
  "abandoned",
] as const;

export type HandoverState = (typeof HANDOVER_STATES)[number];

type Steps = Readonly<
  { start: readonly [HandoverState] } & Partial<Record<HandoverState, readonly HandoverState[]>>
>;

// The plan's Formats → progress states table; `start` is a box with no row for the operation yet.
const STEPS: Readonly<Record<HandoverRole, Record<HandoverScenario, Steps>>> = {
  source: {
    controlled: {
      start: ["prepared"],
      prepared: ["source_stepped_down", "abandoned"],
      source_stepped_down: ["filing_relinquished", "replaced"],
      filing_relinquished: ["return_pending"],
      return_pending: ["return_complete"],
    },
    emergency: {
      start: ["source_superseded"],
      source_superseded: ["return_pending"],
      return_pending: ["return_complete"],
    },
  },
  destination: {
    controlled: {
      start: ["prepared"],
      prepared: ["copy_accepted", "replaced", "abandoned"],
      copy_accepted: ["filing_assumed"],
      filing_assumed: ["activated"],
      activated: ["return_pending"],
      return_pending: ["return_complete", "return_abandoned"],
    },
    emergency: {
      start: ["prepared"],
      prepared: ["emergency_declared"],
      emergency_declared: ["activated"],
      activated: ["return_pending"],
      return_pending: ["return_complete", "return_abandoned"],
    },
  },
};

const CLOSED: readonly HandoverState[] = [
  "return_complete",
  "return_abandoned",
  "replaced",
  "abandoned",
];

export function nextState(
  role: HandoverRole,
  scenario: HandoverScenario,
  from: HandoverState | null,
  to: HandoverState,
): HandoverState {
  const allowed = STEPS[role][scenario][from ?? "start"];
  if (allowed?.includes(to) !== true)
    throw new AppError("handover.step_out_of_order", { from, to });
  return to;
}

/** The state a box records when it begins an operation in this role and scenario. */
export function initialState(role: HandoverRole, scenario: HandoverScenario): HandoverState {
  return STEPS[role][scenario].start[0];
}

/** Open until one of the four closing states. */
export function isOpen(state: HandoverState): boolean {
  return !CLOSED.includes(state);
}
