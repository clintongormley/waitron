import { afterEach, expect, it, vi } from "vitest";

const pathname = location.pathname;
afterEach(() => {
  document.querySelector("#app")?.remove();
  history.replaceState(null, "", pathname);
  vi.unstubAllGlobals();
});
it("keeps the ordinary dashboard entry on the authenticated shell", async () => {
  history.replaceState(null, "", "/manage");
  const app = document.createElement("div");
  app.id = "app";
  document.body.append(app);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ error: { code: "management_session.required" } }, { status: 401 }),
    ),
  );
  await import("./main.js");
  expect(app.querySelector("dashboard-app")).not.toBeNull();
  expect(app.querySelector("vf-conflict-recovery")).toBeNull();
});
