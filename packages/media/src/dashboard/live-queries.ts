export const QUERY_DEPENDENCIES = {
  images: [
    "media_images",
    "products",
    "category_details",
    "categories",
    "sections",
    "content_languages",
    "menu_publications",
    "menu_version_images",
  ],
  labels: ["media_images"],
} as const;
