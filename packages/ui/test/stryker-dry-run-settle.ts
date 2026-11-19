import { afterEach, inject } from "vitest";

// Stryker marks code that runs between tests as static and reruns those mutants against every test
// in the slice, so during its coverage run each test is held open until its own next frame and task
// have run. This hook must run before Stryker's afterEach that clears the current test, which holds
// because Stryker's setup file is listed first and Vitest runs after-hooks in reverse order.
if ((inject as (key: string) => unknown)("mode") === "dry-run")
  afterEach(() => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve))));
