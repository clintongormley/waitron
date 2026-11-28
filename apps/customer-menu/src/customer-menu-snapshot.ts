import type { CustomerMenuPhotoSize, PublicGuestMenu } from "@waitron/shared";

export interface PreparedMenuAppearance {
  scheme: "light" | "dark";
  tokens: Readonly<Record<string, string>>;
}

export interface CustomerMenuSnapshot {
  address: string;
  defaultLanguage: string;
  photos: CustomerMenuPhotoSize;
  menu: PublicGuestMenu;
  photoUrls: Record<string, string>;
  appearance?: PreparedMenuAppearance;
}
