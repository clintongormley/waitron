// Details that name a person, masked in every line the server's logger writes; scripts/personal-log-params.test.ts guards the list.
export const PERSONAL_LOG_KEYS: ReadonlySet<string> = new Set([
  "email",
  "displayName",
  "ownerName",
  "editorName",
  "holderPersonName",
  "person",
  "supplierTaxId",
  "legalName",
  "taxId",
  "idEmisorFactura",
  "todayName",
]);

export const PERSONAL_LOG_PATHS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["merchants", new Set(["name"])],
]);

const MASK = "***";

export function maskPersonalData(key: string, value: unknown): unknown {
  if (PERSONAL_LOG_KEYS.has(key)) return value === null || value === undefined ? value : MASK;
  const children = PERSONAL_LOG_PATHS.get(key);
  if (children === undefined || !Array.isArray(value)) return value;
  return value.map((element: unknown) => {
    if (typeof element !== "object" || element === null || Array.isArray(element)) return element;
    const copy: Record<string, unknown> = { ...(element as Record<string, unknown>) };
    for (const child of children) {
      if (copy[child] !== null && copy[child] !== undefined) copy[child] = MASK;
    }
    return copy;
  });
}
