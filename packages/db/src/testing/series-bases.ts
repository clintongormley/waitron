/** A box's whole series set, in the order tests index it by: standard, full, corrective. */
export const SERIES_BASES: readonly { readonly code: string; readonly purpose: string }[] =
  Object.freeze(
    [
      { code: "A", purpose: "standard" },
      { code: "FF", purpose: "full" },
      { code: "R", purpose: "corrective" },
    ].map((base) => Object.freeze(base)),
  );
