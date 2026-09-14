import type { Context } from "hono";

/**
 * Read a JSON request body without letting an empty or malformed body become an opaque 500.
 *
 * `c.req.json()` THROWS a `SyntaxError` on an empty or malformed body, so the widespread
 * `(await c.req.json<T>()) ?? {}` pattern never reaches its `?? {}` fallback on those inputs: the
 * throw escapes the route to its error boundary (`createErrorBoundary`), which classes a non-AppError
 * as a server fault and answers an opaque `server.internal` 500. This helper coerces exactly two
 * degenerate bodies to `{}` — a parse failure (the `SyntaxError`) and a literal JSON `null` body,
 * which parses successfully to `null` — so the caller's field validation rejects it with a specific
 * 4xx instead of a 500.
 *
 * It is deliberately narrow. A NON-`SyntaxError` throw from `c.req.json()` — e.g. a "Body already
 * used" double-read — is a real server fault, so it is rethrown and the boundary still surfaces it as
 * a 500 rather than masking it as a client 4xx. And a well-formed JSON PRIMITIVE or ARRAY body is
 * returned UNCHANGED (not `{}`): it neither throws nor is `null`, so a field access on it is
 * `undefined` — not a throw — and the caller's own guards still reject it. `T` is the caller's
 * assertion about the fields it will read, exactly as `c.req.json<T>()` was; those guards remain
 * responsible for rejecting a missing or wrong-typed field.
 */
export async function readJsonBody<T>(c: Context): Promise<T> {
  const parsed = await c.req.json<T>().catch((cause: unknown): T => {
    if (cause instanceof SyntaxError) return {} as T;
    throw cause;
  });
  return (parsed ?? {}) as T;
}

/**
 * Read a JSON request body while KEEPING the null/empty/malformed cases distinct from a well-formed
 * body — the same `SyntaxError`-to-degenerate mapping as {@link readJsonBody}, but WITHOUT its
 * `?? {}` coercion.
 *
 * A route uses this instead of {@link readJsonBody} when it must tell an object body apart from an
 * absent, empty, malformed, or literal-`null` one — e.g. to refuse the latter as a body-shape fault
 * naming the field "body" rather than falling through to a field-specific error. A parse failure (the
 * `SyntaxError`) and a literal JSON `null` body both surface as `null` here (readJsonBody would turn
 * both into `{}`); a well-formed object, primitive, or array is returned UNCHANGED. As in
 * `readJsonBody`, a NON-`SyntaxError` throw (e.g. a "Body already used" double-read) is a real server
 * fault and is rethrown, so the error boundary still surfaces it as a 500 rather than a client 4xx.
 * `T` is the caller's assertion about the fields it will read; the caller's own guards remain
 * responsible for screening the returned value's shape and rejecting a missing or wrong-typed field.
 */
export async function readRawJsonBody<T>(c: Context): Promise<T | null> {
  return c.req.json<T>().catch((cause: unknown): null => {
    if (cause instanceof SyntaxError) return null;
    throw cause;
  });
}
