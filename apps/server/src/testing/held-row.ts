/**
 * The lines a held-order save sends for one basket row of `quantity` dishes whose stored dish lines
 * are `memberIds`, in line order, as plan D8 has the till send a row: a row stored as one line is sent
 * at the count; a row of portions sends its first members at "1", the last one sent rising by the
 * rest when the count passes the members, and leaves out the members past the count, which the save
 * removes.
 */
export function heldRow<L extends object>(
  memberIds: string[],
  quantity: string,
  line: L,
): (L & { workingOrderLineId: string; quantity: string })[] {
  if (memberIds.length === 1) return [{ ...line, workingOrderLineId: memberIds[0]!, quantity }];
  const count = Number(quantity);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(
      `heldRow: a row of portions takes a whole count of at least 1, not ${quantity}`,
    );
  }
  const sent = memberIds.slice(0, Math.min(memberIds.length, count));
  return sent.map((workingOrderLineId, i) => ({
    ...line,
    workingOrderLineId,
    quantity:
      i === sent.length - 1 && count > memberIds.length
        ? String(count - memberIds.length + 1)
        : "1",
  }));
}
