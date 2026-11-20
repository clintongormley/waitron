/** An invoice line of the meal, in cents and basis points as its row stores them. */
export interface MealLineCents {
  id: string;
  rate: number;
  base: number;
  gross: number;
}

/** A line that takes an advance off the invoice, its base and gross stored below zero. */
export interface DeductionCents {
  rate: number;
  base: number;
  gross: number;
}

export interface TakenCents {
  saleLineId: string;
  rate: number;
  base: number;
  gross: number;
}

/**
 * What an invoice's deduction lines take from its meal, read as corrections already taken. At
 * each rate it is never more than the meal holds there, and its tax never more than the meal's
 * tax there; it is spread over that rate's meal lines from the last back. `meal` is in line order.
 * Shared by the calculator's history and the correction writer's check, which must agree.
 */
export function deductionsTaken(
  meal: readonly MealLineCents[],
  deductions: readonly DeductionCents[],
): TakenCents[] {
  const taken: TakenCents[] = [];
  for (const rate of new Set(deductions.map((deduction) => deduction.rate))) {
    const lines = meal.filter((line) => line.rate === rate);
    const mealGross = sum(lines.map((line) => line.gross));
    const mealBase = sum(lines.map((line) => line.base));
    const atRate = deductions.filter((deduction) => deduction.rate === rate);
    const gross = -sum(atRate.map((deduction) => deduction.gross));
    const base = -sum(atRate.map((deduction) => deduction.base));
    if (gross <= 0) continue;
    const whole = gross >= mealGross;
    const takeGross = whole ? mealGross : gross;
    const takeBase = whole
      ? mealBase
      : Math.min(
          Math.max(base, takeGross - (mealGross - mealBase), 0),
          Math.min(mealBase, takeGross),
        );
    let grossLeft = takeGross;
    let baseLeft = takeBase;
    for (const line of [...lines].reverse()) {
      if (grossLeft <= 0) break;
      const pieceGross = Math.min(line.gross, grossLeft);
      if (pieceGross <= 0) continue;
      const pieceBase = Math.min(pieceGross, baseLeft);
      taken.push({ saleLineId: line.id, rate, base: pieceBase, gross: pieceGross });
      grossLeft -= pieceGross;
      baseLeft -= pieceBase;
    }
  }
  return taken;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
