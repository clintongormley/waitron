export const initialOwnerStrings = {
  en: {
    heading: "First setup",
    waiting: "Saving setup ownership…",
    resume: "Resume setup",
    password: "Administrator password",
    required: "Enter your password.",
    resumeHelp:
      "Use the original setup tab and its administrator password. Losing that tab’s saved proof needs incident resolution.",
    abandon: "Abandon this attempt",
    replace: "Enter new setup details",
    retired: "This attempt is abandoned. Its history is retained.",
    consumed:
      "This assignment may have been used. Keep it consumed and resolve the incident before starting again.",
    complete: "Setup is complete. Reconnect to the box.",
    reconnect: "Reconnect",
    error: "Reconnect to check the saved result. Do not repeat activation.",
    scope: "Setup details are frozen. Abandon this attempt before changing them.",
    fix: "Correct the highlighted field.",
  },
  es: {
    heading: "Primera configuración",
    waiting: "Guardando titularidad de configuración…",
    resume: "Reanudar configuración",
    password: "Contraseña de administrador",
    required: "Introduce tu contraseña.",
    resumeHelp:
      "Usa la pestaña original y su contraseña de administrador. Si pierdes la prueba guardada de esa pestaña, hay que resolver la incidencia.",
    abandon: "Abandonar este intento",
    replace: "Introducir nuevos datos",
    retired: "Intento abandonado. Su historial se conserva.",
    consumed:
      "Esta asignación puede haberse usado. Consérvala como consumida y resuelve la incidencia antes de empezar de nuevo.",
    complete: "Configuración completa. Reconecta con el equipo.",
    reconnect: "Reconectar",
    error: "Reconecta para comprobar el resultado guardado. No repitas la activación.",
    scope: "Los datos están fijados. Abandona este intento antes de cambiarlos.",
    fix: "Corrige el campo señalado.",
  },
} as const;
