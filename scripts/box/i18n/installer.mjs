export const INSTALLER_WORDS = {
  es: {
    notice: "Este equipo ya tiene Waitron ({name}).",
    unknownName: "Nombre del local no disponible",
    unknownStatus: "Estado Live no disponible.",
    live: "Este disco está marcado como Live.",
    warning:
      "Una reinstalación borraría los datos, las copias de seguridad y el historial de este equipo. Para recuperar los datos del local necesitarías una copia externa o un equipo de reserva; este equipo iniciaría una nueva cadena fiscal.",
    countdown: "El equipo instalado se iniciará en 15 segundos. Pulsa cualquier tecla para pausar.",
    paused:
      "Reinstalar, borrar e inspeccionar la clave de recuperación no están disponibles. El equipo instalado se iniciará tras 120 segundos sin escribir.",
    keysUnavailable: "El teclado no está disponible; el inicio automático sigue activo.",
    failed: "No se puede iniciar el equipo instalado. Retira el USB y reinicia.",
  },
  en: {
    notice: "This box already has Waitron ({name}).",
    unknownName: "Venue name unavailable",
    unknownStatus: "Live status unavailable.",
    live: "This disk is marked Live.",
    warning:
      "A reinstall would erase this box’s data, backups and host history. Recovering venue data would require an external backup or spare box; this box would start a new fiscal chain.",
    countdown: "Starting the installed box in 15 seconds. Press any key to pause.",
    paused:
      "Reinstall, erase and recovery-key inspection are unavailable. Starting the installed box after 120 seconds without typing.",
    keysUnavailable: "Keys unavailable; automatic return remains active.",
    failed: "Cannot start the installed box. Remove the USB and restart.",
  },
};

export function formatInstallerNotice({ tag }) {
  return ["es", "en"]
    .map((language) => {
      const words = INSTALLER_WORDS[language];
      const lines = [words.notice.replace("{name}", tag?.name ?? words.unknownName)];
      if (tag === null) lines.push(words.unknownStatus);
      else if (tag.live) lines.push(words.live, words.warning);
      return lines.join("\n");
    })
    .join("\n");
}

export const INSTALLER_MESSAGES = Object.fromEntries(
  ["countdown", "paused", "keysUnavailable", "failed"].map((key) => [
    key,
    `${INSTALLER_WORDS.es[key]}\n${INSTALLER_WORDS.en[key]}\n`,
  ]),
);
