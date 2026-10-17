import { capitaliseFirst } from "@waitron/shared";

export function imageNameFromFilename(
  filename: string,
  locale: string,
  fallbackName: string,
): string {
  const stem = filename
    .replace(/\.[^.]*$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return capitaliseFirst(stem || filename.trim() || fallbackName, locale);
}
