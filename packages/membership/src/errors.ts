// Registers the membership.* error codes on the shared registry (reachability convention —
// packages/shared/src/errors.ts; guarded tree-wide by scripts/errors-reachable.test.ts).
import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    // Thrown only when signing with malformed private-key material — our own key, a programmer
    // error, never adversarial input. Verification never throws (it fails closed on wire data).
    "membership.key_invalid": { operation: "sign" };
  }
}
