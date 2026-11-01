import { render } from "lit";
import {
  createRequest,
  registerCatalogue,
  setLocale,
  type DashboardContribution,
  type FetchLike,
} from "@waitron/dashboard-kit";

export function mountPublicModulePage(
  app: HTMLElement,
  pathname: string,
  modules: readonly DashboardContribution[],
  options: { locale: "en" | "es"; fetchImpl?: FetchLike },
): boolean {
  const pages = modules.flatMap((module) =>
    (module.publicPages ?? []).map((page) => ({ module, page })),
  );
  const paths = new Set<string>();
  for (const { page } of pages) {
    if (paths.has(page.path)) throw new Error(`Duplicate public module path: ${page.path}`);
    paths.add(page.path);
  }
  const match = pages.find(({ page }) => page.path === pathname);
  if (match === undefined) return false;
  registerCatalogue(match.module.strings);
  setLocale(options.locale);
  document.documentElement.lang = options.locale;
  const request = createRequest({ fetchImpl: options.fetchImpl });
  render(match.page.create({ request, locale: options.locale }).render(), app);
  return true;
}
