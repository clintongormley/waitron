import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { tillProviderForReader, type TillReaderProvider } from "@waitron/shared";
import { locations, readTenant, type Transaction } from "@waitron/db";
import { getDeviceProfile } from "@waitron/layouts";
import type { CapabilityFlag, NavigationScreen } from "@waitron/layouts";
import { cardReaders, DEMO_READER_ID, resolveDeviceReaderId } from "@waitron/payments";
import type { DeviceBinding } from "./device-session.js";
import { listCourses } from "./kitchen.js";
import type { TillApiDeps } from "./till-api.js";
import { readOfferedReceiptLanguages } from "./venue-locale.js";

/** The subset of `apps/till`'s `CardProvider` union this surface hands out. */
type TillCardProvider = TillReaderProvider | "simulator" | "none";

/** The till's start-read body, every field except `servers`. */
export async function readTillSetup(
  tx: Transaction,
  deps: Pick<
    TillApiDeps,
    "cfg" | "venueLocale" | "workforceEnabled" | "onboardingIntent" | "cardProvider"
  >,
  device: DeviceBinding | null,
) {
  const taxpayer = await readTenant(tx);
  const [loc] = await tx
    .select({
      bumpMode: locations.bumpMode,
      fireControl: locations.fireControl,
    })
    .from(locations)
    .where(eq(locations.id, deps.cfg.locationId));
  const courses = (await listCourses(tx, deps.cfg)).map((course) => ({
    id: course.id,
    name: course.name,
    displayOrder: course.displayOrder,
  }));
  let capabilities: CapabilityFlag[] = [];
  let inactivityTimeoutSeconds: number | null = null;
  let startingScreen: NavigationScreen | null = null;
  if (device != null) {
    const profile = await getDeviceProfile(tx, device.deviceProfileId);
    capabilities = device.capabilities;
    inactivityTimeoutSeconds = profile?.inactivityTimeoutSeconds ?? null;
    startingScreen = profile?.startingScreen ?? null;
  }
  let defaultReaderProvider: TillReaderProvider | undefined;
  let defaultReaderId: string | undefined;
  const activeReaders: {
    id: string;
    name: string;
    provider: TillReaderProvider;
  }[] = [];
  const resolvedReaderId = device == null ? null : await resolveDeviceReaderId(tx, device.deviceId);
  if (resolvedReaderId !== null) {
    const [reader] = await tx
      .select({ id: cardReaders.id, name: cardReaders.name, provider: cardReaders.provider })
      .from(cardReaders)
      .where(and(eq(cardReaders.id, resolvedReaderId), eq(cardReaders.active, true)));
    const provider = reader === undefined ? undefined : tillProviderForReader(reader.provider);
    if (reader !== undefined && provider !== undefined) {
      defaultReaderProvider = provider;
      defaultReaderId = reader.id;
      activeReaders.push({ id: reader.id, name: reader.name, provider });
    }
  }
  const receiptLanguages = await readOfferedReceiptLanguages(tx, {
    locationId: deps.cfg.locationId,
  });
  /* v8 ignore start */
  if (taxpayer === null || loc === undefined) {
    // Unreachable once provisioned: the taxpayer row and the till's own location both exist.
    throw new Error(`readTillSetup: no taxpayer/location row for ${deps.cfg.locationId}`);
  }
  /* v8 ignore stop */
  const simulator = deps.cardProvider?.provider === "simulator";
  return {
    locale: deps.venueLocale,
    clockingAvailable: deps.workforceEnabled === true,
    // The location's receipt language, kept separate from the UI `locale`: the UI derivation
    // drops UI-unsupported codes, which must never reach the receipt.
    invoiceLocale: receiptLanguages[0],
    receiptLanguages,
    onboardingIntent: deps.onboardingIntent,
    venueName: taxpayer.legalName,
    nif: taxpayer.taxId,
    bumpMode: loc.bumpMode,
    fireControl: loc.fireControl,
    courses,
    cardProvider: (simulator
      ? "simulator"
      : (defaultReaderProvider ?? "none")) satisfies TillCardProvider,
    // A venue can have several active readers on one provider, so the till needs the row id.
    defaultReaderId: simulator ? undefined : defaultReaderId,
    activeReaders: simulator
      ? [{ id: DEMO_READER_ID, name: "Demo card reader", provider: "simulator" as const }]
      : activeReaders,
    tipsEnabled: deps.cfg.tipsEnabled,
    formFactor: device?.formFactor ?? "till",
    capabilities,
    inactivityTimeoutSeconds,
    ...(startingScreen === null ? {} : { startingScreen }),
    nodeId: deps.cfg.nodeId,
    // So the basket refuses an order over it as it is entered, not at the pay step.
    simplifiedInvoiceLimit: deps.cfg.simplifiedInvoiceLimit,
    // An F1 request is refused by refuseUnavailableInvoiceRequest (./till-sale.ts) and an order
    // saved as F1 by refuseUnavailableFullInvoice (./working-order.ts); keep in step.
    fullInvoices: false as const,
  };
}

export type TillSetup = Awaited<ReturnType<typeof readTillSetup>>;

/** Moves whenever any field of the setup does; `JSON.stringify` keeps the fixed key order above. */
export function setupRevisionOf(setup: TillSetup): string {
  return createHash("sha256").update(JSON.stringify(setup)).digest("hex");
}
