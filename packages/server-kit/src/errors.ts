// A bare side-effect import, not a value used here: it makes TypeScript treat "@waitron/shared" as a
// real module to augment rather than a fresh ambient module of the same name — the idiom
// packages/fiscal-verifactu/src/errors.ts and packages/db/src/errors.ts use for their own codes.
import "@waitron/shared";

/**
 * @waitron/server-kit's contribution to the shared error registry, added by declaration merging (the
 * design note atop packages/shared/src/errors.ts). Reachable from this package's barrel via
 * `import "./errors.js"` in index.ts, per the reachability rule that guard (scripts/errors-reachable.test.ts)
 * enforces.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /**
     * A request-shape screen (`request-screens.ts`) refused a malformed body/query field — a date,
     * enum, nullable, or plain body uuid — naming the FIELD, never its value (a PIN or password is
     * exactly the kind of secret a caller can mis-send). `management.*` names the DOMAIN CONCEPT (a
     * request to the management surface), not the throwing package; it is a deliberately distinct
     * namespace from `@waitron/identity`'s `management_session.*` (the session LIFECYCLE), which names
     * a separate concern. Codes are never renamed once shipped.
     */
    "management.request_invalid": { field: string };

    /**
     * The management cookie's SHAPE check (`management-cookie.ts`'s `requireManagementSession`) found
     * no cookie or a non-UUID one. Co-declared here — identical params to `@waitron/identity`'s own
     * declaration — because this package now ALSO throws it: the cookie shape-screen and identity's
     * live-session lookup (`resolveManagementSession`) are two throwers of the one code, and TypeScript
     * accepts both identical declarations when `apps/server` compiles them together. This is the same
     * two-thrower pattern `packages/fiscal-verifactu/src/errors.ts` documents for `server.credential_unusable`.
     */
    "management_session.required": Record<string, never>;
  }
}
