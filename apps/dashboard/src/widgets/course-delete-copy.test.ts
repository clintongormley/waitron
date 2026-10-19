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
    "1 service step that starts when it is served.",
    "2 service steps that start when it is served.",
    "1 service step now starts When seated.",
    "2 service steps now start When seated.",
    "1 product fires earliest.",
  ],
  [
    "es-ES",
    "1 paso de servicio que empieza al servirlo.",
    "2 pasos de servicio que empiezan al servirlo.",
    "1 paso de servicio pasa a empezar Al sentarse.",
    "2 pasos de servicio pasan a empezar Al sentarse.",
    "1 producto se prepara primero.",
  ],
])(
  "says which service steps go and which now start When seated in %s",
  (locale, oneStep, steps, oneSeated, seated, oneProduct) => {
    setLocale(locale!);
    const copy = courseDeleteCopy();
    expect([
      copy.item({ key: "course_service_steps", count: 1, targets: [] }),
      copy.item({ key: "course_service_steps", count: 2, targets: [] }),
      copy.item({ key: "course_seated_steps", count: 1, targets: [] }),
      copy.item({ key: "course_seated_steps", count: 2, targets: [] }),
      copy.item({ key: "course_products", count: 1, targets: [] }),
    ]).toEqual([oneStep, steps, oneSeated, seated, oneProduct]);
  },
);
