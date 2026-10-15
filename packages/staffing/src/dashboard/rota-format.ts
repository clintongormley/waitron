import type { RotaWeek } from "../staffing-types.js";
import { tf } from "./strings.js";
export const wallTime = (instant: string, offset: number): string =>
  new Date(Date.parse(instant) + offset * 60000).toISOString().slice(11, 16);
export const shiftTime = (s: RotaWeek["shifts"][number]): string =>
  `${wallTime(s.startsAt, s.startsOffsetMinutes)}–${wallTime(s.endsAt, s.endsOffsetMinutes)}`;
export function minuteTime(minute: number, cutover: string): string {
  const n = (minute + Number(cutover.slice(0, 2)) * 60 + Number(cutover.slice(3))) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
export function hours(person: RotaWeek["people"][number]): string {
  return tf(
    person.contractedMinutes === null ? "staffing.rota.hours_no_contract" : "staffing.rota.hours",
    {
      planned: String(person.plannedMinutes / 60),
      contract: String((person.contractedMinutes ?? 0) / 60),
    },
  );
}
