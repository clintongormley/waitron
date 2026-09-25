export const QUERY_DEPENDENCIES = {
  images: [
    "media_images",
    "products",
    "category_details",
    "categories",
    "sections",
    "content_languages",
  ],
  labels: ["media_images"],
} as const;
