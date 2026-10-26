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

Mientras hay una recuperación desde una copia en curso en otro dispositivo, la página de reparación
lo indica, con cuándo empezó y cuándo tuvo actividad por última vez. Hasta que se detenga, la página
solo ofrece **Reconectar** y **Configurar conexión segura**, y lo vuelve a comprobar sola. Una
recuperación cuenta como en curso mientras alguno de sus pasos está en marcha y durante los cinco
minutos siguientes a su última actividad. Esos cinco minutos terminan antes si la recuperación falla
o el equipo se reinicia.

Si una recuperación desde una copia empezó y no terminó, la página de reparación lo indica, y
**Empezar de nuevo** la borra junto con la configuración interrumpida. Junto a ella, la página no
ofrece **Recuperar desde una copia**. Si la página dice que falta la base de datos de configuración,
muestra la recuperación detenida después de que introduzcas la contraseña de administrador que
elegiste al configurar, y Empezar de nuevo la borra cuando marcas «No se envió nada a la AEAT ni se
vendió nada.» y vuelves a elegir **Empezar de nuevo**. Si no, la página muestra **Empezar de nuevo**
junto a la recuperación detenida, disponible solo si el equipo puede comprobar que la base de datos
de la configuración está vacía. Empezar de nuevo pide entonces la contraseña de administrador,
vuelve a mostrar la recuperación y la borra cuando marcas «Borrar el intento anterior y empezar de
nuevo.» y vuelves a elegir **Empezar de nuevo**.

Si esa recuperación usaba una copia de Cloud, su aprobación en Waitron Cloud se cierra sola en menos
de una hora desde que se dio. Hasta entonces, Waitron Cloud no puede aprobar otra recuperación para
el local de este equipo.

Si la página dice que «Empezar de nuevo» no ha terminado, recárgala para ver lo que falta. Si el
equipo se está reiniciando, espera a que responda.

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

Abre **Copias de seguridad** y lee el error junto al estado de las copias. Elige de nuevo los
destinos y el horario. **Activar las copias** sustituye los ajustes guardados; sal sin aplicarlos
para conservarlos. Si se rechaza una carpeta, corrígela antes de volver a aplicar. Aunque se guarden
los ajustes, puede fallar su carga: comprueba el estado antes de confiar en una copia nueva.
Esta página no permite diagnosticar todos los fallos persistentes del equipo o de sus claves;
conserva las claves de recuperación y los archivos de copia existentes.

Si la copia en el bucket indica que no se han podido usar sus ajustes de forma segura, elige
**Cambiar de bucket** en **Copias de seguridad**. Corrige los campos señalados. **Probar** comprueba
el bucket sin guardar ajustes; **Guardar y activar** los aplica. **Cancelar** deja los ajustes
guardados como estaban. Este formulario no puede diagnosticar un fallo de configuración del propio
equipo. Conserva las claves de recuperación y las copias existentes si el rechazo persiste.

## Crea las nuevas series {#series}

Usa los controles bajo los datos autenticados. Vuelve a introducir la clave correspondiente, confirma
las condiciones de recuperación y elige **Comparar relojes**. Sigue las instrucciones sobre relojes
y esperas; no hay ningún código de instalación que escribir. Elige **Recuperar** cuando se hayan
elegido las nuevas series.

Una clave que abre la copia no evita las comprobaciones del historial y del reloj. Si una comprobación
lo impide, resuelve la causa e inténtalo de nuevo. No borres a mano los archivos del intento
conservado ni edites sus registros de recuperación.

## Continúa después de una interrupción {#resume}

Mientras la página de recuperación siga abierta, continúa donde lo dejaste. La recuperación se
detiene si el equipo se reinicia o si pasan 15 minutos sin ningún paso de recuperación, aunque la
página siga abierta. Salir de la página o cerrar su pestaña también la detiene, en menos de cinco
minutos. Si la recuperación ya había guardado progreso, la página de reparación la muestra entonces
como detenida y no ofrece **Recuperar desde una copia** junto a ella; **Empezar de nuevo** la borra,
como se explica más arriba. Si no, vuelve a abrir la copia.
Si la recuperación ya está guardada, reconecta con el equipo en lugar de volver a identificarte o colocarla.

Cambiar el origen o el entorno vacía los controles autenticados de la página. No borra la operación
guardada ni elige otra copia para ella. Después de **Recuperación guardada**, reconecta con el equipo.
Si el resultado es incierto, conserva los archivos e investiga antes de iniciar otra recuperación.
