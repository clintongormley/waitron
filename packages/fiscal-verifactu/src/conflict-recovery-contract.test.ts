import { expect, it } from "vitest";
import { parseConflictActivation } from "./conflict-recovery-contract.js";

const result = {
  activationEventId: "event-1",
  sifId: "sif-2",
  series: [{ id: "series-2", code: "A-0CNQR", purpose: "standard" }],
};
it("reads the complete committed activation without adding or losing facts", () => {
  expect(parseConflictActivation(result)).toEqual(result);
});
it.each([
  null,
  [],
  {},
  { ...result, unexpected: "do not disclose" },
  { ...result, sifId: undefined },
  { ...result, activationEventId: 12 },
  { ...result, series: null },
  { ...result, series: [{ ...result.series[0], unexpected: true }] },
  { ...result, series: [{ code: "A-0CNQR", purpose: "standard" }] },
  { ...result, series: [{ ...result.series[0], code: "" }] },
])("refuses missing, malformed or additional committed-result fields %j", (value) => {
  expect(parseConflictActivation(value)).toBeNull();
});
