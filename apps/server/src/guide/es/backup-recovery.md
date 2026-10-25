# Recuperar desde una copia

## Si se interrumpió la primera configuración {#interrupted-setup}

Si la página de reparación no permite continuar, elige **Recuperar desde una copia**. Puedes usar
esta opción aunque no se pueda comprobar la contraseña anterior. Necesitas la clave de recuperación
del nodo indicada en la copia elegida. El intento anterior y sus archivos se conservan en sus propias
carpetas; abrir una copia no da acceso a esos registros locales.

Usa la conexión segura del equipo. Si el navegador no confía en ella, elige primero **Configurar
conexión segura** en la página de reparación. **Comprobar de nuevo** vuelve a leer la conexión
sin repararla. **Detener** finaliza este intento; puedes cerrar la pestaña o comprobar de nuevo.
Si la reparación sigue fallando, detente aquí. Esta página no puede reparar todos los archivos
de certificados guardados ni sustituir un certificado instalado por separado. Para uno instalado
por separado, comprueba la dirección HTTPS del servidor y detente si muestra un aviso. Si tu
dispositivo bloquea la instalación del certificado, usa uno del local que la permita. Introduce
contraseñas y claves de recuperación solo cuando HTTPS se abra sin avisos.

Apaga la caja anterior y coordínate con los otros locales: solo una persona debe recuperar este contribuyente a la vez.

## Elige tu copia {#source}

Elige **Archivo de copia**, **Copia del bucket** o **Copia de Cloud** y el entorno correspondiente.
Para un archivo, selecciónalo e introduce su clave. Para una copia del bucket, pega su kit de
recuperación. Para Cloud, pide la aprobación, apruébala en Cloud y compruébala aquí. La recuperación
de Cloud requiere un servicio compatible; esta opción no habilita la recuperación de Cloud en producción.

La clave del archivo, las credenciales del bucket y la aprobación de Cloud dan acceso a una copia.
También necesitas la clave de recuperación de su nodo para identificarte. Mantén separados producción
y preproducción.

## Identifícate ante la copia elegida {#proof}

Introduce la clave agrupada de la hoja que conservaste para esta copia, o elige su PDF de
recuperación guardado. Una hoja nueva con una clave de sustitución puede no abrir una copia anterior.

Confirma que la caja anterior seguirá desconectada y que eres la única persona recuperando este
contribuyente. Elige **Abrir copia**. Solo después de aceptar la clave, la página muestra el
contribuyente, el local, la fecha y el nombre de la clave de la copia. Compruébalos antes de continuar.

Abrir una copia pausa la configuración normal aunque se rechace la clave. Puedes reintentar aquí
la recuperación. Para volver a la configuración normal, reinicia el equipo; volver atrás o recargar
la página no la reanuda.

Si **Copias** no puede confirmar la clave guardada, conserva tanto la clave anterior como la que
acabas de guardar. Al cambiar una clave, aún puedes copiar o descargar ambas claves mostradas
tras este rechazo. No sigas cambiando claves y sal de la página sin volver a enviar. Esta página
no puede diagnosticar el conflicto de configuración ni confirmar qué clave abre una copia concreta;
no sustituyas ninguno de los dos registros de claves basándote en este mensaje.

## Crea las nuevas series {#series}

Usa los controles bajo los datos autenticados. Vuelve a introducir la clave correspondiente, confirma
las condiciones de recuperación y elige **Comparar relojes**. Sigue las instrucciones sobre relojes
y esperas; no hay ningún código de instalación que escribir. Elige **Recuperar** cuando se hayan
elegido las nuevas series.

Una clave que abre la copia no evita las comprobaciones del historial y del reloj. Si una comprobación
lo impide, resuelve la causa e inténtalo de nuevo. No borres el intento conservado ni edites sus
registros de recuperación.

## Continúa después de una interrupción {#resume}

Al salir de la página o reiniciar el equipo se pierde la identificación del navegador. Vuelve a
introducir la clave para continuar. Si la preparación se detuvo antes de colocar los datos, vuelve
a abrir el mismo origen. Cuando aparezca **Finalizar recuperación guardada**, úsala para identificarte
ante el destino conservado y completar esa misma recuperación. Conserva el evento y la selección guardados.
Si la recuperación ya está guardada, reconecta con el equipo en lugar de volver a identificarte o colocarla.

Cambiar el origen o el entorno vacía los controles autenticados de la página. No borra la operación
guardada ni elige otra copia para ella. Después de **Recuperación guardada**, reconecta con el equipo.
Si el resultado es incierto, conserva los archivos e investiga antes de iniciar otra recuperación.
