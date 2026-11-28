import { prepareMenuAppearance } from "@waitron/customer-menu/appearance";
import type { CustomerMenuSnapshot } from "@waitron/customer-menu/snapshot";
import { menus, statementChunks, subscribeToChanges, type Database } from "@waitron/db";
import {
  mediaImages,
  parseRendition,
  readImageBytes,
  readPresentations,
  renderRendition,
  RenditionCache,
} from "@waitron/media";
import {
  customerMenuAppearanceFor,
  EACH_UNIT_ID,
  readContentLanguages,
  readLiveDocuments,
} from "@waitron/menu";
import { publicGuestMenu, settingsChangeType, type GuestMember } from "@waitron/shared";
import { and, eq, isNotNull } from "drizzle-orm";
import { SERVER_THEME_DEFAULTS } from "./theme-defaults.js";

export const CUSTOMER_PHOTOS = "/_customer-menu/photos/";
type Photo = NonNullable<ReturnType<typeof parseRendition>>;

function collectPhotoReferences(members: GuestMember[], references: Set<string>): void {
  for (const member of members) {
    if (member.kind === "section") collectPhotoReferences(member.members, references);
    if (member.kind === "product" && member.image !== null) references.add(member.image);
  }
}

async function buildView(db: Database, venueLocale: string) {
  const online = await db
    .select({ id: menus.id, address: menus.onlineAddress, photos: menus.onlinePhotos })
    .from(menus)
    .where(
      and(
        eq(menus.active, true),
        eq(menus.kind, "menu"),
        eq(menus.onlineEnabled, true),
        isNotNull(menus.onlineAddress),
      ),
    )
    .orderBy(menus.onlineAddress);
  const snapshots = new Map<string, Map<string, CustomerMenuSnapshot>>();
  const photos = new Map<string, Photo>();
  if (online.length === 0) return { menus: snapshots, photos };
  const languages = await readContentLanguages(db, venueLocale);
  const live = await readLiveDocuments(
    db,
    online.map(({ id }) => id),
  );
  for (const { id, address, photos: size } of online) {
    const edition = live.get(id);
    if (!edition || address === null) continue;
    const appearance = prepareMenuAppearance(
      SERVER_THEME_DEFAULTS,
      await customerMenuAppearanceFor(db, id),
    );
    const localized = languages.languages.map((language) =>
      publicGuestMenu(edition.document, languages, language, EACH_UNIT_ID),
    );
    const photoUrls: Record<string, string> = {};
    if (size !== "none") {
      const references = new Set<string>();
      for (const menu of localized) collectPhotoReferences(menu.members, references);
      const shape = size === "small" ? "square" : "display";
      for (const chunk of statementChunks(mediaImages, [...references])) {
        for (const [ref, presentation] of Object.entries(await readPresentations(db, chunk))) {
          const rendition = presentation[shape].slice("/media/renditions/".length);
          const [version, source, kind, frame] = rendition.split("/") as [
            string,
            string,
            string,
            string,
          ];
          const recipe = parseRendition(version, source, kind, frame);
          if (recipe === null) continue;
          const path = CUSTOMER_PHOTOS + rendition;
          photos.set(path, recipe);
          photoUrls[ref] = path;
        }
      }
    }
    snapshots.set(
      address,
      new Map(
        localized.map((menu) => [
          menu.language,
          {
            address,
            defaultLanguage: languages.defaultLanguage,
            photos: size,
            menu,
            photoUrls,
            appearance,
          },
        ]),
      ),
    );
  }
  return { menus: snapshots, photos };
}

const VIEW_CHANGES = new Set([
  "menus",
  "menu_releases",
  "customer_menu_styles",
  "media_images",
  settingsChangeType("venue"),
]);

export function createPublicMenuView(db: Database, venueLocale: string) {
  const renditions = new RenditionCache({ maxPending: 7 });
  let revision = 0;
  let ready: Awaited<ReturnType<typeof buildView>> | undefined;
  let pending: Promise<void> | undefined;
  const close = subscribeToChanges(({ resources }) => {
    if (resources.some(({ type }) => VIEW_CHANGES.has(type))) {
      revision++;
      ready = undefined;
    }
  });

  async function read() {
    while (ready === undefined) {
      if (pending === undefined) {
        const building = revision;
        pending = buildView(db, venueLocale)
          .then((view) => {
            if (building === revision) ready = view;
          })
          .finally(() => {
            pending = undefined;
          });
      }
      await pending;
    }
    return ready;
  }

  return {
    read,
    async readPhoto(path: string) {
      const recipe = (await read()).photos.get(path);
      if (!recipe) return null;
      const bytes = await renditions.get(path, async () => {
        const source = await readImageBytes(db, recipe.source);
        if (!source) throw new Error("Customer menu photo source missing");
        return renderRendition(source.bytes, recipe.shape, recipe.framing);
      });
      return (await read()).photos.has(path) ? bytes : null;
    },
    close,
  };
}
