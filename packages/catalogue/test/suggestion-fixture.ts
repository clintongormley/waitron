import { randomUUID } from "node:crypto";
import { asc } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction, type Database, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "../src/migrations.js";
import { createCatalogue, createProduct } from "../src/operations.js";
import { writeContentLanguages } from "../src/content-languages.js";
import {
  readActiveSuggestionJob,
  recordSuggestionJobSubmitted,
  startSuggestionRun,
} from "../src/content-suggestion-jobs.js";
import type { TranslationContext } from "../src/content-translation-targets.js";
import { contentSuggestionJobs, type SuggestionJobRow } from "../src/schema/suggestions.js";

export const context: TranslationContext = { fallbackLanguage: "ca", required: [] };

export function suggestionSuite() {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
  const app = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);
  return { suite, app };
}

export const ref = (productId: string): string => `product:${productId}`;

export async function addProduct(
  tx: Transaction,
  menuId: string,
  label: string,
  customerName: Record<string, string> | null,
): Promise<string> {
  const product = await createProduct(tx, {
    catalogueId: menuId,
    categoryId: null,
    unitId: null,
    name: `STAFF ${label}`,
    kitchenName: `KITCHEN ${label}`,
    customerName,
    unitPrice: "3.00",
    vatClass: "reduced",
  });
  return product.id;
}

export interface SuggestionVenue {
  menuId: string;
  /** Named in ca only: missing es and en. */
  bread: string;
  /** No customer-facing name at all: missing ca, es and en. */
  wine: string;
  /** Named in ca and es: missing en. */
  cheese: string;
  /** Named in every language: never sent. */
  water: string;
}

/** A venue in ca (the default), es and en, whose menu is named in all three. */
export async function seedSuggestionVenue(db: Database): Promise<SuggestionVenue> {
  await seedTenant(db);
  return withTransaction(db, async (tx) => {
    await writeContentLanguages(tx, { defaultLanguage: "ca", languages: ["ca", "es", "en"] });
    const menu = await createCatalogue(tx, {
      name: "STAFF Carta",
      names: { ca: "CLIENT-CA Carta", es: "CLIENT-ES Carta", en: "CLIENT-EN Menu" },
    });
    const bread = await addProduct(tx, menu.id, "Bread", { ca: "CLIENT-CA Pa" });
    const wine = await addProduct(tx, menu.id, "Wine", null);
    const cheese = await addProduct(tx, menu.id, "Cheese", {
      ca: "CLIENT-CA Formatge",
      es: "CLIENT-ES Queso",
    });
    const water = await addProduct(tx, menu.id, "Water", {
      ca: "CLIENT-CA Aigua",
      es: "CLIENT-ES Agua",
      en: "CLIENT-EN Water",
    });
    return { menuId: menu.id, bread, wine, cheese, water };
  });
}

export async function allJobs(tx: Transaction): Promise<SuggestionJobRow[]> {
  return await tx.select().from(contentSuggestionJobs).orderBy(asc(contentSuggestionJobs.position));
}

export function sortedSent(sent: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(sent).map(([key, languages]) => [key, [...languages].sort()]),
  );
}

export async function startedJob(db: Database, now?: Date): Promise<SuggestionJobRow> {
  return withTransaction(db, async (tx) => {
    await startSuggestionRun(tx, context, now);
    return (await readActiveSuggestionJob(tx))!;
  });
}

export async function submitJob(db: Database, job: SuggestionJobRow): Promise<SuggestionJobRow> {
  return withTransaction(db, async (tx) => {
    await recordSuggestionJobSubmitted(tx, job.id, {
      jobId: randomUUID(),
      total: Object.keys(job.sent).length,
    });
    return (await allJobs(tx)).find((row) => row.id === job.id)!;
  });
}

export async function runningJob(db: Database, now?: Date): Promise<SuggestionJobRow> {
  return submitJob(db, await startedJob(db, now));
}
