// Makes TypeScript augment the real "@waitron/shared" rather than declare a fresh ambient module.
import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    /**
     * Co-declared, with identical params, with `@waitron/identity`, which also throws it; identical
     * declarations merge.
     */
    "management_session.required": Record<string, never>;
  }
}
