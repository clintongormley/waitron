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
junto a la recuperación detenida. Empezar de nuevo pide entonces la contraseña de administrador y
vuelve a mostrar la recuperación, con «Empezar de nuevo borra lo que se introdujo en la
configuración que se detuvo a medias. No se envió ninguna factura a la AEAT.» Lo borra todo cuando
marcas «Borrar el intento anterior y empezar de nuevo.» y vuelves a elegir **Empezar de nuevo**.
Empezar de nuevo no se ofrece si la configuración ya guardó los ajustes con los que vende el equipo.
Si la base de datos tiene una factura u otro elemento que Waitron nunca borra, la página lo indica
después de que introduzcas la contraseña, y Empezar de nuevo no se lleva a cabo.

Si esa recuperación usaba una copia de Cloud, su aprobación en Waitron Cloud se cierra sola en menos
de una hora desde que se dio. Hasta entonces, Waitron Cloud no puede aprobar otra recuperación para
el local de este equipo.

Si la página dice que «Empezar de nuevo» no ha terminado, recárgala para ver lo que falta. Si el
equipo se está reiniciando, espera a que responda.

Si la recuperación llenó el disco del equipo, «Empezar de nuevo» sigue funcionando: el equipo guarda
unos 8 MB de su disco en reserva, y cede ese espacio para poder quitar la recuperación. Si ni eso
basta, la página dice que el disco está lleno. Cuando la página puede saberlo, dice si reiniciar el
equipo puede liberar espacio.

Si un «Empezar de nuevo» se interrumpió y después el equipo encuentra archivos que «Empezar de
nuevo» no creó, como un local copiado desde una copia de seguridad, el equipo no arranca. Si su
página muestra los archivos, también pide, con la conexión segura del equipo, la contraseña de
administrador que elegiste al configurar. **Conservarlo todo y parar** deja los archivos como están, y la página sigue
hasta que se reinstale Waitron. **Apartar estos archivos y terminar «Empezar de nuevo»** mueve los
archivos, sin cambios, a una carpeta nueva del equipo y termina «Empezar de nuevo»; después el
equipo empieza una configuración inicial nueva. Si se añaden, quitan o modifican archivos después de abrir la página,
el equipo rechaza la elección y no cambia nada: pulsa **Reintentar un arranque normal** para verlos
de nuevo. A partir de la sexta contraseña incorrecta, la página te hace esperar antes del siguiente
intento, nunca más de 15 minutos, y cada 15 minutos sin una contraseña incorrecta se perdona una. Si
la página dice que «Empezar de nuevo» estaba apartando archivos y no ha terminado, pulsa
**Reintentar un arranque normal** para terminar de moverlos; después el equipo empieza una
configuración inicial nueva.

## Elige tu copia {#source}

Elige **Archivo de copia**, **Copia del bucket** o **Copia de Cloud** y el entorno correspondiente.
Para un archivo, selecciónalo e introduce su clave. Para una copia del bucket, elige tu paquete de
recuperación o el archivo del kit de recuperación, o pega el kit. La página lee el código de la copia
del bucket del archivo adjunto dentro del PDF, no del texto impreso, y solo envía ese código. Si el
paquete se hizo antes de que el equipo tuviera copia en el bucket, el PDF no es un paquete de
recuperación de Waitron o el archivo adjunto del paquete está dañado o se modificó después de
hacerse, la página lo dice bajo el campo y conserva lo que había.
Para Cloud, pide la aprobación, apruébala en Cloud y compruébala aquí. La recuperación de Cloud
requiere un servicio compatible; esta opción no habilita la recuperación de Cloud en producción.

La clave del archivo, las credenciales del bucket y la aprobación de Cloud dan acceso a una copia.
También necesitas la clave de recuperación de su nodo para identificarte. Mantén separados producción
y preproducción.

## Identifícate ante la copia elegida {#proof}

Introduce la clave agrupada de la hoja que conservaste para esta copia, o elige su PDF de
recuperación guardado o un paquete de recuperación que tenga la clave del servidor. Si el paquete no
tiene la clave del servidor, la página lo dice y, cuando el paquete lo registra, indica el paquete o
el nombre de la clave que hay que buscar. Una hoja nueva con una clave de sustitución puede no abrir una copia anterior.

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

Si **Copias de seguridad** indica que no se pueden usar los ajustes guardados, elige **Lo que ha
registrado el equipo**. El panel enumera las veces que el equipo no ha podido usar sus ajustes de
copias guardados desde que se inició, de la más reciente a la más antigua y como máximo cinco, cada
una con lo que falló: por ejemplo, el número de clave con que se cerraron los ajustes y los números
de clave que tiene este equipo. Después describe el registro guardado tal como está ahora: cuándo se
escribió por última vez y, si se puede leer, las carpetas y los buckets que indica y si existe cada
carpeta. Si el entorno del equipo fija sus copias, el panel lo dice en lugar de indicarlos. Indica
si el equipo tiene una clave de recuperación de copias válida. Muestra el ID de la clave de acceso
de un bucket, pero nunca su secreto, y la clave de recuperación solo por su huella. El panel solo
lee y no cambia nada: **Leer de nuevo** vuelve a leer los datos y no activa las copias, y **Parar**
cierra el panel. Tampoco repara nada; para sustituir los ajustes guardados, elige de nuevo los
destinos y aplícalos. Conserva las claves de recuperación y los archivos de copia existentes.

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

## Si una recuperación se interrumpe {#resume}

Mientras la página de recuperación siga abierta y pueda conectar con el equipo, continúa donde lo
dejaste. La recuperación se detiene si el equipo se reinicia. Salir de la página o cerrar su pestaña
también la detiene, en menos de cinco minutos. Si la recuperación ya había guardado progreso, la
página de reparación la muestra entonces como detenida y no ofrece **Recuperar desde una copia**
junto a ella; **Empezar de nuevo** la borra, como se explica más arriba. Si no, vuelve a abrir la
copia.
Si la recuperación ya está guardada, reconecta con el equipo en lugar de volver a identificarte o colocarla.

Cambiar el origen o el entorno vacía los controles autenticados de la página. No borra la operación
guardada ni elige otra copia para ella. Después de **Recuperación guardada**, reconecta con el equipo.
Si el resultado es incierto, conserva los archivos e investiga antes de iniciar otra recuperación.
