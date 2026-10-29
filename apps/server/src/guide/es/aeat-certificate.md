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
el certificado actual sigue instalado. Comprueba la conexión a internet o elige otro archivo o
tipo de certificado en el diálogo. Pulsa **Guardar** para repetir la comprobación. Pulsa
**Cancelar** para parar sin sustituir el certificado actual; si se pregunta por los cambios sin
guardar, elige **Descartar cambios** para cerrar. El código HTTP por sí solo no indica si esperar ayudará.

## Averigua qué ha observado una comprobación {#diagnosis}

Si repetir Guardar no explica el fallo, abre **Diagnosticar conexión** desde la ficha del certificado
en **Ajustes del local** o desde una sustitución rechazada. Abrir el panel no envía ninguna consulta.
Separa **Observado**, **Causa** y **Opciones**: un código HTTP o una conexión cerrada
no determinan por sí solos por qué ha fallado la solicitud.

## Elige qué vas a inspeccionar {#diagnosis-source}

Elige **Certificado instalado** para inspeccionar el material guardado actualmente en este servidor,
o **Sustitución elegida, sin instalar** para el archivo, la contraseña y el tipo que elijas aquí.
Confirma el origen y pulsa **Volver a leer**. Esta acción comprueba el material seleccionado
localmente, sin enviar una consulta de red. No sustituye tu archivo por el certificado instalado.

El **Registro de instalación guardado** describe una instalación anterior. Su tipo y su fecha no
son datos actuales verificados hasta que el panel indique que el material actual coincide con ese
registro. Tras una inspección local satisfactoria, puedes ver el entorno configurado, la etiqueta
del destino y el tipo del material actual. Un sello y un certificado de representante pueden usar
destinos distintos; cambiar el tipo aquí no cambia el entorno configurado del servidor.

## Identifícate al realizar la acción {#diagnosis-authority}

Si puedes leer la ficha pero no administrar el sistema, pulsa **Iniciar sesión con permiso para gestionar el sistema** o **Parar**. Al identificarte puedes cambiar la cuenta del panel. Después
de un cambio de cuenta o permisos, vuelve a elegir el archivo e introducir su contraseña, confirma
el origen y pulsa **Volver a leer**. Identificarte no reanuda una comprobación ni pulsa Guardar por ti.

## Interpreta el resultado con sus límites {#diagnosis-results}

Tras una inspección local satisfactoria, **Comprobar** envía una consulta de solo lectura con ese
material. No presenta facturas ni instala nada. **Comprobar de nuevo** inicia otro intento explícito;
el panel no reintenta automáticamente. Una consulta completada describe ese intento, no garantiza
que una presentación posterior vaya a funcionar. [Estado del servidor explica los registros
pendientes](box-status.md#retry-now).

La comprobación permite 30 segundos para abrir el archivo, conectar y leer la respuesta, y hasta
dos segundos más para cerrar los recursos. Una respuesta demasiado grande, un tiempo agotado,
una respuesta ilegible y una respuesta HTTP son observaciones distintas. Si el navegador pierde
la respuesta, el resultado no está disponible y no se ha determinado ninguna causa remota.
Puedes pulsar **Volver a leer** para una nueva inspección local o **Parar**.

Si el certificado instalado ha cambiado mientras tanto, pulsa **Parar y recargar la ficha guardada**.
Esta acción cierra el diagnóstico y realiza una lectura normal de la ficha con tu sesión iniciada.
Vuelve a abrir el diagnóstico, confirma el origen e inspecciona antes de comprobar otra vez.
**Volver a leer** no puede reutilizar la revisión antigua.

## Para, copia o elige una sustitución {#diagnosis-stop}

**Parar**, o Escape, cancela el intento y cierra el panel. El diagnóstico deja sin cambios el
certificado instalado y los registros fiscales. **Copiar datos observados** copia un resumen limitado
del diagnóstico cuando lo eliges; excluye el archivo, la contraseña y los datos de identidad del certificado.

Usa **Sustituir certificado** o **Cambiar archivo o tipo** para volver al editor separado.
Solo **Guardar**, en ese editor, puede instalar una sustitución tras realizar sus propias comprobaciones.
Este panel no repara la configuración de red del servidor ni un rechazo externo persistente.
Su evidencia te ayuda a elegir el siguiente paso, pero otra comprobación idéntica no es una reparación.
