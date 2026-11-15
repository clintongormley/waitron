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

it.each([
  [
    "en-GB",
    "1 service step that starts from it or follows another step.",
    "2 service steps that start from it or their following steps.",
    "1 product fires earliest.",
  ],
  [
    "es-ES",
    "1 paso de servicio que empieza al servirlo o tras otro paso.",
    "2 pasos de servicio que empiezan al servirlo o tras esos pasos.",
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
