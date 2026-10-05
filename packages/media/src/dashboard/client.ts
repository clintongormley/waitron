import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";

export interface ImageMetadata {
  names: Record<string, string>;
}
export interface LibraryImage extends ImageMetadata {
  id: string;
  filename: string;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
}
export type ImageUsage =
  | { kind: "section"; id: string; internalName: string; ownerMenuId: string }
  | { kind: "product"; id: string; catalogueId: string; name: string; active: boolean }
  | {
      kind: "variant";
      id: string;
      productId: string;
      catalogueId: string;
      name: string;
      active: boolean;
    }
  | { kind: "menu_version"; id: string; menuId: string; menuName: string; number: number }
  | { kind: "receipt" };
export interface ImageQuery {
  search: string;
  language: string;
  sort: "relevance" | "date" | "name";
  direction?: "asc" | "desc";
  offset: number;
  limit: number;
}
export class ImageApi {
  constructor(
    private readonly request: DashboardRequest,
    readonly liveData?: LiveData,
    private readonly passive = false,
  ) {}
  get background(): ImageApi {
    return new ImageApi(this.request, this.liveData, true);
  }
  listImages(query: ImageQuery): Promise<{ images: LibraryImage[]; total: number }> {
    const params = new URLSearchParams(
      Object.entries(query).map(([key, value]) => [key, String(value)]),
    );
    return this.request(`/management-api/images?${params}`, "GET", undefined, {
      passive: this.passive,
    });
  }
  getImage(id: string): Promise<{ image: LibraryImage; uses: ImageUsage[] }> {
    return this.request(`/management-api/images/${encodeURIComponent(id)}`, "GET", undefined, {
      passive: this.passive,
    });
  }
  uploadImage(
    file: File,
    metadata: ImageMetadata,
  ): Promise<{ image: LibraryImage; created: boolean }> {
    const form = new FormData();
    form.set("file", file);
    form.set("names", JSON.stringify(metadata.names));
    return this.request("/management-api/images", "POST", form);
  }
  updateImage(id: string, metadata: ImageMetadata): Promise<{ image: LibraryImage }> {
    return this.request(`/management-api/images/${encodeURIComponent(id)}`, "PATCH", metadata);
  }
  deleteImage(id: string): Promise<{ deleted: boolean; uses: ImageUsage[] }> {
    return this.request(`/management-api/images/${encodeURIComponent(id)}`, "DELETE");
  }
}
