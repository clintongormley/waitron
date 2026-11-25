import type { DashboardRequest } from "@waitron/dashboard-kit";
import type {
  MenuDefaults,
  SetMenuDetails,
  DashboardMenuSummary,
  PatchDraftAnswer,
  MenuPatchChange,
  MenuPatchResult,
} from "@waitron/menu";
import type {
  MenuHome,
  MenuStatus,
  MenuPreview,
  MemberRef,
  IncludeFolder,
  SectionDetails,
  SectionInput,
  SetMenuLine,
  MenuKind,
  SectionMember,
  MenuDeleteImpact,
  MenuPriceRow,
  TileRef,
  HomeOrder,
  PublishedMenuVersion,
  MenuPublicationsAnswer,
  QueuedEdition,
  IncludeFolderInput,
} from "@waitron/shared";

/** The menu-settings read: the menu's defaults, whether the venue's region charges takeaway VAT, and
 * the takeaway rates a person may pick. */
export type MenuSettingsAnswer = MenuDefaults & {
  takeawayVat: boolean;
  vatRates: string[];
  /** The one rate everything eaten here is charged today ("10.00"). */
  dineInVatRate: string;
};
/** A venue-local date and time; `occurrence` picks one of a time the clock shows twice. */
export interface ActivationTime {
  date: string;
  time: string;
  occurrence?: "earlier" | "later";
}

export interface MenuReadModels {
  structure: MenuStructure;
  home: MenuHome;
  status: MenuStatus;
  preview: MenuPreview;
}

export type MenuReadPart = keyof MenuReadModels;

export interface MenuReadRevision {
  epoch: string;
  sequence: number;
}

export type MenuReadResult = Partial<{
  [P in MenuReadPart]: {
    status: number;
    body: MenuReadModels[P] | { error: { code: string; params?: Record<string, unknown> } };
  };
}> & { revision?: MenuReadRevision };

export interface MenuStructureNode {
  memberId: string;
  ref: MemberRef;
  children?: MenuStructureNode[];
  internalName?: string;
  names?: Record<string, string>;
  image?: string | null;
  color?: string | null;
  ownerMenuId?: string;
  includedMenuId?: string;
  /** Present exactly when `includedMenuId` is. */
  folder?: IncludeFolder;
}

export interface MenuStructure {
  rootSectionId: string;
  root: SectionDetails;
  nodes: MenuStructureNode[];
  includable: { id: string; name: string; rootSectionId: string }[];
  placeableSetMenus: { id: string; name: string }[];
  includedBy: { id: string; name: string }[];
}
type SetMenuDraftTerms = {
  setPrice?: string;
};
type CreateMenuDetails = Omit<SectionInput, "internalName"> &
  ({ kind?: "menu"; setPrice?: never } | ({ kind: "set_menu" } & SetMenuDraftTerms));
type SetMenuDishesResult = { details: SetMenuDetails; addedLines: SetMenuLine[] };

export interface MenuSummary {
  id: string;
  name: string;
  active: boolean;
  kind: MenuKind;
  setPrice: string | null;
}

export class MenuApi {
  readonly #request: DashboardRequest;
  constructor(request: DashboardRequest) {
    this.#request = request;
  }
  // ── Menu management ──────────────────────────────────────────────────────────────────────

  listMenus(): Promise<DashboardMenuSummary[]> {
    return this.#request<DashboardMenuSummary[]>("/management-api/menus", "GET");
  }
  getMenuStructures(): Promise<{ menu: MenuSummary; structure: MenuStructure }[]> {
    return this.#request<{ menu: MenuSummary; structure: MenuStructure }[]>(
      "/management-api/menus/structures",
      "GET",
    );
  }
  getMenuSettings(): Promise<MenuSettingsAnswer> {
    return this.#request<MenuSettingsAnswer>("/management-api/menu-settings", "GET");
  }
  saveMenuDefaultColor(color: string | null): Promise<MenuDefaults> {
    return this.#request<MenuDefaults>("/management-api/menu-settings/default-color", "PUT", {
      color,
    });
  }
  createMenu(name: string, details: CreateMenuDetails = {}): Promise<MenuSummary> {
    return this.#request<MenuSummary>("/management-api/menus", "POST", {
      name,
      ...details,
    });
  }
  readSetMenu(menuId: string): Promise<SetMenuDetails> {
    return this.#request(`/management-api/menus/${menuId}/set-menu`, "GET");
  }
  saveSetMenuLines(
    menuId: string,
    lines: readonly Omit<SetMenuLine, "id">[],
  ): Promise<{ lines: SetMenuLine[] }> {
    return this.#request(`/management-api/menus/${menuId}/set-menu/lines`, "PUT", { lines });
  }
  saveSetMenuDishCourse(
    menuId: string,
    itemId: string,
    courseId: string | null,
  ): Promise<SetMenuDishesResult & { removedLines: SetMenuLine[] }> {
    return this.#request(`/management-api/menus/${menuId}/set-menu/items/${itemId}/course`, "PUT", {
      courseId,
    });
  }
  saveSetMenuVariantChoices(
    menuId: string,
    itemId: string,
    variants: readonly { variantId: string; included: boolean; surcharge: string | null }[],
  ): Promise<SetMenuDetails> {
    return this.#request(
      `/management-api/menus/${menuId}/set-menu/items/${itemId}/variants`,
      "PUT",
      { variants },
    );
  }
  addSetMenuDishes(
    menuId: string,
    dishes: readonly { productId: string; excludedVariantIds: readonly string[] }[],
  ): Promise<SetMenuDishesResult> {
    return this.#request(`/management-api/menus/${menuId}/set-menu/dishes`, "POST", { dishes });
  }
  copySetMenuDishes(menuId: string, fromMenuId: string): Promise<SetMenuDishesResult> {
    return this.#request(`/management-api/menus/${menuId}/set-menu/copy-dishes`, "POST", {
      fromMenuId,
    });
  }
  placeSetMenu(sectionId: string, menuId: string): Promise<SectionMember> {
    return this.addSectionMember(sectionId, { kind: "set_menu", menuId });
  }
  getMenuDeleteImpact(id: string): Promise<MenuDeleteImpact> {
    return this.#request<MenuDeleteImpact>(
      `/management-api/menus/${encodeURIComponent(id)}/delete-impact`,
      "GET",
    );
  }
  deleteMenu(
    id: string,
    body: { replacements: Record<string, string>; defaultMenuId?: string },
  ): Promise<void> {
    return this.#request<void>(
      `/management-api/menus/${encodeURIComponent(id)}/delete`,
      "POST",
      body,
    );
  }
  duplicateMenu(id: string, name: string): Promise<MenuSummary> {
    return this.#request<MenuSummary>(
      `/management-api/menus/${encodeURIComponent(id)}/duplicate`,
      "POST",
      { name },
    );
  }
  renameMenu(id: string, name: string): Promise<void> {
    return this.#request<void>(`/management-api/menus/${id}`, "PATCH", { name });
  }
  getMenuRead(id: string, parts: readonly MenuReadPart[]): Promise<MenuReadResult> {
    const query = parts.map((part) => `part=${encodeURIComponent(part)}`).join("&");
    return this.#request<MenuReadResult>(
      `/management-api/menus/${encodeURIComponent(id)}/read?${query}`,
      "GET",
    );
  }
  getMenuStructure(id: string): Promise<MenuStructure> {
    return this.#request<MenuStructure>(`/management-api/menus/${id}/structure`, "GET");
  }
  getMenuPrices(id: string): Promise<MenuPriceRow[]> {
    return this.#request<MenuPriceRow[]>(`/management-api/menus/${id}/prices`, "GET");
  }
  getMenuStatuses(): Promise<Record<string, MenuStatus>> {
    return this.#request<Record<string, MenuStatus>>("/management-api/menus/status", "GET");
  }
  getMenuStatus(id: string): Promise<MenuStatus> {
    return this.#request<MenuStatus>(`/management-api/menus/${id}/status`, "GET");
  }
  getMenuPreview(id: string): Promise<MenuPreview> {
    return this.#request<MenuPreview>(`/management-api/menus/${id}/preview`, "GET");
  }
  getMenuHome(menuId: string): Promise<MenuHome> {
    return this.#request<MenuHome>(`/management-api/menus/${menuId}/home`, "GET");
  }
  /** A target the menu's structure does not reach is refused `menu.shortcut_unreachable`. */
  addHomeShortcut(menuId: string, ref: MemberRef): Promise<SectionMember> {
    return this.#request(`/management-api/menus/${menuId}/home/shortcuts`, "POST", { ref });
  }
  removeHomeShortcut(menuId: string, memberId: string): Promise<void> {
    return this.#request<void>(
      `/management-api/menus/${menuId}/home/shortcuts/${memberId}`,
      "DELETE",
    );
  }
  /** Answers every shortcut in its new order. */
  moveHomeShortcut(
    menuId: string,
    memberId: string,
    to: number,
  ): Promise<SectionMember<TileRef>[]> {
    return this.#request(
      `/management-api/menus/${menuId}/home/shortcuts/${memberId}/position`,
      "PUT",
      { to },
    );
  }
  setHomeDisplay(menuId: string, order: HomeOrder): Promise<void> {
    return this.#request<void>(`/management-api/menus/${menuId}/home-display`, "PATCH", { order });
  }
  /** `expectedHash` is the preview's; a menu edited since is refused `menu.changed_since_preview`. */
  publishMenu(id: string, expectedHash: string): Promise<PublishedMenuVersion> {
    return this.#request<PublishedMenuVersion>(`/management-api/menus/${id}/publish`, "POST", {
      expectedHash,
    });
  }
  /** `null` when the menu has never been published. */
  getLiveMenu(menuId: string): Promise<PatchDraftAnswer | null> {
    return this.#request<PatchDraftAnswer | null>(`/management-api/menus/${menuId}/live`, "GET");
  }
  /** A live version other than `baseVersionId` is refused `menu_patch.base_changed`. `queued` names
   * the scheduled versions that take the declarations changes too. A declarations change needs
   * `reviewed`, the reviewed answer's `revision`; another is refused
   * `menu_patch.declarations_changed`. */
  patchLiveMenu(
    menuId: string,
    body: {
      baseVersionId: string;
      changes: MenuPatchChange[];
      queued?: string[];
      reviewed?: string;
    },
  ): Promise<MenuPatchResult> {
    return this.#request<MenuPatchResult>(`/management-api/menus/${menuId}/patch`, "POST", body);
  }
  getMenuPublications(menuId: string): Promise<MenuPublicationsAnswer> {
    return this.#request<MenuPublicationsAnswer>(
      `/management-api/menus/${menuId}/publications`,
      "GET",
    );
  }
  scheduleMenuPublication(
    menuId: string,
    input: { expectedHash: string; activatesAt: ActivationTime },
  ): Promise<QueuedEdition> {
    return this.#request<QueuedEdition>(
      `/management-api/menus/${menuId}/publications`,
      "POST",
      input,
    );
  }
  rescheduleMenuPublication(
    menuId: string,
    versionId: string,
    input: { activatesAt: ActivationTime },
  ): Promise<QueuedEdition> {
    return this.#request<QueuedEdition>(
      `/management-api/menus/${menuId}/publications/${versionId}`,
      "PATCH",
      input,
    );
  }
  cancelMenuPublication(menuId: string, versionId: string): Promise<void> {
    return this.#request<void>(
      `/management-api/menus/${menuId}/publications/${versionId}/cancel`,
      "POST",
    );
  }
  /** A null `grossPrice` clears the menu's price, so the product's own applies. */
  updateMenuItem(
    menuId: string,
    menuItemId: string,
    input: { grossPrice?: string | null },
  ): Promise<void> {
    return this.#request<void>(
      `/management-api/menus/${menuId}/items/${menuItemId}`,
      "PATCH",
      input,
    );
  }
  /** A null `price` clears this menu's price for the variant, so it inherits again. */
  setMenuVariantPrice(
    menuId: string,
    menuItemId: string,
    variantId: string,
    price: string | null,
  ): Promise<void> {
    return this.#request<void>(
      `/management-api/menus/${menuId}/items/${menuItemId}/variants/${variantId}`,
      "PATCH",
      { price },
    );
  }
  setVenueDefaultMenu(menuId: string): Promise<void> {
    return this.#request<void>("/management-api/venue-default-menu", "PUT", { menuId });
  }
  // ── Menu sections (`/management-api/sections`) ─────────────────────────────────────────────

  createSectionIn(id: string, input: SectionInput): Promise<SectionDetails> {
    return this.#request(`/management-api/sections/${id}/sections`, "POST", input);
  }
  updateMenuDetails(id: string, input: Partial<SectionInput> & SetMenuDraftTerms): Promise<void> {
    const { internalName, ...details } = input;
    return this.#request(`/management-api/menus/${id}`, "PATCH", {
      name: internalName,
      ...details,
    });
  }
  updateSection(id: string, patch: Partial<SectionInput>): Promise<SectionDetails> {
    return this.#request(`/management-api/sections/${id}`, "PATCH", patch);
  }
  deleteSection(id: string): Promise<void> {
    return this.#request(`/management-api/sections/${id}`, "DELETE");
  }
  listSectionMembers(id: string): Promise<SectionMember[]> {
    return this.#request(`/management-api/sections/${id}/members`, "GET");
  }
  addSectionMember(id: string, ref: MemberRef): Promise<SectionMember> {
    return this.#request(`/management-api/sections/${id}/members`, "POST", { ref });
  }
  /** Appends each product the section does not already hold. */
  addSectionProducts(
    id: string,
    productIds: string[],
  ): Promise<{ added: number; addedLines?: SetMenuLine[] }> {
    return this.#request(`/management-api/sections/${id}/members/products`, "POST", {
      productIds,
    });
  }
  removeSectionMember(id: string, memberId: string): Promise<void> {
    return this.#request(`/management-api/sections/${id}/members/${memberId}`, "DELETE");
  }
  /** Answers the whole list in its new order. */
  moveSectionMember(id: string, memberId: string, to: number): Promise<SectionMember[]> {
    return this.#request(`/management-api/sections/${id}/members/${memberId}/position`, "PUT", {
      to,
    });
  }
  /** Answers the destination list in its new order. */
  moveSectionMembersInto(
    listId: string,
    members: { listId: string; memberId: string }[],
    position?: number,
  ): Promise<SectionMember[]> {
    return this.#request(
      `/management-api/sections/${listId}/members/move-in`,
      "POST",
      position === undefined ? { members } : { members, position },
    );
  }
  removeSectionMembers(members: { listId: string; memberId: string }[]): Promise<void> {
    return this.#request("/management-api/section-members/remove", "POST", { members });
  }
  deleteSections(sectionIds: string[]): Promise<void> {
    return this.#request("/management-api/sections/delete", "POST", { sectionIds });
  }
  setIncludeFolder(
    listId: string,
    memberId: string,
    input: IncludeFolderInput,
  ): Promise<IncludeFolder> {
    return this.#request(
      `/management-api/sections/${listId}/members/${memberId}/folder`,
      "PUT",
      input,
    );
  }
}
