import type { SupportedLocale } from "@waitron/shared";

export const SPARE_WORDS: Record<SupportedLocale, { title: string; body: string; status: string }> =
  {
    "en-GB": {
      title: "This box is the spare",
      body: "Open the main box's address for restaurant screens and data.",
      status: "This box is not taking sales.",
    },
    "es-ES": {
      title: "Este es el equipo de reserva",
      body: "Abre la dirección del equipo principal para acceder a las pantallas y los datos del local.",
      status: "Este equipo no acepta ventas.",
    },
  };
