import { Hono } from "hono";
import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import { readJsonBody, readRawJsonBody } from "./read-json-body.js";

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

// A second echo app for readRawJsonBody, which returns the parsed body UNCHANGED (or null), so each
// case asserts exactly what the helper returned — including the distinction the /split and /unjoin
// routes depend on: a literal/absent/malformed body arrives as `null`, an object arrives as itself.
const rawApp = new Hono();
rawApp.post("/echo", async (c) => c.json(await readRawJsonBody<{ a?: unknown }>(c)));

async function postRaw(body: string) {
  return rawApp.request("/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("readRawJsonBody", () => {
  it("returns the parsed object UNCHANGED for a well-formed JSON body (no {} coercion)", async () => {
    const res = await postRaw(JSON.stringify({ a: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ a: 1 });
  });

  it("returns null for a malformed body instead of letting c.req.json() throw", async () => {
    const res = await postRaw("{ not json");
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("returns null for an empty body", async () => {
    const res = await postRaw("");
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("returns null for a literal JSON null body (NOT coerced to {})", async () => {
    // The whole reason this sibling exists: /split and /unjoin must tell a literal `null` body apart
    // from an object, so unlike readJsonBody it must NOT coerce null to {}.
    const res = await postRaw("null");
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("coerces a SyntaxError (parse failure) to null", async () => {
    const body = await readRawJsonBody(
      contextRejectingWith(new SyntaxError("Unexpected end of JSON input")),
    );
    expect(body).toBeNull();
  });

  it("rethrows a non-SyntaxError from c.req.json() instead of masking it as null", async () => {
    // Proven by deletion: drop the `if (cause instanceof SyntaxError)` guard so the catch returns
    // `null` unconditionally, and this expectation fails.
    const boom = new TypeError("Body has already been read");
    await expect(readRawJsonBody(contextRejectingWith(boom))).rejects.toBe(boom);
  });
});
