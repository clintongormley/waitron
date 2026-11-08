import { vi } from "vitest";
import { initNamingPerson, learnFromAnswer, noteSessionPerson } from "./tab-person.js";

// Every test request carrying a till session token it knows, and no person header, gains the
// person of that token, as a correct till's request does. Hono's `app.fetch` is not wrapped; a test
// that moves a session to another person calls `noteSessionPerson` for the new one.

// The source file, not the package: a test file's own `vi.mock("@waitron/identity")` replaces a
// package mock made here, but its `importOriginal` still loads this one.
vi.mock("../../../../packages/identity/src/login.ts", async (importOriginal) => {
  const actual =
    await importOriginal<
      Pick<typeof import("@waitron/identity"), "loginWithPin" | "endSession" | "endDeviceSessions">
    >();
  return {
    ...actual,
    loginWithPin: async (...args: Parameters<typeof actual.loginWithPin>) => {
      const session = await actual.loginWithPin(...args);
      noteSessionPerson(session.token, session.personId);
      return session;
    },
  };
});

// Hono's `request` is an instance field, so it is wrapped per instance, not on a prototype.
vi.mock("hono", async (importOriginal) => {
  const actual = await importOriginal<typeof import("hono")>();
  class Hono extends actual.Hono {
    constructor(...args: ConstructorParameters<typeof actual.Hono>) {
      super(...args);
      const request = this.request;
      this.request = (async (input, init, ...rest) => {
        const res = await request(input, initNamingPerson(input, init) ?? init, ...rest);
        await learnFromAnswer(input, init, res);
        return res;
      }) as typeof request;
    }
  }
  return { ...actual, Hono };
});

// Relies on Vitest's per-file isolation: with `isolate: false` these wrappers would stack, and the
// token record would be shared across files.
const fetchOf = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const res = await fetchOf(input, initNamingPerson(input, init) ?? init);
  await learnFromAnswer(input, init, res);
  return res;
};
