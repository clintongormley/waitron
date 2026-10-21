import { TradingAdmission } from "../trading-admission.js";

export function testTradingAdmission(): TradingAdmission {
  const admission = new TradingAdmission();
  admission.admit();
  return admission;
}
