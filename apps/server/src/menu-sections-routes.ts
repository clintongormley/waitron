import {
  type MemberAt,
  createSectionIn,
  readSection,
  updateSection,
  deleteSection,
  listMembers,
  addMember,
  addProducts,
  removeMember,
  moveMembersInto,
  removeMembers,
  deleteSections,
  moveMember,
  setIncludeFolder,
  replaceMember,
} from "@waitron/menu";
import { type Logger, requireManagementSession, readJsonBody } from "@waitron/server-kit";
import { type IncludeFolderInput, AppError } from "@waitron/shared";
import type { Hono, Context } from "hono";
import type { GatedWork } from "./content-translations-api.js";
import { run, runBodySetMenu, runBodySection } from "./menu-api-errors.js";
import {
  isPlainObject,
  sectionInput,
  requireUuidParam,
  idList,
  numberField,
  memberRef,
} from "./menu-request-fields.js";

const INCLUDE_FOLDER_OVERRIDES: readonly string[] = ["names", "image", "color"];
/** An include's folder body, shape only: `setIncludeFolder` checks the values. */
function includeFolderInput(body: unknown): IncludeFolderInput {
  const invalid = (field: string) => new AppError("management.request_invalid", { field });
  if (!isPlainObject(body) || typeof body.showAsFolder !== "boolean") throw invalid("showAsFolder");
  if (body.overrides === undefined) return { showAsFolder: body.showAsFolder };
  const overrides = body.overrides;
  if (
    !isPlainObject(overrides) ||
    Object.keys(overrides).some((key) => !INCLUDE_FOLDER_OVERRIDES.includes(key))
  )
    throw invalid("overrides");
  return { showAsFolder: body.showAsFolder, overrides: sectionInput(overrides, false) };
}
/** Members named by the list holding each, every member at most once. */
function membersBody(value: unknown): MemberAt[] {
  const invalid = () => new AppError("management.request_invalid", { field: "members" });
  if (!Array.isArray(value) || value.length === 0) throw invalid();
  const members = value.map((entry: unknown): MemberAt => {
    if (
      !isPlainObject(entry) ||
      typeof entry.listId !== "string" ||
      typeof entry.memberId !== "string"
    )
      throw invalid();
    return {
      listId: requireUuidParam(entry.listId, "SectionId"),
      memberId: requireUuidParam(entry.memberId, "SectionMemberId"),
    };
  });
  if (new Set(members.map(({ memberId }) => memberId)).size !== members.length) throw invalid();
  return members;
}
/** At least one section id, each named once. */
function sectionIdsBody(value: unknown): string[] {
  const ids = idList(value, "sectionIds", "SectionId");
  if (ids.length === 0 || new Set(ids).size !== ids.length)
    throw new AppError("management.request_invalid", { field: "sectionIds" });
  return ids;
}
/** Owned lists, their members, and menu inclusion targets. */
export function mountSectionRoutes(
  app: Hono,
  gated: GatedWork,
  log: Logger,
  venueLocale: string,
): void {
  const collection = "/management-api/sections";
  const one = `${collection}/:id` as const;
  const members = `${one}/members` as const;
  const member = `${members}/:memberId` as const;
  const sectionId = (c: Context) => requireUuidParam(c.req.param("id")!, "SectionId");
  const memberId = (c: Context) => requireUuidParam(c.req.param("memberId")!, "SectionMemberId");

  app.post(`${one}/sections`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const input = sectionInput(body, true);
      const position =
        body.position === undefined ? undefined : numberField(body.position, "position");
      const created = await gated(c, session, (tx) =>
        createSectionIn(tx, sectionId(c), input, position, venueLocale),
      );
      return c.json({ id: created.id }, 201);
    }),
  );
  app.get(one, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      return c.json(await gated(c, session, (tx) => readSection(tx, id)));
    }),
  );
  app.patch(one, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      const patch = sectionInput(await readJsonBody<Record<string, unknown>>(c), false);
      return c.json(await gated(c, session, (tx) => updateSection(tx, id, patch, venueLocale)));
    }),
  );
  app.delete(one, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      await gated(c, session, (tx) => deleteSection(tx, id));
      return c.body(null, 204);
    }),
  );
  app.get(members, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      return c.json(await gated(c, session, (tx) => listMembers(tx, id)));
    }),
  );
  app.post(members, (c) =>
    runBodySetMenu(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      const body = await readJsonBody<{ ref?: unknown; position?: unknown }>(c);
      const ref = memberRef(body.ref);
      const position =
        body.position === undefined ? undefined : numberField(body.position, "position");
      return c.json(await gated(c, session, (tx) => addMember(tx, id, ref, position)), 201);
    }),
  );
  app.post(`${members}/products`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      const body = await readJsonBody<{ productIds?: unknown }>(c);
      const productIds = idList(body.productIds, "productIds", "ProductId");
      return c.json(await gated(c, session, (tx) => addProducts(tx, id, productIds)));
    }),
  );
  app.delete(member, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      const held = memberId(c);
      await gated(c, session, (tx) => removeMember(tx, id, held));
      return c.body(null, 204);
    }),
  );
  app.post(`${members}/move-in`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      const body = await readJsonBody<{ members?: unknown; position?: unknown }>(c);
      const moved = membersBody(body.members);
      const position =
        body.position === undefined ? undefined : numberField(body.position, "position");
      return c.json(await gated(c, session, (tx) => moveMembersInto(tx, id, moved, position)));
    }),
  );
  app.post("/management-api/section-members/remove", (c) =>
    runBodySection(c, log, async () => {
      const session = requireManagementSession(c);
      const removed = membersBody((await readJsonBody<{ members?: unknown }>(c)).members);
      await gated(c, session, (tx) => removeMembers(tx, removed));
      return c.body(null, 204);
    }),
  );
  app.post(`${collection}/delete`, (c) =>
    runBodySection(c, log, async () => {
      const session = requireManagementSession(c);
      const ids = sectionIdsBody((await readJsonBody<{ sectionIds?: unknown }>(c)).sectionIds);
      await gated(c, session, (tx) => deleteSections(tx, ids));
      return c.body(null, 204);
    }),
  );
  app.put(`${member}/position`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      const held = memberId(c);
      const body = await readJsonBody<{ to?: unknown }>(c);
      const to = numberField(body.to, "to");
      return c.json(await gated(c, session, (tx) => moveMember(tx, id, held, to)));
    }),
  );
  app.put(`${member}/folder`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      const held = memberId(c);
      const input = includeFolderInput(await readJsonBody<unknown>(c));
      return c.json(
        await gated(c, session, (tx) => setIncludeFolder(tx, id, held, input, venueLocale)),
      );
    }),
  );
  app.post(`${member}/replace`, (c) =>
    runBodySetMenu(c, log, async () => {
      const session = requireManagementSession(c);
      const id = sectionId(c);
      const held = memberId(c);
      const ref = memberRef((await readJsonBody<{ ref?: unknown }>(c)).ref);
      return c.json(await gated(c, session, (tx) => replaceMember(tx, id, held, ref)));
    }),
  );
}
