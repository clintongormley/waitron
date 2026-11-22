import { jsonFile, type ModulePersonalData } from "@waitron/module";
import { asc, eq } from "drizzle-orm";
import { bookings } from "./schema/bookings.js";

const FILE = "bookings-created.json";

export const BOOKINGS_PERSONAL_DATA: ModulePersonalData = {
  files: [FILE],

  async prepare(tx, { personId }) {
    const entries = await tx
      .select({ bookingId: bookings.id, at: bookings.createdAt })
      .from(bookings)
      .where(eq(bookings.createdBy, personId))
      .orderBy(asc(bookings.createdAt), asc(bookings.id));
    return async () => (entries.length === 0 ? [] : [jsonFile(FILE, { entries })]);
  },
};
