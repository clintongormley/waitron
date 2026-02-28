import { Injectable } from "@nestjs/common";
import { PostgresSearchProvider } from "./providers/postgres-search.provider";
import type { SearchDocument } from "./providers/search-provider.interface";

@Injectable()
export class SearchService {
  constructor(private provider: PostgresSearchProvider) {}

  index(doc: SearchDocument) {
    return this.provider.indexDocument(doc);
  }

  search(tenantId: string, query: string, type?: string) {
    return this.provider.search(tenantId, query, type);
  }

  delete(entityId: string, entityType: string) {
    return this.provider.deleteDocument(entityId, entityType);
  }
}
