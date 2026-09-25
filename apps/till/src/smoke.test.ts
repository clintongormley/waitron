import { afterEach, expect, test } from "vitest";
import { WtButton } from "@waitron/ui";

afterEach(() => {
  document.body.innerHTML = "";
});

// If this suite is red, the browser runner is broken and no other till UI test can be trusted.
test("the @waitron/ui button primitive registers and mounts in the browser runner", async () => {
  // Naming the imported class keeps its side-effecting module — the @customElement("wt-button")
  // decorator that calls customElements.define — in the graph.
  expect(WtButton).toBeDefined();

  document.body.innerHTML = "<wt-button>Cobrar</wt-button>";
  const el = document.querySelector("wt-button") as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await el.updateComplete;

  expect(customElements.get("wt-button")).toBe(WtButton);
  expect(el.textContent?.trim()).toBe("Cobrar");
});
