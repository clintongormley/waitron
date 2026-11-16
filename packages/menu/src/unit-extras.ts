export interface ExtrasUnit {
  hardwareUnit: string | null;
  precision: number;
  measure?: boolean;
}

export function takesExtras(unit: ExtrasUnit): boolean {
  return unit.hardwareUnit === null && unit.precision === 0 && unit.measure !== true;
}
