import { type Transaction, deviceProfiles } from "@waitron/db";
import { profileAllows } from "@waitron/layouts";
import { isNull } from "drizzle-orm";

export async function readerProfileChoices(tx: Transaction) {
  const profiles = await tx
    .select({
      id: deviceProfiles.id,
      name: deviceProfiles.name,
      formFactor: deviceProfiles.formFactor,
      capabilities: deviceProfiles.capabilities,
    })
    .from(deviceProfiles)
    .where(isNull(deviceProfiles.retiredAt))
    .orderBy(deviceProfiles.name, deviceProfiles.id);
  return profiles.map(({ id, name, formFactor, capabilities }) => ({
    id,
    name,
    eligible: profileAllows(
      { formFactor, capabilities: capabilities as string[] },
      "integrated-card-payment",
    ),
  }));
}
