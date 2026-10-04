/** Declared apart from `units.ts` so a browser consumer can name these without that file's
 * database imports. */
export interface ProductUsingUnit {
  id: string;
  name: string;
  active: boolean;
}

/** The id a product with NO stored unit reads as: Each. */
export const EACH_UNIT_ID = "00000000-0000-0000-0000-000000000001";
