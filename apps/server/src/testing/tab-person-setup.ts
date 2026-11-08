import { vi } from "vitest";
import { initNamingPerson, learnFromAnswer, noteSessionPerson } from "./tab-person.js";

// Every test request carrying a till session token it knows, and no person header, gains the
// person of that token, as a correct till's request does. A1380 rework plan, §6.

// The source file, not the package: a test file's own `vi.mock("@waitron/identity")` replaces a
// package mock made here, but its `importOriginal` still loads this one.
vi.mock("../../../../packages/identity/src/login.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/identity")>();
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

const fetchOf = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const res = await fetchOf(input, initNamingPerson(input, init) ?? init);
  await learnFromAnswer(input, init, res);
  return res;
};
