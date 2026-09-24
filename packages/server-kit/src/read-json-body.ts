import type { Context } from "hono";

/**
 * Coerces an empty, malformed or literal-`null` body to `{}`, so the caller's field checks refuse
 * it with a 4xx rather than the error boundary answering 500. A primitive or array body is returned
 * unchanged, and any throw other than a `SyntaxError` is a real server fault and is rethrown. `T`
 * is the caller's assertion; its own guards still reject a missing or wrong-typed field.
 */
export async function readJsonBody<T>(c: Context): Promise<T> {
  const parsed = await c.req.json<T>().catch((cause: unknown): T => {
    if (cause instanceof SyntaxError) return {} as T;
    throw cause;
  });
  return (parsed ?? {}) as T;
}

/**
 * {@link readJsonBody} without the `{}` coercion: an empty, malformed or literal-`null` body is
 * `null`, for a route that must tell an object body apart from those.
 */
export async function readRawJsonBody<T>(c: Context): Promise<T | null> {
  return c.req.json<T>().catch((cause: unknown): null => {
    if (cause instanceof SyntaxError) return null;
    throw cause;
  });
}
