import { afterEach, expect, it } from "vitest";
import { currentLocale, setLocale } from "../i18n/t.js";
import { courseDeleteCopy } from "./course-delete-copy.js";
const before = currentLocale();
afterEach(() => setLocale(before));
it.each([
  [
    "en-GB",
    "Delete course",
    "This can't be undone.",
    "3 products will fire earliest.",
    "Delete",
    "Cancel",
  ],
  [
    "es-ES",
    "Eliminar curso",
    "Esta acción no se puede deshacer.",
    "3 productos se prepararán primero.",
    "Eliminar",
    "Cancelar",
  ],
])(
  "shows concise permanent deletion copy in %s",
  (locale, heading, irreversible, products, confirm, cancel) => {
    setLocale(locale!);
    const copy = courseDeleteCopy();
    expect([
      copy.heading,
      copy.irreversible,
      copy.item({ key: "course_products", count: 3, targets: [] }),
      copy.confirm,
      copy.cancel,
    ]).toEqual([heading, irreversible, products, confirm, cancel]);
    expect(copy.item({ key: "course_products", count: 1, targets: [] })).toContain("1");
  },
);
