import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useCatalogueDb } from "../test/fixtures.js";
import { writeContentLanguages } from "./content-languages.js";
import { createCatalogue, updateMenuDetails } from "./operations.js";
import { createOptionList, getOptionList, updateOptionList } from "./options.js";
import { createExtraList, getExtraList, updateExtraList } from "./extras.js";
import { addMember, createSectionIn, readSection, updateSection } from "./sections.js";
import { requireMenuRoot } from "./menu-structure.js";
import { setIncludeFolder } from "./include-folder.js";
import { folderPresentation } from "./include-folder-presentation.js";
import { optionLabels, optionLists } from "./schema/options.js";
import { extraLists } from "./schema/extras.js";
import { sectionMembers, sections } from "./schema/sections.js";

const fx = useCatalogueDb();
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, body);
type Names = Record<string, string> | null;
type Target = {
  read(tx: Transaction): Promise<Names>;
  save(tx: Transaction, names?: Names): Promise<unknown>;
  plant(tx: Transaction, names: Record<string, string>): Promise<unknown>;
};
const listBody = <T extends { id: string }>(row: T) => {
  const { id, ...body } = row;
  void id;
  return body;
};

async function makeTarget(tx: Transaction, kind: string, names: Names): Promise<Target> {
  if (kind === "option list" || kind === "option label") {
    const label = kind === "option label";
    const row = await createOptionList(
      tx,
      {
        name: "ES potatoes",
        kitchenName: "KITCHEN POTATOES",
        customerName: label ? null : names,
        labels: [{ name: "Small", kitchenName: "PEQ", customerName: label ? names : null }],
      },
      "es",
    );
    return {
      async read(tx) {
        const saved = await getOptionList(tx, row.id);
        return label ? saved.labels[0]!.customerName : saved.customerName;
      },
      async save(tx, names) {
        const body = listBody(await getOptionList(tx, row.id));
        if (label) {
          const first = body.labels[0]!;
          if (names === undefined) delete (first as { customerName?: Names }).customerName;
          else first.customerName = names;
        } else if (names === undefined) delete (body as { customerName?: Names }).customerName;
        else body.customerName = names;
        return updateOptionList(tx, row.id, body, "es");
      },
      async plant(tx, names) {
        if (label)
          return tx
            .update(optionLabels)
            .set({ customerName: names })
            .where(eq(optionLabels.id, row.labels[0]!.id));
        return tx
          .update(optionLists)
          .set({ customerName: names })
          .where(eq(optionLists.id, row.id));
      },
    };
  }
  if (kind === "extras list") {
    const row = await createExtraList(
      tx,
      {
        name: "ES potatoes",
        kitchenName: "KITCHEN POTATOES",
        customerName: names,
        active: false,
        items: [],
      },
      "es",
    );
    return {
      async read(tx) {
        return (await getExtraList(tx, row.id)).customerName;
      },
      async save(tx, names) {
        const body = listBody(await getExtraList(tx, row.id));
        if (names === undefined) delete (body as { customerName?: Names }).customerName;
        else body.customerName = names;
        return updateExtraList(tx, row.id, body, "es");
      },
      async plant(tx, names) {
        return tx.update(extraLists).set({ customerName: names }).where(eq(extraLists.id, row.id));
      },
    };
  }
  const menu = await createCatalogue(tx, {
    name: "ES potatoes",
    ...(kind === "menu" ? { names: names ?? {} } : {}),
  });
  const root = await requireMenuRoot(tx, menu.id);
  if (kind === "included menu") {
    const child = await createCatalogue(tx, {
      name: "ES drinks",
      names: { es: "Para beber", en: "Drinks" },
    });
    const childRoot = await requireMenuRoot(tx, child.id);
    const member = await addMember(tx, root, { kind: "section", sectionId: childRoot });
    await setIncludeFolder(
      tx,
      root,
      member.id,
      { showAsFolder: false, overrides: { names: names ?? {}, image: null, color: "#112233" } },
      "es",
    );
    return {
      async read(tx) {
        const [saved] = await tx
          .select()
          .from(sectionMembers)
          .where(eq(sectionMembers.id, member.id));
        return saved!.folderOverrides.names ?? null;
      },
      async save(tx, names) {
        return setIncludeFolder(
          tx,
          root,
          member.id,
          {
            showAsFolder: false,
            ...(names === undefined
              ? {}
              : { overrides: { names: names ?? {}, image: null, color: "#112233" } }),
          },
          "es",
        );
      },
      async plant(tx, names) {
        return tx
          .update(sectionMembers)
          .set({ folderOverrides: { names, image: null, color: "#112233" } })
          .where(eq(sectionMembers.id, member.id));
      },
    };
  }
  const id =
    kind === "menu"
      ? root
      : (
          await createSectionIn(
            tx,
            root,
            { internalName: "ES potatoes", names: names ?? {} },
            undefined,
            "es",
          )
        ).id;
  return {
    async read(tx) {
      return (await readSection(tx, id)).names;
    },
    async save(tx, names) {
      const patch = names === undefined ? {} : { names: names ?? {} };
      return kind === "menu"
        ? updateMenuDetails(tx, menu.id, patch)
        : updateSection(tx, id, patch, "es");
    },
    async plant(tx, names) {
      return tx.update(sections).set({ names }).where(eq(sections.id, id));
    },
  };
}

beforeEach(async () => {
  await seedTenant(fx.db);
  await run((tx) => writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en"] }));
});

describe.each(["option list", "option label", "extras list", "menu", "section", "included menu"])(
  "optional %s maps",
  (kind) => {
    it("creates English text with blank Spanish without copying staff text", async () => {
      const target = await run((tx) => makeTarget(tx, kind, { en: " Potatoes ", es: "  " }));
      expect(await run((tx) => target.read(tx))).toEqual({ en: "Potatoes" });
    });

    it("saves partial text and clears the last translation", async () => {
      const target = await run((tx) => makeTarget(tx, kind, { es: "Original" }));
      await run((tx) => target.save(tx, { en: "Potatoes" }));
      expect(await run((tx) => target.read(tx))).toEqual({ en: "Potatoes" });
      await run((tx) => target.save(tx, {}));
      expect(await run((tx) => target.read(tx))).toEqual(
        kind === "menu" || kind === "section" ? {} : null,
      );
    });

    it("preserves omitted maps and disabled stored text on replacement and clear", async () => {
      const target = await run((tx) => makeTarget(tx, kind, { es: "Original" }));
      await run((tx) => target.plant(tx, { es: "Original", fr: "Ancien" }));
      await run((tx) => target.save(tx));
      expect(await run((tx) => target.read(tx))).toEqual({ es: "Original", fr: "Ancien" });
      await run((tx) => target.save(tx, { en: "Potatoes" }));
      expect(await run((tx) => target.read(tx))).toEqual({ en: "Potatoes", fr: "Ancien" });
      await run((tx) => target.save(tx, {}));
      expect(await run((tx) => target.read(tx))).toEqual({ fr: "Ancien" });
    });

    it("accepts unchanged disabled text without trimming or rewriting it", async () => {
      const target = await run((tx) => makeTarget(tx, kind, { es: "Original" }));
      await run((tx) => target.plant(tx, { es: "Original", fr: " Ancien " }));
      await run((tx) => target.save(tx, { es: " New ", fr: " Ancien " }));
      expect(await run((tx) => target.read(tx))).toEqual({ es: "New", fr: " Ancien " });
    });

    it.each(["Changed", " "])(
      "refuses an explicit disabled edit %j without changing saved text",
      async (text) => {
        const target = await run((tx) => makeTarget(tx, kind, { es: "Original" }));
        await run((tx) => target.plant(tx, { es: "Original", fr: "Ancien" }));
        await expect(
          run((tx) => target.save(tx, { es: "Original", fr: text })),
        ).rejects.toMatchObject({ code: "content.translation_invalid" });
        expect(await run((tx) => target.read(tx))).toEqual({ es: "Original", fr: "Ancien" });
      },
    );

    it.each<Record<string, string>>([{ EN: "Potatoes" }, { en: "é".repeat(2049) }])(
      "refuses malformed or oversized translations on create and update",
      async (names) => {
        const code = kind.startsWith("option")
          ? "options.invalid"
          : kind === "extras list"
            ? "extras.invalid"
            : kind === "included menu"
              ? "menu_section.invalid"
              : "content.translation_invalid";
        await expect(run((tx) => makeTarget(tx, kind, names))).rejects.toMatchObject({ code });
        const target = await run((tx) => makeTarget(tx, kind, { es: "Original" }));
        await expect(run((tx) => target.save(tx, names))).rejects.toMatchObject({ code });
        expect(await run((tx) => target.read(tx))).toEqual({ es: "Original" });
      },
    );
  },
);

it("clears include names to inheritance while retaining image, colour and folder switch", async () => {
  const target = await run((tx) => makeTarget(tx, "included menu", { es: "Otra" }));
  const result = await run((tx) => target.save(tx, {}));
  expect(result).toEqual({ showAsFolder: false, overrides: { image: null, color: "#112233" } });
  expect(
    folderPresentation(
      { names: { es: "Para beber", en: "Drinks" }, image: "root.jpg", color: "#445566" },
      { ...(result as Parameters<typeof folderPresentation>[1]), showAsFolder: true },
    ),
  ).toEqual({ names: { es: "Para beber", en: "Drinks" }, image: null, color: "#112233" });
});

it.each(["option list", "option label", "extras list"])(
  "a null %s map clears enabled text and keeps disabled text",
  async (kind) => {
    const target = await run((tx) => makeTarget(tx, kind, { es: "Original" }));
    await run((tx) => target.plant(tx, { es: "Original", fr: "Ancien" }));
    await run((tx) => target.save(tx, null));
    expect(await run((tx) => target.read(tx))).toEqual({ fr: "Ancien" });
  },
);
