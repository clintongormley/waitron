export const initialOwnerStrings = {
  en: {
    heading: "First setup",
    recoverBackup: "Recover from backup",
    waiting: "Saving setup ownership…",
    resume: "Continue with your setup password",
    password: "Administrator password",
    required: "Enter your password.",
    resumeHelp: "Enter the administrator password you chose during setup.",
    interrupted: "First setup was interrupted",
    missingDatabase: "The setup database is missing.",
    missingAsk:
      "This box cannot check whether this setup filed anything to AEAT or made a sale. Its record says it:",
    reachedName: "chose the invoice series name {name}",
    reachedNoName: "chose no invoice series name",
    reachedFiscalStarted: "started activation, with no record that it finished",
    reachedFiscalFinished: "finished activation",
    missingBackup: "If you have a backup, recover from it.",
    recoveryRunning: "A recovery from backup is in progress on another device (started {started}).",
    recoveryLastActive: "Last active: {at}.",
    recoveryLastSaved: "Last saved step: {at}.",
    recoveryRunningNext: "If it stops before it finishes, you can start again here.",
    recoveryStopped:
      "A recovery from backup started on {started} and did not finish. Start again deletes it.",
    recoveryStoppedRefused: "A recovery from backup started on {started} and did not finish.",
    recoveryStoppedCloud:
      "Its approval in Waitron Cloud closes by itself within an hour of when it was given. Until then, Waitron Cloud cannot approve a new recovery for this box's venue.",
    recoveryUnreadable: "This box found a recovery from backup whose records cannot be read.",
    checkAgain: "Check again",
    recoveryDetailsUnread:
      "This box could not read the details of the recovery from backup. Check again.",
    missingConfirm: "Nothing was filed to AEAT and nothing was sold.",
    uncheckable: "This box cannot check the original setup password. Keep its files for recovery.",
    finish: "Finish setup",
    finishReview: "Check the saved details.",
    finishEmail: "Re-enter the email settings used for this setup.",
    finishHelp: "Re-enter the certificate and email settings used for this setup.",
    startAgain: "Start again",
    recoveryRecordDamaged: "This setup's recovery-key record is damaged and cannot be read.",
    damagedRecordPassword:
      "To start again, enter the administrator password you chose during setup.",
    startAgainHelp: "Deletes this attempt. This box will not use its invoice series names again.",
    seriesPicksDamaged:
      "This box's record of the invoice series names it chose is damaged and cannot be read.",
    publicRecordDamaged: "This setup's public fiscal record is damaged and cannot be read.",
    fiscalDocumentsDamaged:
      "This setup's fiscal documents on this box are damaged and cannot be read.",
    namesFrom: "New series names can start from {date}, {time}.",
    retireConfirmed: "Delete the old attempt and start again.",
    cancel: "Cancel",
    restarting: "The old attempt is deleted. Reconnect to continue.",
    startUnavailable:
      "Start again without a password is available only when the box can verify an unused, empty setup.",
    startUnavailableOccupied:
      "Start again is not available: this setup's database already holds records, and Start again deletes only a setup that holds none.",
    heldRows: "The setup database already holds {rows} saved items.",
    heldRowsOne: "The setup database already holds 1 saved item.",
    heldNoInvoices: "None of them is an invoice, so no invoice was sent to AEAT.",
    heldNoInvoicesOne: "It is not an invoice, so no invoice was sent to AEAT.",
    heldLost:
      "Start again deletes them with this attempt. You will enter this setup's details again.",
    heldKept: "It holds {kept} items that Waitron never deletes.",
    heldKeptOne: "It holds 1 item that Waitron never deletes.",
    heldInvoices: "{records} of them are invoices; AEAT accepted {accepted}.",
    heldInvoiceOne: "1 of them is an invoice; AEAT accepted {accepted}.",
    heldFault:
      "An unfinished setup should hold none of these, so this is a fault in Waitron. Start again would delete them, so it is not offered. Reconnect keeps everything as it is.",
    tradingSaved:
      "This setup already saved the settings the box trades with. Start again would delete a setup that is ready to trade, so it is not offered here.",
    tradingSavedPassword: "Enter your setup password to see what is left to do.",
    setupFinished:
      "This setup already finished. Start again would delete a finished setup, so it is not offered. Reconnect to check the saved result.",
    abandon: "Abandon this attempt",
    replace: "Enter new setup details",
    retired: "This attempt is abandoned. Its history is retained.",
    consumed:
      "This assignment may have been used. Keep it consumed and resolve the incident before starting again.",
    complete: "Setup is complete. Reconnect to the box.",
    reconnect: "Reconnect",
    secureConnection: "Set up secure connection",
    error: "Reconnect to check the saved result. Do not repeat activation.",
    scope: "Setup details are frozen. Abandon this attempt before changing them.",
    fix: "Correct the highlighted field.",
  },
  es: {
    heading: "Primera configuración",
    recoverBackup: "Recuperar desde una copia",
    waiting: "Guardando titularidad de configuración…",
    resume: "Continuar con tu contraseña de configuración",
    password: "Contraseña de administrador",
    required: "Introduce tu contraseña.",
    resumeHelp: "Introduce la contraseña de administrador que elegiste al configurar.",
    interrupted: "La configuración inicial se interrumpió",
    missingDatabase: "Falta la base de datos de configuración.",
    missingAsk:
      "Este equipo no puede comprobar si esta configuración envió algo a la AEAT o hizo alguna venta. Su registro dice que:",
    reachedName: "eligió el nombre de serie de facturas {name}",
    reachedNoName: "no eligió ningún nombre de serie de facturas",
    reachedFiscalStarted: "empezó la activación, sin constancia de que terminara",
    reachedFiscalFinished: "terminó la activación",
    missingBackup: "Si tienes una copia, recupera desde ella.",
    recoveryRunning:
      "Hay una recuperación en curso en otro dispositivo, desde una copia (iniciada el {started}).",
    recoveryLastActive: "Última actividad: {at}.",
    recoveryLastSaved: "Último paso guardado: {at}.",
    recoveryRunningNext: "Si se detiene antes de terminar, podrás empezar de nuevo aquí.",
    recoveryStopped:
      "Una recuperación desde una copia, iniciada el {started}, no terminó. Empezar de nuevo la borra.",
    recoveryStoppedRefused: "Una recuperación desde una copia, iniciada el {started}, no terminó.",
    recoveryStoppedCloud:
      "Su aprobación en Waitron Cloud se cierra sola en menos de una hora desde que se dio. Hasta entonces, Waitron Cloud no puede aprobar otra recuperación para el local de este equipo.",
    recoveryUnreadable:
      "Este equipo encontró una recuperación desde una copia cuyos registros no se pueden leer.",
    checkAgain: "Comprobar otra vez",
    recoveryDetailsUnread:
      "Este equipo no pudo leer los datos de la recuperación desde una copia. Comprueba otra vez.",
    missingConfirm: "No se envió nada a la AEAT ni se vendió nada.",
    uncheckable:
      "Este equipo no puede comprobar la contraseña original. Conserva sus archivos para recuperarlo.",
    finish: "Finalizar configuración",
    finishReview: "Comprueba los datos guardados.",
    finishEmail: "Vuelve a introducir los ajustes de correo usados en esta configuración.",
    finishHelp:
      "Vuelve a introducir el certificado y los ajustes de correo usados en esta configuración.",
    startAgain: "Empezar de nuevo",
    recoveryRecordDamaged:
      "El registro de la clave de recuperación de esta configuración está dañado y no se puede leer.",
    damagedRecordPassword:
      "Para empezar de nuevo, introduce la contraseña de administrador que elegiste al configurar.",
    startAgainHelp:
      "Borra este intento. Este equipo no volverá a usar sus nombres de serie de facturas.",
    seriesPicksDamaged:
      "El registro de los nombres de serie de facturas que eligió este equipo está dañado y no se puede leer.",
    publicRecordDamaged:
      "El registro fiscal público de esta configuración está dañado y no se puede leer.",
    fiscalDocumentsDamaged:
      "Los documentos fiscales de esta configuración en este equipo están dañados y no se pueden leer.",
    namesFrom: "Los nuevos nombres de serie podrán empezar el {date} a las {time}.",
    retireConfirmed: "Borrar el intento anterior y empezar de nuevo.",
    cancel: "Cancelar",
    restarting: "El intento anterior se ha borrado. Reconecta para continuar.",
    startUnavailable:
      "Solo puedes empezar sin contraseña si el equipo verifica que la configuración está vacía y sin usar.",
    startUnavailableOccupied:
      "Empezar de nuevo no está disponible: la base de datos de esta configuración ya tiene registros, y Empezar de nuevo solo borra una configuración que no tiene ninguno.",
    heldRows: "La base de datos de configuración ya guarda {rows} elementos.",
    heldRowsOne: "La base de datos de configuración ya guarda 1 elemento.",
    heldNoInvoices: "Ninguno es una factura, así que no se envió ninguna factura a la AEAT.",
    heldNoInvoicesOne: "No es una factura, así que no se envió ninguna factura a la AEAT.",
    heldLost:
      "Empezar de nuevo los borra junto con este intento. Tendrás que volver a introducir los datos de esta configuración.",
    heldKept: "Tiene {kept} elementos que Waitron nunca borra.",
    heldKeptOne: "Tiene 1 elemento que Waitron nunca borra.",
    heldInvoices: "{records} son facturas; la AEAT aceptó {accepted}.",
    heldInvoiceOne: "1 es una factura; la AEAT aceptó {accepted}.",
    heldFault:
      "Una configuración sin terminar no debería tener ninguno, así que es un fallo de Waitron. Empezar de nuevo los borraría, así que no se ofrece. Reconectar lo deja todo como está.",
    tradingSaved:
      "Esta configuración ya guardó los ajustes con los que vende el equipo. Empezar de nuevo borraría una configuración lista para vender, así que no se ofrece aquí.",
    tradingSavedPassword: "Introduce tu contraseña de configuración para ver qué falta.",
    setupFinished:
      "Esta configuración ya terminó. Empezar de nuevo borraría una configuración terminada, así que no se ofrece. Reconecta para comprobar el resultado guardado.",
    abandon: "Abandonar este intento",
    replace: "Introducir nuevos datos",
    retired: "Intento abandonado. Su historial se conserva.",
    consumed:
      "Esta asignación puede haberse usado. Consérvala como consumida y resuelve la incidencia antes de empezar de nuevo.",
    complete: "Configuración completa. Reconecta con el equipo.",
    reconnect: "Reconectar",
    secureConnection: "Configurar conexión segura",
    error: "Reconecta para comprobar el resultado guardado. No repitas la activación.",
    scope: "Los datos están fijados. Abandona este intento antes de cambiarlos.",
    fix: "Corrige el campo señalado.",
  },
} as const;

export function namesFromText(locale: string, floorMs: number, timeZone?: string): string {
  const at = new Date(floorMs);
  const unbroken = (text: string) => text.replaceAll(" ", "\u00a0");
  return initialOwnerStrings[locale.startsWith("es") ? "es" : "en"].namesFrom
    .replace("{date}", unbroken(at.toLocaleDateString(locale, { dateStyle: "medium", timeZone })))
    .replace("{time}", unbroken(at.toLocaleTimeString(locale, { timeStyle: "short", timeZone })));
}
