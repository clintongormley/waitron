/** The words of the `/legal/*` pages (`../declaration-pages.ts`). The declaration itself is Spanish only. */
export const DECLARATION_PAGE_WORDS = {
  en: {
    noneTitle: "This build has no declaración responsable",
    none: "Only a released version of Waitron carries one, and this build is not a release.",
    damagedTitle: "This box's declaración responsable cannot be shown",
    damaged: "One of its files is missing or damaged.",
    notFoundTitle: "Page not found",
  },
  es: {
    noneTitle: "Esta compilación no tiene declaración responsable",
    none: "Solo las versiones publicadas de Waitron llevan una, y esta compilación no lo es.",
    damagedTitle: "La declaración responsable de este equipo no se puede mostrar",
    damaged: "Falta uno de sus archivos o está dañado.",
    notFoundTitle: "Página no encontrada",
  },
} as const;

/** Spanish in every interface language. */
export const DECLARATION_LINK_WORDS = {
  title: "Declaración responsable",
  downloadPdf: "Descargar PDF",
  downloadText: "Descargar texto",
  earlierTitle: "Versiones anteriores",
} as const;
