/**
 * Every write route a read-only box (a mirror, or a box its held chart fences) lets through the
 * read-only gate. Exempting a write is a security decision: each row says how the route
 * authenticates its caller, and a new row is a deliberate edit pinned by
 * `read-only-exemptions.test.ts`. GET routes need no row; the gate never refuses them.
 */
export type ReadOnlyBox = "mirror" | "fenced";

export interface ReadOnlyExemption {
  readonly method: "POST";
  /** Matched exactly, except that a segment spelled `:operationId` takes any one non-empty segment. */
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
      "in the body, either the box's break-glass secret or the password (and code when enrolled) of a person holding `node.promote`; a promote module operation for this box takes the same choice, or, with `noParallelRecovery` on a box that prepares operations, the HTTPS and sign-in checks `node-operation-preparation.ts` makes; a fenced box answers `promotion.node_fenced`",
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
      "a `query` envelope signed by a key this box stores for that node or the held chart vouches for, from a node the held chart neither evicts nor clears (`peerKeyOf`); answers only signed status",
  },
  {
    method: "POST",
    path: "/api/node/membership",
    boxes: ["mirror", "fenced"],
    authenticates:
      "none needed from the caller: the body is a signed chart, accepted only through `acceptMembershipDocument` against the stored trust set; the answer is one boolean",
  },
  {
    method: "POST",
    path: "/api/node/handover/offer",
    boxes: ["mirror"],
    authenticates:
      "a `stepdown` envelope signed by a key this box stores for that node or the held chart vouches for (`peerKeyOf`), whose binding names its signer as the source and this box as the destination; answers only signed status",
  },
];

function pathMatches(rowPath: string, requestPath: string): boolean {
  const rowSegments = rowPath.split("/");
  const requestSegments = requestPath.split("/");
  return (
    rowSegments.length === requestSegments.length &&
    rowSegments.every((segment, index) =>
      segment === ":operationId"
        ? requestSegments[index] !== ""
        : segment === requestSegments[index],
    )
  );
}

export function isReadOnlyExempt(
  request: { readonly method: string; readonly path: string },
  box: { readonly mirror: boolean; readonly fenced: boolean },
  rows: readonly ReadOnlyExemption[] = READ_ONLY_EXEMPTIONS,
): boolean {
  return rows.some(
    (row) =>
      row.method === request.method &&
      pathMatches(row.path, request.path) &&
      row.boxes.some((kind) => box[kind]),
  );
}
