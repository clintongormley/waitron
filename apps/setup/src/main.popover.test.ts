import { afterEach, expect, test, vi } from "vitest";
import { render } from "lit";

const gate = vi.hoisted(() => ({
  start: undefined as (() => void) | undefined,
  failed: undefined as ((error: unknown) => void) | undefined,
}));
vi.mock("@waitron/ui", async (original) => ({
  ...(await original<typeof import("@waitron/ui")>()),
  startWithPopover: (start: () => void, failed: (error: unknown) => void) => {
    gate.start = start;
    gate.failed = failed;
  },
}));
let root: HTMLElement;
afterEach(() => {
  render(null, root);
  root.remove();
  vi.unstubAllGlobals();
});

test("no app shadow roots mount until Popover startup releases them", async () => {
  vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
  root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  await import("./main.js");
  expect(root.children).toHaveLength(0);
  gate.failed!(new TypeError("chunk unavailable"));
  const { diag } = await import("./diagnostics.js");
  expect(diag.snapshot()).toContainEqual(
    expect.objectContaining({
      level: "error",
      event: "ui.popover_load_failed",
      fields: { name: "TypeError" },
    }),
  );
  expect(gate.start).toBeTypeOf("function");
  gate.start!();
  await vi.waitFor(() => expect(root.querySelector("setup-app")?.shadowRoot).toBeTruthy());
  expect(root.querySelectorAll("setup-app")).toHaveLength(1);
});
