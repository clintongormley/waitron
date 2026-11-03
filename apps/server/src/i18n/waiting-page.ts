import type { SupportedLocale } from "@waitron/shared";

/** The words of the page a box serves while it waits for its peers (`../waiting-page.ts`). */
export const WAITING_PAGE_WORDS: Readonly<
  Record<
    SupportedLocale,
    {
      /** The title's words before and after the other box's name. */
      title: readonly [string, string];
      /** The body's words around the other box's name. */
      body: readonly [string, string];
      /** Named when the check said which boxes it waited for and none could be named. */
      otherBox: string;
    }
  >
> = {
  "en-GB": {
    title: ["This box is waiting for ", ""],
    body: [
      "It will not take sales or send anything to the tax agency until it knows whether ",
      " has taken over. It checks again every 15 seconds.",
    ],
    otherBox: "the other box",
  },
  "es-ES": {
    title: ["Este equipo está esperando a ", ""],
    body: [
      "No hará ventas ni enviará nada a Hacienda hasta saber si ",
      " ha pasado a llevar el local. Vuelve a comprobarlo cada 15 segundos.",
    ],
    otherBox: "el otro equipo",
  },
};
