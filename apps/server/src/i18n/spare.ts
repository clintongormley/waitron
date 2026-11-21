import type { SupportedLocale } from "@waitron/shared";

export const SPARE_WORDS: Record<
  SupportedLocale,
  {
    title: string;
    body: string;
    openMain: string;
    /** The message of an API caller's `node.spare` refusal. */
    refusal: string;
    mainBack: string;
    mainSilent: string;
    openSwitch: string;
    mainUnreached: string;
  }
> = {
  "en-GB": {
    title: "This is the venue’s spare box",
    body: "It keeps a copy and takes over if the main box fails.",
    openMain: "Open the main box",
    refusal: "This is the venue’s spare box. Use the main box.",
    mainBack: "The main box is answering again. This page reloads in a few seconds.",
    mainSilent: "The main box has not answered for {duration}.",
    openSwitch: "Open the switch page",
    mainUnreached:
      "This spare cannot reach the main box, so it could not take over if the main box failed. Check the network cable of each box.",
  },
  "es-ES": {
    title: "Este es el servidor de reserva del local",
    body: "Guarda una copia y sustituye al principal si falla.",
    openMain: "Abrir el servidor principal",
    refusal: "Este es el servidor de reserva del local. Usa el servidor principal.",
    mainBack: "El servidor principal vuelve a responder. Esta página se recarga en unos segundos.",
    mainSilent: "El servidor principal no responde desde hace {duration}.",
    openSwitch: "Abrir la página de cambio",
    mainUnreached:
      "Este servidor de reserva no llega al principal, así que no podría sustituirlo si fallara. Revisa el cable de red de cada servidor.",
  },
};
