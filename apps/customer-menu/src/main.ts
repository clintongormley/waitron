import {
  contentLanguageDisplayName,
  guestMenuWords,
  type CustomerMenuAppearance,
  type CustomerMenuPhotoSize,
  type PublicGuestMenu,
} from "@waitron/shared";
import { resolveMenuAppearance } from "./customer-menu-appearance.js";
import "./customer-menu-page.js";

interface CustomerMenuSnapshot {
  address: string;
  defaultLanguage: string;
  photos: CustomerMenuPhotoSize;
  menu: PublicGuestMenu;
  photoUrls: Record<string, string>;
  appearance?: CustomerMenuAppearance;
}

export function mountCustomerMenu(doc: Document): void {
  const data = doc.getElementById("customer-menu-data")?.textContent;
  const main = doc.getElementById("customer-menu");
  if (!data || !main) return;
  const { address, defaultLanguage, photos, menu, photoUrls, appearance } = JSON.parse(
    data,
  ) as CustomerMenuSnapshot;
  doc.documentElement.lang = menu.language;
  doc.title = menu.name;
  doc.documentElement.style.colorScheme = resolveMenuAppearance(appearance).scheme;

  const page = doc.createElement("customer-menu-page");
  page.standalone = true;
  page.menu = menu;
  page.defaultLanguage = defaultLanguage;
  page.photos = photos;
  page.appearance = appearance;
  page.photoSource = (reference) => photoUrls[reference];

  if (menu.languages.length > 1) {
    const words = guestMenuWords(menu.language, defaultLanguage);
    const chooser = doc.createElement("nav");
    chooser.lang = words.language;
    chooser.setAttribute("aria-label", words.text.languages!);
    for (const language of menu.languages) {
      const link = doc.createElement("a");
      link.href = `/${encodeURIComponent(address)}/${encodeURIComponent(language)}`;
      link.hreflang = link.lang = language;
      link.textContent = contentLanguageDisplayName(language, language);
      if (language === menu.language) link.setAttribute("aria-current", "page");
      chooser.append(link);
    }
    const languages = doc.createElement("details");
    languages.slot = "header-actions";
    languages.className = "menu-languages";
    const summary = doc.createElement("summary");
    summary.lang = words.language;
    const label = menu.language.toUpperCase();
    summary.setAttribute("aria-label", `${words.text.languages!} · ${label}`);
    summary.textContent = label;
    languages.append(summary, chooser);
    page.append(languages);
  }
  main.replaceChildren(page);
}

mountCustomerMenu(document);
