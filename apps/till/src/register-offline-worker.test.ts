import { expect, it, vi } from "vitest";

import { registerOfflineWorker } from "./register-offline-worker.js";

it("registers the built till worker within the till path", async () => {
  const register = vi.fn();
  await registerOfflineWorker({ built: true, secure: true, nav: { serviceWorker: { register } } });
  expect(register).toHaveBeenCalledWith("/till/offline-worker.js", { scope: "/till/" });
});

it.each([
  [false, true],
  [true, false],
])("skips registration with built=%s and secure=%s", async (built, secure) => {
  const register = vi.fn();
  await registerOfflineWorker({ built, secure, nav: { serviceWorker: { register } } });
  expect(register).not.toHaveBeenCalled();
});

it("allows the till to boot when the browser cannot register the worker", async () => {
  const register = vi.fn().mockRejectedValue(new DOMException("Worker refused", "SecurityError"));
  await registerOfflineWorker({ built: true, secure: true, nav: { serviceWorker: { register } } });
  expect(register).toHaveBeenCalledOnce();
  await registerOfflineWorker({ built: true, secure: true, nav: {} });
});
