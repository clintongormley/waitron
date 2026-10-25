# Elige un certificado que la configuración pueda usar

Para un local español en modo real, elige tu archivo de certificado `.pfx` o `.p12` e introduce la
contraseña que usaste al exportarlo. Demo y Preparación no piden este certificado.

## Corrige un archivo rechazado {#refusals}

La configuración comprueba el archivo antes de ejecutar la prueba fiscal o crear el local. Una
contraseña incorrecta se explica bajo **Contraseña del certificado**. Si el archivo no se puede
abrir, usa el antiguo cifrado RC2, no incluye la clave privada, ha caducado o aún no
es válido, la explicación aparece bajo **Archivo del certificado**.

Corrige la contraseña o elige otro archivo, pulsa **Siguiente** y repite la prueba fiscal. Si falta
la clave privada o el cifrado es antiguo, exporta de nuevo el certificado con su clave privada y un
cifrado moderno. Las instrucciones de exportación están en la pantalla del certificado.

Si se rechaza el certificado al terminar una configuración interrumpida, corrígelo primero. Después
se te pedirá que confirmes de nuevo que eres quien inició la configuración antes de continuar.

## Repite una comprobación en Ajustes del local {#dashboard-check}

Si al sustituir un certificado aparece un error HTTP o un fallo inesperado en la comprobación,
el certificado actual sigue instalado. Pide al administrador del equipo que revise su conexión
con la AEAT y pulsa **Guardar** de nuevo. El código HTTP por sí solo no indica si esperar ayudará.
