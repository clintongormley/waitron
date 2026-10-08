// A bare side-effect import: it makes TypeScript augment "@waitron/shared" rather than declare a
// fresh ambient module.
import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    "ingredient.not_found": { ingredientId: string };
  }
}
