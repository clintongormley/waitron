import { afterEach, expect, test } from "vitest";
import { WtButton } from "@waitron/ui";

afterEach(() => {
  document.body.innerHTML = "";
});

// The first @vitest/browser + Playwright suite in apps/till. Its whole job is to de-risk the
// browser toolchain FOR THIS WORKTREE before Tasks 9-19 build on it: prove Chromium actually
// boots under the runner and that a @waitron/ui primitive registers (via its @customElement
// decorator) and renders when mounted into the real DOM. If this suite is red, the runner is
// broken and no later till UI test can be trusted.
test("the @waitron/ui button primitive registers and mounts in the browser runner", async () => {
  // Naming the imported class keeps its side-effecting module — the @customElement("wt-button")
  // decorator that calls customElements.define — in the graph. A bare `import "@waitron/ui"`
  // would do the same, but referencing the export makes the dependency explicit.
  expect(WtButton).toBeDefined();

  document.body.innerHTML = "<wt-button>Cobrar</wt-button>";
  const el = document.querySelector("wt-button") as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await el.updateComplete;

  // customElements.get returning the same class the barrel exported proves registration
  // happened in this browser context, not merely that the module loaded.
  expect(customElements.get("wt-button")).toBe(WtButton);
  expect(el.textContent?.trim()).toBe("Cobrar");
});
