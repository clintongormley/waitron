/** A filed dish row: the dishes it stands for, and one row per extra of its first dish, each
 * listing the extra it stands for in every dish, in the dishes' order. */
export interface FiledDishRow<D, E> {
  dishes: D[];
  extras: E[][];
}

export interface FiledRowParts<D, E> {
  extrasOf: (dish: D) => readonly E[];
  /** What a bound dish files under besides its quantity; null when it is not bound and files alone. */
  dishKey: (dish: D) => string | null;
  /** What an extra files under, its quantity per dish included. */
  extraKey: (extra: E) => string;
}

/**
 * The one rule for which bound dishes file as one row (decision D7), shared by the invoice and the
 * discount calculator: bound dishes join while their keys match and they take the same extras per
 * dish. A row sits at its first dish's position; an extra of the first dish files as one row with
 * the first unclaimed matching extra of each other dish.
 */
export function groupFiledRows<D, E>(
  dishes: readonly D[],
  parts: FiledRowParts<D, E>,
): FiledDishRow<D, E>[] {
  const extraKeys = new Map<E, string>();
  const extraKey = (extra: E) => {
    let key = extraKeys.get(extra);
    if (key === undefined) {
      key = parts.extraKey(extra);
      extraKeys.set(extra, key);
    }
    return key;
  };

  const rows: D[][] = [];
  const bound = new Map<string, D[]>();
  for (const dish of dishes) {
    const dishKey = parts.dishKey(dish);
    const key =
      dishKey === null
        ? null
        : JSON.stringify([dishKey, parts.extrasOf(dish).map(extraKey).sort()]);
    const row = key === null ? undefined : bound.get(key);
    if (row !== undefined) {
      row.push(dish);
      continue;
    }
    const created = [dish];
    rows.push(created);
    if (key !== null) bound.set(key, created);
  }

  return rows.map((members) => {
    const [first, ...others] = members as [D, ...D[]];
    const unclaimed = others.map((other) => [...parts.extrasOf(other)]);
    const extras = parts.extrasOf(first).map((extra) => {
      const key = extraKey(extra);
      return [
        extra,
        ...unclaimed.map(
          (left) =>
            left.splice(
              left.findIndex((candidate) => extraKey(candidate) === key),
              1,
            )[0]!,
        ),
      ];
    });
    return { dishes: members, extras };
  });
}
