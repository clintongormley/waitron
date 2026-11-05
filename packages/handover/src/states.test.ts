import { AppError } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import {
  ACTIVATED_OR_LATER,
  BEFORE_ACTIVATION,
  HANDOVER_STATES,
  READY_TO_PROMOTE,
  initialState,
  isOpen,
  nextState,
} from "./states.js";
import type { HandoverRole, HandoverState } from "./states.js";
import type { HandoverScenario } from "./binding.js";

type Step = [HandoverRole, HandoverScenario, HandoverState | null, HandoverState];

// Copied from the plan's Formats → progress states table, one row per arrow.
const ALLOWED: Step[] = [
  ["source", "controlled", null, "prepared"],
  ["source", "controlled", "prepared", "source_stepped_down"],
  ["source", "controlled", "source_stepped_down", "filing_relinquished"],
  ["source", "controlled", "filing_relinquished", "return_pending"],
  ["source", "controlled", "return_pending", "return_complete"],
  ["source", "controlled", "prepared", "abandoned"],
  ["source", "controlled", "source_stepped_down", "replaced"],
  ["source", "emergency", null, "source_superseded"],
  ["source", "emergency", "source_superseded", "return_pending"],
  ["source", "emergency", "return_pending", "return_complete"],
  ["destination", "controlled", null, "prepared"],
  ["destination", "controlled", "prepared", "copy_accepted"],
  ["destination", "controlled", "copy_accepted", "filing_assumed"],
  ["destination", "controlled", "filing_assumed", "activated"],
  ["destination", "controlled", "activated", "return_pending"],
  ["destination", "controlled", "return_pending", "return_complete"],
  ["destination", "controlled", "return_pending", "return_abandoned"],
  ["destination", "controlled", "prepared", "replaced"],
  ["destination", "controlled", "prepared", "abandoned"],
  ["destination", "emergency", null, "prepared"],
  ["destination", "emergency", "prepared", "emergency_declared"],
  ["destination", "emergency", "emergency_declared", "activated"],
  ["destination", "emergency", "activated", "return_pending"],
  ["destination", "emergency", "return_pending", "return_complete"],
  ["destination", "emergency", "return_pending", "return_abandoned"],
];

const ROLES: HandoverRole[] = ["source", "destination"];
const SCENARIOS: HandoverScenario[] = ["controlled", "emergency"];
const FROMS: (HandoverState | null)[] = [null, ...HANDOVER_STATES];

function everyStep(): Step[] {
  const steps: Step[] = [];
  for (const role of ROLES) {
    for (const scenario of SCENARIOS) {
      for (const from of FROMS) {
        for (const to of HANDOVER_STATES) steps.push([role, scenario, from, to]);
      }
    }
  }
  return steps;
}

const key = (step: Step) => step.join("|");
const allowedKeys = new Set(ALLOWED.map(key));
const isAllowed = (step: Step) => allowedKeys.has(key(step));

function refusal(step: Step): { code: string; params: unknown } {
  try {
    nextState(...step);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    return { code: appError.code, params: appError.params };
  }
  throw new Error(`nextState allowed ${key(step)}`);
}

/** What `nextState` itself answers, not what the table above lists. */
function accepts(step: Step): boolean {
  try {
    nextState(...step);
    return true;
  } catch {
    return false;
  }
}

function outOfOrder(from: HandoverState | null, to: HandoverState) {
  return { code: "handover.step_out_of_order", params: { from, to } };
}

describe("nextState", () => {
  it("lists the thirteen states of the table", () => {
    expect([...HANDOVER_STATES].sort()).toEqual(
      [
        "prepared",
        "source_stepped_down",
        "filing_relinquished",
        "return_pending",
        "return_complete",
        "abandoned",
        "replaced",
        "source_superseded",
        "copy_accepted",
        "filing_assumed",
        "activated",
        "return_abandoned",
        "emergency_declared",
      ].sort(),
    );
  });

  it.each(ALLOWED)("a %s in a %s operation goes from %s to %s", (role, scenario, from, to) => {
    expect(nextState(role, scenario, from, to)).toBe(to);
  });

  it.each<Step>([
    ["destination", "controlled", "prepared", "filing_assumed"],
    ["destination", "controlled", null, "filing_assumed"],
    ["source", "controlled", "prepared", "filing_relinquished"],
    ["source", "controlled", null, "filing_relinquished"],
    ["destination", "emergency", "prepared", "activated"],
    ["destination", "emergency", null, "activated"],
    ["destination", "controlled", "copy_accepted", "replaced"],
    ["destination", "emergency", "prepared", "replaced"],
    ["source", "controlled", "prepared", "replaced"],
    ["source", "emergency", "source_superseded", "replaced"],
    ["destination", "controlled", "copy_accepted", "abandoned"],
    ["destination", "emergency", "prepared", "abandoned"],
    ["source", "controlled", "source_stepped_down", "abandoned"],
    ["source", "controlled", "filing_relinquished", "abandoned"],
    ["source", "emergency", "source_superseded", "abandoned"],
    ["source", "controlled", "return_pending", "return_abandoned"],
    ["source", "emergency", "return_pending", "return_abandoned"],
    ["destination", "controlled", "activated", "return_abandoned"],
    ["destination", "controlled", "copy_accepted", "prepared"],
    ["source", "controlled", "return_complete", "return_pending"],
    ["destination", "emergency", "return_complete", "prepared"],
    ["source", "controlled", "prepared", "prepared"],
    ["destination", "controlled", "prepared", "emergency_declared"],
    ["source", "emergency", null, "prepared"],
    ["source", "controlled", null, "source_superseded"],
  ])("refuses a %s in a %s operation going from %s to %s", (role, scenario, from, to) => {
    expect(refusal([role, scenario, from, to])).toEqual(outOfOrder(from, to));
  });

  it("refuses every step the table does not list", () => {
    for (const step of everyStep()) {
      if (isAllowed(step)) continue;
      expect(refusal(step), key(step)).toEqual(outOfOrder(step[2], step[3]));
    }
  });

  it("only a controlled destination at `prepared` or a controlled source at `source_stepped_down` can become `replaced`", () => {
    const reaching = everyStep().filter((step) => step[3] === "replaced" && accepts(step));
    expect(reaching.map(key).sort()).toEqual(
      [
        "destination|controlled|prepared|replaced",
        "source|controlled|source_stepped_down|replaced",
      ].sort(),
    );
  });

  it("only a controlled operation at `prepared` can become `abandoned`", () => {
    const reaching = everyStep().filter((step) => step[3] === "abandoned" && accepts(step));
    expect(reaching.map(key).sort()).toEqual(
      ["destination|controlled|prepared|abandoned", "source|controlled|prepared|abandoned"].sort(),
    );
  });

  it("`return_abandoned` is reachable only by a destination at `return_pending`", () => {
    const reaching = everyStep().filter((step) => step[3] === "return_abandoned" && accepts(step));
    expect(reaching.map(key).sort()).toEqual(
      [
        "destination|controlled|return_pending|return_abandoned",
        "destination|emergency|return_pending|return_abandoned",
      ].sort(),
    );
  });

  it("no state goes back: no allowed step returns to a state already passed", () => {
    for (const role of ROLES) {
      for (const scenario of SCENARIOS) {
        const steps = everyStep().filter(
          (step) => step[0] === role && step[1] === scenario && accepts(step),
        );
        const reachable = (start: HandoverState): Set<HandoverState> => {
          const seen = new Set<HandoverState>();
          const queue = [start];
          while (queue.length > 0) {
            const state = queue.pop()!;
            for (const step of steps) {
              if (step[2] === state && !seen.has(step[3])) {
                seen.add(step[3]);
                queue.push(step[3]);
              }
            }
          }
          return seen;
        };
        for (const state of HANDOVER_STATES) {
          expect(reachable(state).has(state), `${role} ${scenario} ${state}`).toBe(false);
        }
      }
    }
  });
});

describe("the named groups of a destination's states", () => {
  const SCENARIOS: readonly HandoverScenario[] = ["controlled", "emergency"];
  const stepsFrom = (scenario: HandoverScenario, from: HandoverState) =>
    HANDOVER_STATES.filter((to) => {
      try {
        nextState("destination", scenario, from, to);
        return true;
      } catch {
        return false;
      }
    });
  const reaches = (
    scenario: HandoverScenario,
    from: HandoverState,
    target: HandoverState,
  ): boolean =>
    stepsFrom(scenario, from).some((to) => to === target || reaches(scenario, to, target));
  const inAnyScenario = (holds: (scenario: HandoverScenario, state: HandoverState) => boolean) =>
    HANDOVER_STATES.filter((state) => SCENARIOS.some((scenario) => holds(scenario, state))).sort();

  it("`ACTIVATED_OR_LATER` is `activated` and everything a destination can reach from it", () => {
    expect([...ACTIVATED_OR_LATER].sort()).toEqual(
      inAnyScenario(
        (scenario, state) => state === "activated" || reaches(scenario, "activated", state),
      ),
    );
  });

  it("`BEFORE_ACTIVATION` is every state a destination can still reach `activated` from", () => {
    expect([...BEFORE_ACTIVATION].sort()).toEqual(
      inAnyScenario((scenario, state) => reaches(scenario, state, "activated")),
    );
  });

  it("`READY_TO_PROMOTE` is every state whose next step can be `activated`", () => {
    expect([...READY_TO_PROMOTE].sort()).toEqual(
      inAnyScenario((scenario, state) => stepsFrom(scenario, state).includes("activated")),
    );
  });
});

describe("initialState", () => {
  it.each<[HandoverRole, HandoverScenario, HandoverState]>([
    ["source", "controlled", "prepared"],
    ["source", "emergency", "source_superseded"],
    ["destination", "controlled", "prepared"],
    ["destination", "emergency", "prepared"],
  ])("a %s in a %s operation starts at %s", (role, scenario, state) => {
    expect(initialState(role, scenario)).toBe(state);
    expect(ALLOWED.filter((s) => s[0] === role && s[1] === scenario && s[2] === null)).toEqual([
      [role, scenario, null, state],
    ]);
  });
});

describe("isOpen", () => {
  it("`isOpen` is false for exactly the four closed states", () => {
    const closed = HANDOVER_STATES.filter((state) => !isOpen(state));
    expect([...closed].sort()).toEqual(
      ["abandoned", "replaced", "return_abandoned", "return_complete"].sort(),
    );
  });

  it("a closed state has no step out of it", () => {
    for (const step of everyStep().filter(accepts)) {
      if (step[2] !== null) expect(isOpen(step[2]), key(step)).toBe(true);
    }
  });
});
