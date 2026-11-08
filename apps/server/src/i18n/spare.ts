import type { SupportedLocale } from "@waitron/shared";

export const SPARE_WORDS: Record<SupportedLocale, { title: string; body: string; status: string }> =
  {
    "en-GB": {
      title: "Restaurant screens are closed here",
      body: "Open the main box's address for restaurant screens and data.",
      status: "This box started as the spare and is not taking sales.",
    },
    "es-ES": {
      title: "Las pantallas del local están cerradas aquí",
      body: "Abre la dirección del equipo principal para acceder a las pantallas y los datos del local.",
      status: "Este equipo se ha iniciado como reserva y no acepta ventas.",
    },
  };
