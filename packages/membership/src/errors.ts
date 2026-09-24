import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    // Signing with our own malformed key; verification fails closed instead of throwing.
    "membership.key_invalid": { operation: "sign" };
  }
}
