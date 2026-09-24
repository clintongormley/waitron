/** Declared apart from `units.ts` so a browser consumer can name the type without that file's
 * database imports. */
export interface ProductUsingUnit {
  id: string;
  name: string;
  available: boolean;
}
