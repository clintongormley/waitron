import { TestRunner, expect, inject, it } from "vitest";

// Stryker provides `mode`; an ordinary run has none.
it.runIf(inject("mode") === undefined)(
  "an ordinary run's setup files add no after-each hook",
  ({ task }) => {
    expect(TestRunner.getSuiteHooks(task.file).afterEach).toEqual([]);
  },
);
