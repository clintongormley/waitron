import { afterEach, expect, test, vi } from "vitest";
import { render } from "lit";

const gate = vi.hoisted(() => ({ start: undefined as (() => void) | undefined }));
vi.mock("@waitron/ui", async (original) => ({
  ...(await original<typeof import("@waitron/ui")>()),
  startWithPopover: (start: () => void) => {
    gate.start = start;
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
  expect(gate.start).toBeTypeOf("function");
  gate.start!();
  await vi.waitFor(() => expect(root.querySelector("setup-app")?.shadowRoot).toBeTruthy());
  expect(root.querySelectorAll("setup-app")).toHaveLength(1);
});
