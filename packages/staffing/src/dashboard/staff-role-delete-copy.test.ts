import { afterEach, expect, it } from "vitest";
import { codeMessage, currentLocale, setLocale } from "@waitron/dashboard-kit";
import { staffRoleDeleteCopy } from "./staff-role-delete-copy.js";

const before = currentLocale();
afterEach(() => setLocale(before));

const people = [
  { id: "private-ana", name: "Ana" },
  { id: "private-marc", name: "Marc" },
];

it.each([
  [
    "en",
    [
      "Delete staff role",
      "Why this cannot be deleted",
      "Work that ends",
      "Settings removed",
      "This cannot be undone.",
      "Cancel",
      "Delete",
      "Try again",
      "Checking what deleting this staff role would change…",
    ],
  ],
  [
    "es",
    [
      "Eliminar rol de personal",
      "Por qué no se puede eliminar",
      "Trabajo que termina",
      "Ajustes eliminados",
      "Esta acción no se puede deshacer.",
      "Cancelar",
      "Eliminar",
      "Reintentar",
      "Comprobando qué cambiaría al eliminar este rol de personal…",
    ],
  ],
] as const)("writes every fixed line of the question in %s", (locale, lines) => {
  setLocale(locale);
  const copy = staffRoleDeleteCopy();
  expect([
    copy.heading,
    copy.refusals,
    copy.ends,
    copy.removes,
    copy.irreversible,
    copy.cancel,
    copy.confirm,
    copy.retry,
    copy.loading,
  ]).toEqual(lines);
});

it.each([
  [
    "en",
    "Removes 1 painted staffing block.",
    "Removes 4 painted staffing blocks.",
    "Removes it from 1 person: Ana.",
    "Removes it from 2 people: Ana, Marc.",
  ],
  [
    "es",
    "Quita 1 bloque de personal pintado.",
    "Quita 4 bloques de personal pintados.",
    "Se lo quita a 1 persona: Ana.",
    "Se lo quita a 2 personas: Ana, Marc.",
  ],
] as const)(
  "counts painted blocks and names holders in %s, one and several",
  (locale, oneBlock, blocks, oneHolder, holders) => {
    setLocale(locale);
    const { item } = staffRoleDeleteCopy();
    expect(item({ key: "staff_role_blocks", count: 1, targets: [] })).toBe(oneBlock);
    expect(item({ key: "staff_role_blocks", count: 4, targets: [] })).toBe(blocks);
    expect(item({ key: "staff_role_holders", count: 1, targets: [people[0]!] })).toBe(oneHolder);
    expect(item({ key: "staff_role_holders", count: 2, targets: people })).toBe(holders);
  },
);

it.each([
  ["en", "1 shift uses this staff role.", "3 shifts use this staff role."],
  ["es", "1 turno usa este rol de personal.", "3 turnos usan este rol de personal."],
] as const)("says how many shifts use the role in %s", (locale, one, several) => {
  setLocale(locale);
  const { refusal } = staffRoleDeleteCopy();
  const inUse = (shiftCount: number) =>
    refusal({
      code: "staff_role.in_use",
      params: { staffRoleId: "private-id", shiftCount },
      targets: [],
    });
  expect(inUse(1)).toBe(one);
  expect(inUse(3)).toBe(several);
});

it("does not read an item or a refusal it does not know as a staff role's", () => {
  setLocale("en");
  const { item, refusal } = staffRoleDeleteCopy();
  expect(item({ key: "something_else", count: 2, targets: people })).toBe("Ana, Marc (2)");
  expect(item({ key: "something_else", count: 2, targets: [] })).toBe("(2)");
  expect(refusal({ code: "staffing.invalid", params: { shiftCount: 3 }, targets: [] })).toBe(
    codeMessage("staffing.invalid"),
  );
});
