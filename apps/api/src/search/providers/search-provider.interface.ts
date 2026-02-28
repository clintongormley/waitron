export interface SearchDocument {
  entityType: string;
  entityId: string;
  tenantId: string;
  text: string; // plain text to be indexed
  metadata?: Record<string, unknown>; // display fields returned in results
}

export interface SearchResult {
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  rank: number;
}

export interface SearchProvider {
  indexDocument(doc: SearchDocument): Promise<void>;
  search(tenantId: string, query: string, entityType?: string): Promise<SearchResult[]>;
  deleteDocument(entityId: string, entityType: string): Promise<void>;
}
