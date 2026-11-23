import { afterEach, expect, it } from "vitest";
import { currentLocale, setLocale } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
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

it.each([
  [
    "en-GB",
    "1 service step that starts when it is served.",
    "2 service steps that start when it is served or follow those steps.",
    "1 product fires earliest.",
  ],
  [
    "es-ES",
    "1 paso de servicio que empieza al servirlo.",
    es["kitchen.delete_course_service_steps"].replace("{count}", "2"),
    "1 producto se prepara primero.",
  ],
])(
  "names removed service steps and their followers in %s",
  (locale, oneStep, steps, oneProduct) => {
    setLocale(locale!);
    const copy = courseDeleteCopy();
    expect([
      copy.item({ key: "course_service_steps", count: 1, targets: [] }),
      copy.item({ key: "course_service_steps", count: 2, targets: [] }),
      copy.item({ key: "course_products", count: 1, targets: [] }),
    ]).toEqual([oneStep, steps, oneProduct]);
  },
);

it.each([
  ["en-GB", "1 set-menu line loses this course.", "2 dishes return to their product's course."],
  ["es-ES", "1 línea de un menú pierde este curso.", "2 platos vuelven al curso de su producto."],
])("explains removed set-menu course choices in %s", (locale, line, dishes) => {
  setLocale(locale);
  const copy = courseDeleteCopy();
  expect(copy.item({ key: "course_set_menu_lines", count: 1, targets: [] })).toBe(line);
  expect(copy.item({ key: "course_set_menu_dishes", count: 2, targets: [] })).toBe(dishes);
});
