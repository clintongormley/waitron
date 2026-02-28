import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DATABASE_TOKEN } from "../../database/database.provider";
import { type Database, searchIndex } from "@waitron/db";
import type { SearchProvider, SearchDocument, SearchResult } from "./search-provider.interface";

@Injectable()
export class PostgresSearchProvider implements SearchProvider {
  constructor(@Inject(DATABASE_TOKEN) private db: Database) {}

  async indexDocument(doc: SearchDocument): Promise<void> {
    const metadataStr = JSON.stringify(doc.metadata ?? {});

    // Upsert: replace existing document for the same entityId + entityType
    await this.db
      .insert(searchIndex)
      .values({
        tenantId: doc.tenantId,
        entityType: doc.entityType,
        entityId: doc.entityId,
        // to_tsvector converts plain text to weighted tsvector
        content: sql`to_tsvector('english', ${doc.text})`,
        metadata: metadataStr,
      })
      .onConflictDoUpdate({
        target: [searchIndex.entityId, searchIndex.entityType],
        set: {
          tenantId: doc.tenantId,
          content: sql`to_tsvector('english', ${doc.text})`,
          metadata: metadataStr,
          updatedAt: new Date(),
        },
      });
  }

  async search(
    tenantId: string,
    query: string,
    entityType?: string,
  ): Promise<SearchResult[]> {
    const tsQuery = sql`plainto_tsquery('english', ${query})`;

    const conditions = [
      eq(searchIndex.tenantId, tenantId),
      sql`${searchIndex.content} @@ ${tsQuery}`,
    ];
    if (entityType) {
      conditions.push(eq(searchIndex.entityType, entityType));
    }

    const rows = await this.db
      .select({
        entityType: searchIndex.entityType,
        entityId: searchIndex.entityId,
        metadata: searchIndex.metadata,
        rank: sql<number>`ts_rank(${searchIndex.content}, ${tsQuery})`,
      })
      .from(searchIndex)
      .where(and(...conditions))
      .orderBy(sql`ts_rank(${searchIndex.content}, ${tsQuery}) desc`)
      .limit(50);

    return rows.map((r) => ({
      entityType: r.entityType,
      entityId: r.entityId,
      metadata: r.metadata ? JSON.parse(r.metadata) : {},
      rank: r.rank,
    }));
  }

  async deleteDocument(entityId: string, entityType: string): Promise<void> {
    await this.db
      .delete(searchIndex)
      .where(
        and(
          eq(searchIndex.entityId, entityId),
          eq(searchIndex.entityType, entityType),
        ),
      );
  }
}
