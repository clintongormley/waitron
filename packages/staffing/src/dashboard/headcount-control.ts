import type { WtNumberStepper } from "@waitron/ui/src/components/wt-number-stepper.js";

export function showHeadcount(control: WtNumberStepper, headcount: number): void {
  const value = String(headcount);
  control.value = value;
  // A correction can equal the last rendered value while the native input holds different text.
  control.shadowRoot!.querySelector("input")!.value = value;
}
