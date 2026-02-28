import { createDb, type Database } from "@waitron/db";

export const DATABASE_TOKEN = "DATABASE";

export const databaseProvider = {
  provide: DATABASE_TOKEN,
  useFactory: (): Database => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    return createDb(url);
  },
};
