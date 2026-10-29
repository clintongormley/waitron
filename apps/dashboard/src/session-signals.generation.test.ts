import { expect, it } from "vitest";
import { createSessionEpoch, createSessionSignals } from "./session-signals.js";

it("carries the originating epoch through both session event kinds", () => {
  const epoch = createSessionEpoch();
  const target = new EventTarget();
  const seen: unknown[] = [];
  for (const type of ["waitron-session-invalid", "waitron-session-active"])
    target.addEventListener(type, (event) => seen.push((event as CustomEvent).detail));
  const signals = createSessionSignals({ target, sessionGeneration: epoch.current });
  const old = epoch.current();
  expect(epoch.advance()).toBe(old + 1);
  signals.reportError("management_session.expired", 401, old);
  signals.reportActivity("/old", old);
  signals.reportActivity();
  expect(seen).toEqual([
    { code: "management_session.expired", generation: old },
    { generation: old },
    { generation: old + 1 },
  ]);
});
