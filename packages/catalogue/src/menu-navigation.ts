import { HOME_DISPLAY_DEFAULTS } from "./device-home.js";
import type {
  DocumentMember,
  FrozenOffer,
  FrozenOfferVariant,
  FrozenExtraItem,
  FrozenOfferedModifier,
  MenuChange,
  MenuChangeBody,
  ProductChangeField,
  MenuDocument,
  MenuField,
  MenuOccurrence,
  MenuTarget,
} from "./menu-document-types.js";

export function indexMenuOccurrences(document: MenuDocument): MenuOccurrence[] {
  const occurrences: MenuOccurrence[] = [];
  const walk = (members: readonly DocumentMember[], path: string[]): void => {
    for (const member of members) {
      if (member.kind === "section") {
        if (path.includes(member.sectionId)) continue;
        const sectionIds = [...path, member.sectionId];
        occurrences.push({
          target: { kind: "section", sectionIds, field: { kind: "summary" } },
          ancestorSectionIds: [...path],
        });
        walk(member.members, sectionIds);
      } else {
        occurrences.push({
          target: {
            kind: "product",
            sectionIds: [...path],
            menuItemId: member.menuItemId,
            productId: member.productId,
            field: { kind: "summary" },
          },
          ancestorSectionIds: [...path],
        });
      }
    }
  };
  walk(document.root.members, []);
  return occurrences;
}

function fieldKey(field: MenuField): unknown[] {
  switch (field.kind) {
    case "name":
      return [field.kind, field.audience, field.language ?? null];
    case "description":
      return [field.kind, field.language];
    default:
      return [field.kind];
  }
}

export function menuTargetKey(target: MenuTarget): string {
  switch (target.kind) {
    case "title":
      return JSON.stringify([target.kind, target.menuId]);
    case "list":
      return JSON.stringify([target.kind, target.sectionIds]);
    case "section":
      return JSON.stringify([target.kind, target.sectionIds, fieldKey(target.field)]);
    case "home":
      return JSON.stringify([target.kind, target.device, target.field]);
    case "product":
      return JSON.stringify([
        target.kind,
        target.sectionIds,
        target.menuItemId,
        target.productId,
        target.variantId ?? null,
        target.listId ?? null,
        target.extraProductId ?? null,
        target.optionLabelId ?? null,
        fieldKey(target.field),
      ]);
  }
}

type Section = Extract<DocumentMember, { kind: "section" }>;
type ProductTarget = Extract<MenuTarget, { kind: "product" }>;
type Fields = { before: MenuField[]; after: MenuField[] };

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => same(value, b[index]))
    );
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && same(left[key], right[key]))
  );
}

function changedText(
  before: Readonly<Record<string, string>> | null | undefined,
  after: Readonly<Record<string, string>> | null | undefined,
  field: (language: string) => MenuField,
): Fields {
  const result: Fields = { before: [], after: [] };
  for (const language of [
    ...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ].sort()) {
    if (before?.[language] === after?.[language]) continue;
    if (before !== null && before !== undefined && Object.hasOwn(before, language))
      result.before.push(field(language));
    if (after !== null && after !== undefined && Object.hasOwn(after, language))
      result.after.push(field(language));
  }
  return result;
}

function changedNames(
  before: {
    name: string;
    customerName: Record<string, string> | null;
    kitchenName?: string | null;
  },
  after: { name: string; customerName: Record<string, string> | null; kitchenName?: string | null },
): Fields {
  const translations = changedText(before.customerName, after.customerName, (language) => ({
    kind: "name",
    audience: "customer",
    language,
  }));
  const result: Fields = { before: [], after: [] };
  if (before.name !== after.name) {
    result.before.push({ kind: "name", audience: "staff" });
    result.after.push({ kind: "name", audience: "staff" });
  }
  result.before.push(...translations.before);
  result.after.push(...translations.after);
  if (before.kitchenName !== after.kitchenName) {
    result.before.push({ kind: "name", audience: "kitchen" });
    result.after.push({ kind: "name", audience: "kitchen" });
  }
  return result;
}

function sectionAt(document: MenuDocument, path: readonly string[]): Section {
  let members = document.root.members;
  let section: Section | undefined;
  for (const id of path) {
    section = members.find(
      (member): member is Section => member.kind === "section" && member.sectionId === id,
    );
    if (section === undefined) throw new Error("Menu occurrence has no section");
    members = section.members;
  }
  return section!;
}

const PRODUCT_KEYS = {
  image: ["image"],
  color: ["color"],
  unit: ["unit", "pricingUnit"],
  allergens: ["allergens"],
  diet: ["diet", "dietDerivation", "dietOverride", "dietaryDeclarations"],
  vat: ["vatClass"],
  ordering: ["ordering"],
} as const;

function productFields(
  before: FrozenOffer | FrozenOfferVariant,
  after: FrozenOffer | FrozenOfferVariant,
  fields: readonly ProductChangeField[],
): Fields {
  const result: Fields = { before: [], after: [] };
  for (const field of fields) {
    let changed: Fields;
    if (field === "names") changed = changedNames(before, after);
    else if (field === "description" && "description" in before && "description" in after)
      changed = changedText(before.description, after.description, (language) => ({
        kind: "description",
        language,
      }));
    else if (field in PRODUCT_KEYS) {
      const keys = PRODUCT_KEYS[field as keyof typeof PRODUCT_KEYS];
      const read = (offer: FrozenOffer | FrozenOfferVariant, key: string) =>
        (offer as unknown as Record<string, unknown>)[key];
      changed = keys.some((key) => !same(read(before, key), read(after, key)))
        ? {
            before: [{ kind: field as keyof typeof PRODUCT_KEYS }],
            after: [{ kind: field as keyof typeof PRODUCT_KEYS }],
          }
        : { before: [], after: [] };
    } else continue;
    result.before.push(...changed.before);
    result.after.push(...changed.after);
  }
  return result;
}

type NestedFields = {
  before: { field: MenuField; ids: Partial<ProductTarget> }[];
  after: { field: MenuField; ids: Partial<ProductTarget> }[];
};
function nestedFields(
  before: FrozenOffer,
  after: FrozenOffer,
  fields: readonly ProductChangeField[],
): NestedFields {
  const result: NestedFields = { before: [], after: [] };
  const add = (changed: Fields, ids: Partial<ProductTarget>) => {
    for (const side of ["before", "after"] as const)
      for (const field of changed[side]) result[side].push({ field, ids });
  };
  const both = (field: MenuField, ids: Partial<ProductTarget>) =>
    add({ before: [field], after: [field] }, ids);
  if (fields.includes("variants")) {
    if (
      !same(
        before.variants.map((v) => v.id),
        after.variants.map((v) => v.id),
      )
    )
      both({ kind: "variants" }, {});
    const ids = [
      ...new Set([...before.variants.map((v) => v.id), ...after.variants.map((v) => v.id)]),
    ];
    for (const id of ids) {
      const was = before.variants.find((v) => v.id === id),
        now = after.variants.find((v) => v.id === id);
      if (was === undefined || now === undefined) {
        add(
          {
            before: was === undefined ? [] : [{ kind: "summary" }],
            after: now === undefined ? [] : [{ kind: "summary" }],
          },
          { variantId: id },
        );
        continue;
      }
      add(productFields(was, now, ["names", "image", "unit", "allergens", "diet", "vat"]), {
        variantId: id,
      });
      if (was.unitPrice !== now.unitPrice) both({ kind: "price" }, { variantId: id });
      if (was.menuPrice !== now.menuPrice) both({ kind: "override" }, { variantId: id });
    }
  }
  for (const kind of ["extras", "options"] as const) {
    if (!fields.includes(kind)) continue;
    const prev = before.offeredModifiers.filter((m) => m.kind === kind),
      next = after.offeredModifiers.filter((m) => m.kind === kind);
    if (
      !same(
        prev.map((m) => m.id),
        next.map((m) => m.id),
      )
    )
      both({ kind }, {});
    const ids = [...new Set([...prev.map((m) => m.id), ...next.map((m) => m.id)])];
    for (const listId of ids) {
      const was = prev.find((m) => m.id === listId),
        now = next.find((m) => m.id === listId);
      if (was === undefined || now === undefined) {
        add(
          {
            before: was === undefined ? [] : [{ kind }],
            after: now === undefined ? [] : [{ kind }],
          },
          { listId },
        );
        continue;
      }
      add(changedNames(was, now), { listId });
      if (was.kind === "extras" && now.kind === "extras") {
        if (was.minPicks !== now.minPicks || was.maxPicks !== now.maxPicks)
          both({ kind: "limits" }, { listId });
        if (
          !same(
            was.items.map((i) => i.productId),
            now.items.map((i) => i.productId),
          )
        )
          both({ kind: "members" }, { listId });
        for (const id of [
          ...new Set([...was.items.map((i) => i.productId), ...now.items.map((i) => i.productId)]),
        ]) {
          const old = was.items.find((i) => i.productId === id),
            item = now.items.find((i) => i.productId === id);
          const ids = { listId, extraProductId: id };
          if (old === undefined || item === undefined) {
            add(
              {
                before: old === undefined ? [] : [{ kind: "summary" }],
                after: item === undefined ? [] : [{ kind: "summary" }],
              },
              ids,
            );
            continue;
          }
          if (old.price !== item.price) both({ kind: "price" }, ids);
          if (old.preselected !== item.preselected) both({ kind: "default" }, ids);
        }
      } else if (was.kind === "options" && now.kind === "options") {
        if (was.defaultLabelId !== now.defaultLabelId) both({ kind: "default" }, { listId });
        if (
          !same(
            was.labels.map((l) => l.id),
            now.labels.map((l) => l.id),
          )
        )
          both({ kind: "members" }, { listId });
        for (const id of [
          ...new Set([...was.labels.map((l) => l.id), ...now.labels.map((l) => l.id)]),
        ]) {
          const old = was.labels.find((l) => l.id === id),
            label = now.labels.find((l) => l.id === id);
          const ids = { listId, optionLabelId: id };
          if (old === undefined || label === undefined) {
            add(
              {
                before: old === undefined ? [] : [{ kind: "summary" }],
                after: label === undefined ? [] : [{ kind: "summary" }],
              },
              ids,
            );
            continue;
          }
          add(changedNames(old, label), ids);
        }
      }
    }
  }
  return result;
}

function extraFields(
  before: FrozenExtraItem,
  after: FrozenExtraItem,
  fields: readonly ProductChangeField[],
): Fields {
  const result: Fields = { before: [], after: [] };
  const keys = {
    image: "image",
    allergens: "addAllergens",
    diet: "suitableFor",
    vat: "vatClass",
  } as const;
  for (const field of fields) {
    if (field === "names") {
      const changed = changedNames(before, after);
      result.before.push(...changed.before);
      result.after.push(...changed.after);
    } else if (
      field in keys &&
      !same(before[keys[field as keyof typeof keys]], after[keys[field as keyof typeof keys]])
    ) {
      result.before.push({ kind: field as keyof typeof keys });
      result.after.push({ kind: field as keyof typeof keys });
    }
  }
  return result;
}

export function navigateMenuChanges(
  live: MenuDocument | null,
  proposed: MenuDocument,
  changes: readonly MenuChangeBody[],
): MenuChange[] {
  const beforeOccurrences = live === null ? [] : indexMenuOccurrences(live).map((o) => o.target);
  const afterOccurrences = indexMenuOccurrences(proposed).map((o) => o.target);
  return changes.map((change) => {
    const targets: { before: MenuTarget[]; after: MenuTarget[] } = { before: [], after: [] };
    const productTargets = (
      side: "before" | "after",
      productId: string,
      fields: readonly MenuField[],
      ids: Partial<ProductTarget> = {},
    ) => {
      for (const field of fields)
        for (const occurrence of side === "before" ? beforeOccurrences : afterOccurrences)
          if (occurrence.kind === "product" && occurrence.productId === productId)
            targets[side].push({ ...occurrence, ...ids, field });
    };
    const sections = (
      side: "before" | "after",
      sectionId: string,
      field: MenuField,
      parent?: readonly string[],
    ) => {
      for (const occurrence of side === "before" ? beforeOccurrences : afterOccurrences)
        if (
          occurrence.kind === "section" &&
          occurrence.sectionIds.at(-1) === sectionId &&
          (parent === undefined || same(occurrence.sectionIds.slice(0, -1), parent))
        )
          targets[side].push({ ...occurrence, field });
    };
    const extraTargets = (
      side: "before" | "after",
      productId: string,
      field: MenuField,
      listId?: string,
    ) => {
      const document = side === "before" ? live : proposed;
      for (const occurrence of side === "before" ? beforeOccurrences : afterOccurrences) {
        if (occurrence.kind !== "product") continue;
        const offer = document?.offers[occurrence.menuItemId];
        for (const list of offer?.offeredModifiers ?? []) {
          if (list.kind !== "extras" || (listId !== undefined && list.id !== listId)) continue;
          if (list.items.some((item) => item.productId === productId))
            targets[side].push({
              ...occurrence,
              listId: list.id,
              extraProductId: productId,
              field,
            });
        }
      }
    };
    switch (change.kind) {
      case "product_added":
        productTargets("after", change.productId, [{ kind: "summary" }]);
        break;
      case "product_removed":
        productTargets("before", change.productId, [{ kind: "summary" }]);
        break;
      case "product_deleted":
        productTargets("before", change.productId, [{ kind: "summary" }]);
        extraTargets("before", change.productId, { kind: "summary" });
        break;
      case "product_moved":
        productTargets("before", change.productId, [{ kind: "summary" }]);
        productTargets("after", change.productId, [{ kind: "summary" }]);
        break;
      case "section_added":
        sections("after", change.sectionId, { kind: "summary" }, change.parentSectionIds);
        break;
      case "section_removed":
        sections("before", change.sectionId, { kind: "summary" }, change.parentSectionIds);
        break;
      case "order_changed":
        for (const side of ["before", "after"] as const) {
          if (side === "before" && live === null) continue;
          if (change.listSectionId === null) targets[side].push({ kind: "list", sectionIds: [] });
          else {
            sections(side, change.listSectionId, { kind: "summary" });
            targets[side] = targets[side].map((t) => ({
              kind: "list",
              sectionIds: (t as Extract<MenuTarget, { kind: "section" }>).sectionIds,
            }));
          }
        }
        break;
      case "menu_renamed":
        if (live !== null) targets.before.push({ kind: "title", menuId: live.menuId });
        targets.after.push({ kind: "title", menuId: proposed.menuId });
        break;
      case "home_shortcuts_changed":
      case "home_display_changed":
        for (const device of change.kind === "home_shortcuts_changed"
          ? (["handheld", "till"] as const)
          : [change.device])
          for (const field of change.kind === "home_shortcuts_changed"
            ? (["shortcuts"] as const)
            : (["columns", "tiles", "order"] as const)) {
            if (
              field !== "shortcuts" &&
              same(
                live?.home[device][field] ?? HOME_DISPLAY_DEFAULTS[device][field],
                proposed.home[device][field],
              )
            )
              continue;
            if (live !== null) targets.before.push({ kind: "home", device, field });
            targets.after.push({ kind: "home", device, field });
          }
        break;
      case "section_changed": {
        const before = beforeOccurrences.find(
          (t) => t.kind === "section" && t.sectionIds.at(-1) === change.sectionId,
        );
        const after = afterOccurrences.find(
          (t) => t.kind === "section" && t.sectionIds.at(-1) === change.sectionId,
        );
        if (before?.kind !== "section" || after?.kind !== "section" || live === null) break;
        const was = sectionAt(live, before.sectionIds),
          node = sectionAt(proposed, after.sectionIds);
        for (const field of change.fields) {
          const changed =
            field === "names"
              ? changedNames(
                  { name: was.internalName, customerName: was.names },
                  { name: node.internalName, customerName: node.names },
                )
              : same(was[field], node[field])
                ? { before: [], after: [] }
                : { before: [{ kind: field }], after: [{ kind: field }] };
          for (const side of ["before", "after"] as const)
            for (const value of changed[side]) sections(side, change.sectionId, value as MenuField);
        }
        break;
      }
      case "price_changed":
      case "product_changed": {
        const before = Object.values(live?.offers ?? {}).find(
          (o) => o.productId === change.productId,
        );
        const after = Object.values(proposed.offers).find((o) => o.productId === change.productId);
        if (change.kind === "product_changed") {
          for (const occurrence of beforeOccurrences) {
            if (occurrence.kind !== "product") continue;
            const old = live?.offers[occurrence.menuItemId],
              now = proposed.offers[occurrence.menuItemId];
            if (old === undefined || now === undefined) continue;
            for (const list of old.offeredModifiers) {
              if (list.kind !== "extras") continue;
              const next = now.offeredModifiers.find(
                (m): m is Extract<FrozenOfferedModifier, { kind: "extras" }> =>
                  m.kind === "extras" && m.id === list.id,
              );
              const oldItem = list.items.find((i) => i.productId === change.productId),
                item = next?.items.find((i) => i.productId === change.productId);
              if (oldItem === undefined || item === undefined) continue;
              const changed = extraFields(oldItem, item, change.fields);
              const ids = { listId: list.id, extraProductId: change.productId };
              for (const field of changed.before)
                targets.before.push({ ...occurrence, ...ids, field });
              // Look up after occurrences separately: a simultaneous move must keep its new path.
              for (const field of changed.after)
                for (const target of afterOccurrences)
                  if (target.kind === "product" && target.menuItemId === occurrence.menuItemId)
                    targets.after.push({ ...target, ...ids, field });
            }
          }
        }
        if (before === undefined || after === undefined) break;
        const fields =
          change.kind === "product_changed"
            ? productFields(before, after, change.fields)
            : { before: [] as MenuField[], after: [] as MenuField[] };
        if (change.kind === "price_changed") {
          if (before.unitPrice !== after.unitPrice) {
            fields.before.push({ kind: "price" });
            fields.after.push({ kind: "price" });
          }
          if (before.grossPrice !== after.grossPrice) {
            fields.before.push({ kind: "override" });
            fields.after.push({ kind: "override" });
          }
        }
        productTargets("before", change.productId, fields.before);
        productTargets("after", change.productId, fields.after);
        if (change.kind === "product_changed") {
          const nested = nestedFields(before, after, change.fields);
          for (const side of ["before", "after"] as const)
            for (const { field, ids } of nested[side])
              productTargets(side, change.productId, [field], ids);
        }
        break;
      }
      case "extra_unit_changed":
      case "extra_portion_changed":
      case "extra_max_quantity_changed":
        for (const side of ["before", "after"] as const)
          extraTargets(
            side,
            change.productId,
            {
              kind:
                change.kind === "extra_unit_changed"
                  ? "unit"
                  : change.kind === "extra_portion_changed"
                    ? "portion"
                    : "maxQuantity",
            },
            change.listId,
          );
        break;
    }
    for (const side of ["before", "after"] as const) {
      const occurrences = side === "before" ? beforeOccurrences : afterOccurrences;
      const rank = (target: MenuTarget) =>
        occurrences.findIndex(
          (o) =>
            o.kind === target.kind &&
            (o.kind === "product" && target.kind === "product"
              ? o.menuItemId === target.menuItemId && same(o.sectionIds, target.sectionIds)
              : o.kind === "section" && target.kind === "section"
                ? same(o.sectionIds, target.sectionIds)
                : false),
        );
      targets[side] = [...new Map(targets[side].map((t) => [menuTargetKey(t), t])).values()].sort(
        (a, b) => rank(a) - rank(b),
      );
    }
    const keys = (side: "before" | "after") =>
      [...new Set(targets[side].map(menuTargetKey))].sort();
    const id = JSON.stringify([
      proposed.menuId,
      change.kind,
      change.source,
      change.includedMenu?.id ?? null,
      keys("before"),
      keys("after"),
    ]);
    return { ...change, id, targets };
  });
}
