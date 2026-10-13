import { assertRehearsalOptIn } from "./aws-rehearsal.js";

export default function awsRehearsalGlobalSetup(): void {
  assertRehearsalOptIn(process.env);
}
