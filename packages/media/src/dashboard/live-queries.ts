export const QUERY_DEPENDENCIES = {
  images: [
    "media_images",
    "products",
    "category_details",
    "categories",
    "sections",
    "content_languages",
    "menu_publications",
    "menu_versions",
    "menu_version_images",
    "catalogues",
  ],
  labels: ["media_images"],
} as const;
