import { expect, it } from "vitest";
import { startAgainSummary } from "./first-setup-start-again-summary.js";
import type { FirstSetupState } from "./first-setup-state.js";

type Attempt = { history: { kind: string }[]; result: unknown };
function state(current: Attempt, previous: Attempt[] = []): FirstSetupState {
  const shape = (attempt: Attempt) => ({
    result: attempt.result,
    history: attempt.history.map((event, index) => ({
      kind: event.kind,
      revision: index + 1,
      ownerGeneration: 1,
    })),
  });
  return { ...shape(current), previous: previous.map(shape) } as unknown as FirstSetupState;
}
const events = (...kinds: string[]): Attempt => ({
  history: kinds.map((kind) => ({ kind })),
  result: null,
});

it.each([
  ["no events past claiming", state(events("claim", "input", "checked")), "claimed"],
  ["candidates", state(events("claim", "candidates")), "named"],
  ["import", state(events("claim", "import")), "named"],
  ["consumption-intent", state(events("claim", "consumption-intent")), "named"],
  [
    "activation-started",
    state(events("claim", "candidates", "activation-started")),
    "fiscal-started",
  ],
  ["uncertain", state(events("claim", "uncertain")), "fiscal-started"],
  ["committed", state(events("claim", "activation-started", "committed")), "fiscal-finished"],
  ["publication", state(events("claim", "publication")), "fiscal-finished"],
  ["complete", state(events("claim", "complete")), "fiscal-finished"],
  ["a non-null result", state({ history: [{ kind: "claim" }], result: {} }), "fiscal-finished"],
  [
    "an event found only in a previous attempt",
    state(events("claim"), [events("claim", "activation-started")]),
    "fiscal-started",
  ],
  [
    "a result found only in a previous attempt",
    state(events("claim", "candidates"), [{ history: [], result: { done: true } }]),
    "fiscal-finished",
  ],
] as const)("%s reaches %s", (_label, value, reached) => {
  expect(startAgainSummary(value)).toEqual({ reached });
});
