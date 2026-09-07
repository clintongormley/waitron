import { Hono } from "hono";
import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import { readJsonBody } from "./read-json-body.js";

/** A minimal Context stub whose `c.req.json()` rejects with `cause`, to drive the helper's
 * error-discrimination directly (Hono caches a parsed body, so a real double-read cannot be provoked
 * through `app.request`). */
function contextRejectingWith(cause: unknown): Context {
  return { req: { json: () => Promise.reject(cause) } } as unknown as Context;
}

// A throwaway app whose one route echoes back whatever `readJsonBody` hands it, so each case below
// asserts the helper's own return value rather than any downstream validation.
const app = new Hono();
app.post("/echo", async (c) => c.json(await readJsonBody<{ a?: unknown }>(c)));

async function post(body: string) {
  return app.request("/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("readJsonBody", () => {
  it("returns the parsed object for a well-formed JSON body", async () => {
    const res = await post(JSON.stringify({ a: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ a: 1 });
  });

  it("returns {} for a malformed body instead of letting c.req.json() throw", async () => {
    // `c.req.json()` throws a SyntaxError here; without the helper's `.catch` that throw would escape
    // the route (→ the error boundary's opaque 500). The helper coerces it to {} and the route resolves.
    const res = await post("{ not json");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("returns {} for an empty body", async () => {
    const res = await post("");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("returns {} for a literal JSON null body (the ?? {} branch)", async () => {
    // A body of the literal `null` parses successfully to `null` — no throw — so this exercises the
    // `?? {}` fallback rather than the `.catch`.
    const res = await post("null");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("coerces a SyntaxError (parse failure) to {}", async () => {
    // The one throw the helper is meant to swallow — a body-parse failure.
    const body = await readJsonBody(
      contextRejectingWith(new SyntaxError("Unexpected end of JSON input")),
    );
    expect(body).toEqual({});
  });

  it("rethrows a non-SyntaxError from c.req.json() instead of masking it as {}", async () => {
    // A "Body already used" double-read (or any other fault) rejects with a TypeError, NOT a
    // SyntaxError. The helper must let it through so the error boundary surfaces it as a 500 rather
    // than hiding a real bug behind a client 4xx. (Proven by deletion: drop the `if (cause instanceof
    // SyntaxError)` guard so the catch returns `{}` unconditionally, and this expectation fails.)
    const boom = new TypeError("Body has already been read");
    await expect(readJsonBody(contextRejectingWith(boom))).rejects.toBe(boom);
  });
});
