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
    "3 products fire earliest.",
    "1 product fires earliest.",
    "Delete",
    "Cancel",
  ],
  [
    "es-ES",
    "Eliminar curso",
    "Esta acción no se puede deshacer.",
    "3 productos se preparan primero.",
    "1 producto se prepara primero.",
    "Eliminar",
    "Cancelar",
  ],
])(
  "shows concise permanent deletion copy in %s",
  (locale, heading, irreversible, products, oneProduct, confirm, cancel) => {
    setLocale(locale!);
    const copy = courseDeleteCopy();
    expect([
      copy.heading,
      copy.irreversible,
      copy.item({ key: "course_products", count: 3, targets: [] }),
      copy.item({ key: "course_products", count: 1, targets: [] }),
      copy.confirm,
      copy.cancel,
    ]).toEqual([heading, irreversible, products, oneProduct, confirm, cancel]);
  },
);
