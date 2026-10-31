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
    reachedNotStarted: "did not start activation",
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
    recoveryStoppedRecover:
      "A recovery from backup started on {started} and did not finish. Recover from backup deletes it first.",
    recoveryStoppedCloud:
      "Its approval in Waitron Cloud closes by itself within an hour of when it was given. Until then, Waitron Cloud cannot approve a new recovery for this box's venue.",
    recoveryUnreadable: "This box found a recovery from backup whose records cannot be read.",
    checkAgain: "Check again",
    recoveryDetailsUnread:
      "This box could not read the details of the recovery from backup. Check again.",
    missingConfirm: "Nothing was filed to AEAT and nothing was sold.",
    uncheckable: "This box cannot check the original setup password, so Continue is not offered.",
    finish: "Finish setup",
    finishReview: "Check the saved details.",
    finishEmail: "Re-enter the email settings used for this setup.",
    finishHelp: "Re-enter the certificate and email settings used for this setup.",
    startAgain: "Start again",
    recoveryRecordDamaged: "This setup's recovery-key record is damaged and cannot be read.",
    retireConfirmed: "Delete the old attempt and start again.",
    cancel: "Cancel",
    restarting: "The old attempt is deleted. Reconnect to continue.",
    heldLost: "Start again deletes what was entered in the setup that stopped part way.",
    noInvoiceSent: "No invoice was sent to AEAT.",
    recoverDeletes:
      "Recover from backup first deletes what was entered in the setup that stopped part way.",
    recoverThen: "Then you choose the backup.",
    retireRecover: "Delete the old attempt and recover from a backup.",
    heldChanged: "The setup changed after this page read it. Try again.",
    keptFault:
      "The setup database holds records that Waitron never deletes. An unfinished setup should hold none, so this is a fault in Waitron. Deleting this setup is not offered. Reconnect keeps everything as it is.",
    wipeUnavailable:
      "This box cannot confirm that deleting this setup is safe, so it is not offered. Reconnect keeps everything as it is.",
    setupDatabaseUnreadable: "The previous setup process was unsuccessful.",
    tradingSaved:
      "This setup already saved the settings the box sells with, so deleting it is not offered.",
    tradingSavedPassword: "To finish it, continue with your setup password.",
    setupFinished:
      "This setup already finished, so deleting it is not offered. Reconnect to check the saved result.",
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
    reachedNotStarted: "no empezó la activación",
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
    recoveryStoppedRecover:
      "Una recuperación desde una copia, iniciada el {started}, no terminó. Recuperar desde una copia la borra primero.",
    recoveryStoppedCloud:
      "Su aprobación en Waitron Cloud se cierra sola en menos de una hora desde que se dio. Hasta entonces, Waitron Cloud no puede aprobar otra recuperación para el local de este equipo.",
    recoveryUnreadable:
      "Este equipo encontró una recuperación desde una copia cuyos registros no se pueden leer.",
    checkAgain: "Comprobar otra vez",
    recoveryDetailsUnread:
      "Este equipo no pudo leer los datos de la recuperación desde una copia. Comprueba otra vez.",
    missingConfirm: "No se envió nada a la AEAT ni se vendió nada.",
    uncheckable:
      "Este equipo no puede comprobar la contraseña original de configuración, así que no se ofrece Continuar.",
    finish: "Finalizar configuración",
    finishReview: "Comprueba los datos guardados.",
    finishEmail: "Vuelve a introducir los ajustes de correo usados en esta configuración.",
    finishHelp:
      "Vuelve a introducir el certificado y los ajustes de correo usados en esta configuración.",
    startAgain: "Empezar de nuevo",
    recoveryRecordDamaged:
      "El registro de la clave de recuperación de esta configuración está dañado y no se puede leer.",
    retireConfirmed: "Borrar el intento anterior y empezar de nuevo.",
    cancel: "Cancelar",
    restarting: "El intento anterior se ha borrado. Reconecta para continuar.",
    heldLost:
      "Empezar de nuevo borra lo que se introdujo en la configuración que se detuvo a medias.",
    noInvoiceSent: "No se envió ninguna factura a la AEAT.",
    recoverDeletes:
      "Recuperar desde una copia primero borra lo que se introdujo en la configuración que se detuvo a medias.",
    recoverThen: "Después eliges la copia.",
    retireRecover: "Borrar el intento anterior y recuperar desde una copia.",
    heldChanged:
      "La configuración cambió después de que esta página la leyera. Inténtalo otra vez.",
    keptFault:
      "La base de datos de configuración guarda registros que Waitron nunca borra. Una configuración sin terminar no debería tener ninguno, así que es un fallo de Waitron. No se ofrece borrar esta configuración. Reconectar lo deja todo como está.",
    wipeUnavailable:
      "Este equipo no puede confirmar que borrar esta configuración sea seguro, así que no se ofrece. Reconectar lo deja todo como está.",
    setupDatabaseUnreadable: "El proceso de configuración anterior no tuvo éxito.",
    tradingSaved:
      "Esta configuración ya guardó los ajustes con los que vende el equipo, así que no se ofrece borrarla.",
    tradingSavedPassword: "Para terminarla, continúa con tu contraseña de configuración.",
    setupFinished:
      "Esta configuración ya terminó, así que no se ofrece borrarla. Reconecta para comprobar el resultado guardado.",
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
