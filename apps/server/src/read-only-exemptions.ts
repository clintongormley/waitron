/**
 * Every write route a read-only box (a mirror, or a box its held chart fences) lets through the
 * read-only gate. Exempting a write is a security decision: each row says how the route
 * authenticates its caller, and a new row is a deliberate edit pinned by
 * `read-only-exemptions.test.ts`. GET routes need no row; the gate never refuses them.
 */
export type ReadOnlyBox = "mirror" | "fenced";

export interface ReadOnlyExemption {
  readonly method: "POST";
  /** Matched exactly. */
  readonly path: string;
  /** The read-only boxes on which the route passes the gate. */
  readonly boxes: readonly ReadOnlyBox[];
  readonly authenticates: string;
}

export const READ_ONLY_EXEMPTIONS: readonly ReadOnlyExemption[] = [
  {
    method: "POST",
    path: "/api/box/retire",
    boxes: ["fenced"],
    authenticates: "a management session whose person holds `system.manage`",
  },
  {
    method: "POST",
    path: "/management-api/promote",
    boxes: ["mirror", "fenced"],
    authenticates:
      "an administrator's password (and code when enrolled) in the body; a fenced box answers `promotion.node_fenced`",
  },
  {
    method: "POST",
    path: "/management-api/promote/preparation",
    boxes: ["mirror", "fenced"],
    authenticates:
      "HTTPS, a promote module operation, and the sign-in `node-operation-preparation.ts` checks",
  },
  {
    method: "POST",
    path: "/api/node/peer-status",
    boxes: ["mirror", "fenced"],
    authenticates:
      "a `query` envelope signed by a key the held chart vouches for and does not evict; answers only signed status",
  },
  {
    method: "POST",
    path: "/api/node/membership",
    boxes: ["mirror", "fenced"],
    authenticates:
      "none needed from the caller: the body is a signed chart, accepted only through `acceptMembershipDocument` against the stored trust set; the answer is one boolean",
  },
];

export function isReadOnlyExempt(
  request: { readonly method: string; readonly path: string },
  box: { readonly mirror: boolean; readonly fenced: boolean },
): boolean {
  return READ_ONLY_EXEMPTIONS.some(
    (row) =>
      row.method === request.method &&
      row.path === request.path &&
      row.boxes.some((kind) => box[kind]),
  );
}
