import type { SupportedLocale } from "@waitron/shared";

export const SPARE_WORDS: Record<
  SupportedLocale,
  {
    title: string;
    body: string;
    status: string;
    mainBack: string;
    mainSilent: string;
    openSwitch: string;
    mainUnreached: string;
  }
> = {
  "en-GB": {
    title: "Restaurant screens are closed here",
    body: "Open the main server's address for restaurant screens and data.",
    status: "This server started as the spare and is not taking sales.",
    mainBack: "The main server is answering again. This page reloads in a few seconds.",
    mainSilent: "The main server has not answered for {duration}.",
    openSwitch: "Open the switch page",
    mainUnreached:
      "This spare cannot reach the main server, so it could not take over if the main server failed. Check the network cable of each server.",
  },
  "es-ES": {
    title: "Las pantallas del local están cerradas aquí",
    body: "Abre la dirección del servidor principal para acceder a las pantallas y los datos del local.",
    status: "Este servidor se ha iniciado como reserva y no acepta ventas.",
    mainBack: "El servidor principal vuelve a responder. Esta página se recarga en unos segundos.",
    mainSilent: "El servidor principal no responde desde hace {duration}.",
    openSwitch: "Abrir la página de cambio",
    mainUnreached:
      "Este servidor de reserva no llega al principal, así que no podría sustituirlo si fallara. Revisa el cable de red de cada servidor.",
  },
};
