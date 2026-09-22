/** A product that reads as a given unit, as `unit.in_use` reports it. Declared here, apart from
 * `units.ts`, so a browser consumer can name the type without its program gaining that file's
 * database imports. */
export interface ProductUsingUnit {
  id: string;
  name: string;
  available: boolean;
}
