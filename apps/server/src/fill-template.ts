/** `template` with each `{slot}` named in `values` filled in, in one pass: a value holding a
 * slot's spelling, or a `$&`, is printed as given. A slot `values` does not name is left. */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, slot: string) =>
    Object.hasOwn(values, slot) ? values[slot]! : whole,
  );
}
