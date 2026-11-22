import type { Database } from "@waitron/db";
import {
  readPaymentsSettings,
  SimulatorPaymentProvider,
  type PaymentProvider,
} from "@waitron/payments";
import type { OnboardingIntent } from "./trading-config.js";

function usesSimulator(intent: OnboardingIntent | undefined, testProviders: boolean) {
  return intent === "demo" || (intent === "prepare" && !testProviders);
}

export async function buildCardProvider(
  db: Database,
  intent?: OnboardingIntent,
  testProviders = false,
  paymentsEnabled = true,
): Promise<PaymentProvider | undefined> {
  return paymentsEnabled && usesSimulator(intent, testProviders)
    ? new SimulatorPaymentProvider(db)
    : undefined;
}

export interface CardSimulatorSeat {
  readonly forExistingPayments: PaymentProvider | undefined;
  current(): PaymentProvider | undefined;
  reapply(): Promise<void>;
}

export async function createCardSimulatorSeat(input: {
  db: Database;
  onboardingIntent: OnboardingIntent | undefined;
  paymentsEnabled: boolean;
}): Promise<CardSimulatorSeat> {
  const { db, onboardingIntent, paymentsEnabled } = input;
  // Refund retries must see the simulator's existing outcomes after a switch.
  const simulator = await buildCardProvider(db, onboardingIntent, false, paymentsEnabled);
  let active = false;
  const reapply = async () => {
    const { doc } = await readPaymentsSettings(db);
    active = usesSimulator(onboardingIntent, doc.testProviders);
  };
  await reapply();
  return {
    forExistingPayments: simulator,
    current: () => (active ? simulator : undefined),
    reapply,
  };
}
