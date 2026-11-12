# Recuperar desde una copia

Conserva el paquete de recuperación anterior cuando cambies la clave de recuperación. Hasta que la nueva copia del bucket esté lista, el paquete anterior sigue correspondiendo a la copia ofrecida para recuperar. Si la página dice que el paquete no corresponde a la copia o que el acceso al bucket no permite leerla, usa el paquete correspondiente, o corrige el acceso al bucket y vuelve a intentarlo.

Las copias programadas en un bucket usan la carpeta que elijas, sin añadir una carpeta para el local. Elige carpetas distintas para las copias programadas y la copia en el bucket. Ninguna puede estar dentro de la otra.

Puedes compartir una carpeta de copias entre cajas: cada caja elimina solo sus propias copias. Tras una restauración, elige una carpeta nueva si quieres conservar todas las copias anteriores, porque la caja restaurada puede seguir eliminándolas. Waitron deja intactas las copias de otras cajas y los archivos que no reconoce; gestiona esos archivos cuando necesites más espacio.

## Si se interrumpió la primera configuración {#interrupted-setup}

Recargar la pestaña que estaba haciendo la configuración sigue con ella, hasta que la configuración
empieza la activación. Si no, la página ofrece **Empezar de nuevo** y **Recuperar desde una
copia**. Las dos borran de la misma manera la configuración que se detuvo a
medias, y **Recuperar desde una copia** lleva después a la restauración que usa un equipo nuevo.
Ninguna pide contraseña: cualquiera que pueda abrir la página de reparación puede usarlas, y puede
ver lo que la página muestra al pulsar una. Cuando eliges una, el equipo comprueba lo que borraría
y la página lo muestra.

Si el equipo sigue mostrando sus pantallas de configuración en lugar de la página de reparación,
cualquiera de las dos te pide primero detener la configuración. **Detener esta configuración**
termina la configuración para quien la esté haciendo, algo que no se puede deshacer, no borra nada y
reinicia el equipo; después de **Reconectar**, **Empezar de nuevo** y **Recuperar desde una copia**
muestran lo que borrarían. **Cancelar** lo deja todo como está.

Cuando eliges **Empezar de nuevo**, la página muestra «Empezar de nuevo borra lo que se introdujo en
la configuración que se detuvo a medias. No se envió ninguna factura a la AEAT.», y lo borra todo
cuando marcas «Borrar el intento anterior y empezar de nuevo.» y vuelves a elegir **Empezar de
nuevo**. Cuando eliges **Recuperar desde una copia**, muestra «Recuperar desde una copia primero
borra lo que se introdujo en la configuración que se detuvo a medias. No se envió ninguna factura a
la AEAT. Después eliges la copia.», y lo borra todo cuando marcas «Borrar el intento anterior y
recuperar desde una copia.» y vuelves a elegir **Recuperar desde una copia**.

Si la página dice que falta la base de datos de configuración, cualquiera de las dos muestra hasta
dónde llegó la configuración según su propio registro, no dice «No se envió ninguna factura a la
AEAT.», y lo borra todo cuando marcas «No se envió nada a la AEAT ni se vendió nada.» y vuelves a
pulsar el mismo botón. Si parte de la base de datos de configuración no se puede leer, la página
dice «El proceso de configuración anterior no tuvo éxito.» y no dice «No se envió ninguna factura a
la AEAT.», porque puede que el equipo no haya podido comprobar si esa base de datos tiene facturas.
Empezar de nuevo y Recuperar desde una copia la borran igualmente.

No se ofrece ninguna de las dos, y la página dice por qué con las mismas palabras para ambas, si la
configuración ya terminó, o si la base de datos de configuración tiene una factura u otro registro
que Waitron nunca borra. Si el equipo no puede confirmar que borrar la configuración sea seguro, la
página lo indica y no ofrece ninguna. Eso incluye una configuración cuyo propio registro no se puede
leer: entonces la única salida es reinstalar Waitron. Con una conexión sin cifrar no funciona
ninguna: configura antes la conexión segura.

Cuando se ha borrado la configuración, el equipo se reinicia. Después de **Recuperar desde una
copia**, **Reconectar** abre «Unirse a un restaurante existente o recuperarlo», donde eliges
**Restaurar desde una copia de seguridad** o **Restaurar desde mi bucket**, como en un equipo nuevo;
restaurar necesita la clave de la propia copia y la clave de recuperación de su nodo. Después de
**Empezar de nuevo**, **Reconectar** abre «Configura este servidor Waitron», donde eliges cómo
configurar este equipo. Si se recarga la página antes de pulsar **Reconectar**, no recuerda cuál
elegiste y abre su primera pantalla. Si esa pantalla pregunta «¿Es segura esta página?», pulsa
**Continuar con la configuración**; después, para restaurar, elige **Unirse o recuperar**.

Si la página dice «Borrado interrumpido», después de **Empezar de nuevo** o de **Recuperar desde una
copia**, recárgala para continuar.

Si un «Empezar de nuevo» se interrumpió y después el equipo encuentra archivos que «Empezar de
nuevo» no creó, como un local copiado desde una copia de seguridad, el equipo no arranca. Si su
página muestra los archivos, también pide, con la conexión segura del equipo, la contraseña de
administrador que elegiste al configurar. **Conservarlo todo y parar** deja los archivos como están, y la página sigue
hasta que se reinstale Waitron. **Apartar estos archivos y terminar «Empezar de nuevo»** mueve los
archivos, sin cambios, a una carpeta nueva del equipo y termina «Empezar de nuevo»; después el
equipo empieza una configuración inicial nueva. También guarda una copia del archivo de
claves del equipo en la carpeta apartada: quien copie esa carpeta fuera del equipo podrá abrir los
secretos guardados en esos archivos. Si se añaden, quitan o modifican archivos después de abrir la página,
el equipo rechaza la elección y no cambia nada: pulsa **Reintentar un arranque normal** para verlos
de nuevo. A partir de la sexta contraseña incorrecta, la página te hace esperar antes del siguiente
intento, nunca más de 15 minutos, y cada 15 minutos sin una contraseña incorrecta se perdona una. Si
la página dice que «Empezar de nuevo» estaba apartando archivos y no ha terminado, pulsa
**Reintentar un arranque normal** para terminar de moverlos; después el equipo empieza una
configuración inicial nueva.

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

En «Unirse a un restaurante existente o recuperarlo», elige **Restaurar desde una copia de
seguridad** para un archivo de copia, o **Restaurar desde mi bucket** para la copia continua de tu
propio bucket de almacenamiento. Para una copia de Waitron Cloud, elige **Restaurar desde una copia
de seguridad** y después **Restaurar desde Waitron Cloud**.

**Añadir un nodo réplica** aún no está terminado en esta versión: el nuevo servidor no recibe los
datos del restaurante. Elige una opción de restauración para recuperar un restaurante existente.

Para un archivo de copia, elígelo en **Archivo de copia de seguridad**, introduce la clave que lo
abre en **Clave de recuperación** y elige su **Entorno de la copia**. Para tu bucket, elige tu
paquete de recuperación o archivo del kit en **Paquete de recuperación o archivo del kit**, o pega
el kit en **Kit de recuperación**, y elige el **Entorno** en el que funcionaba la caja anterior. Si
el paquete se hizo antes de que el equipo tuviera copia en el bucket, no es un paquete de
recuperación de Waitron o está dañado o se modificó después de hacerse, la página lo dice bajo el
campo. Para Waitron Cloud, elige **Iniciar la recuperación desde Cloud**, introduce el código que
muestra la página en tu cuenta de Waitron Cloud (**Abrir Waitron Cloud**) y después elige
**Comprobar la aprobación**. La recuperación de Cloud requiere un servicio compatible.

Después elige **Revisar copia**. La página muestra la copia elegida: su origen, el negocio, el
local, la fecha, el nodo y la clave de recuperación del nodo. Compruébalos antes de continuar.
Mantén separados producción y preproducción.

La clave de la copia, el kit del bucket y la aprobación de Cloud dan acceso a una copia. También
necesitas la clave de recuperación de su nodo para identificarte.

## Identifícate ante la copia elegida {#proof}

Bajo la revisión, en «Recuperar esta caja», elige en **PDF de recuperación** tu paquete de
recuperación, o un PDF de recuperación anterior, que tenga la clave del servidor de esta copia; o
escribe la clave agrupada impresa en él en **Clave de recuperación**. Si el paquete no tiene la
clave del servidor, la página lo dice y, cuando el paquete lo registra, indica el paquete o el
nombre de la clave que hay que buscar. Un paquete o una hoja con una clave del servidor más nueva
puede no abrir una copia anterior. Marca «La caja anterior está apagada y seguirá desconectada.» y
«Soy la única persona recuperando este contribuyente, en todos sus locales.».

Si **Copias** no puede confirmar la clave guardada, conserva tanto la clave anterior como la que
acabas de guardar. Al cambiar una clave, aún puedes copiar o descargar ambas claves mostradas
tras este rechazo. No sigas cambiando claves y sal de la página sin volver a enviar. Esta página
no puede diagnosticar el conflicto de configuración ni confirmar qué clave abre una copia concreta;
no sustituyas ninguno de los dos registros de claves basándote en este mensaje.

Si las copias programadas están desactivadas porque no se pueden usar sus ajustes guardados, abre
**Copias de seguridad** y lee el error junto al estado de las copias. Elige de nuevo los destinos
y el horario. **Activar las copias** sustituye los ajustes guardados; sal sin aplicarlos
para conservarlos. Elige una carpeta de copias fuera de la carpeta scratch de la caja; los arranques vacían scratch para quitar las copias temporales. Si se rechaza una carpeta, corrígela antes de volver a aplicar. Aunque se guarden
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
el bucket sin guardar ajustes; **Guardar y activar** también comprueba que un archivo de prueba se pueda leer con su clave y que se rechace su lectura con una clave incorrecta o sin clave antes de aplicar los ajustes. Si rechaza el bucket, sigue el mensaje para permitir esas claves o elige otro proveedor. Guardar puede permitir claves de cifrado proporcionadas por el cliente en los ajustes del bucket. Ese cambio se mantiene si una comprobación posterior falla. **Cancelar** deja los ajustes
guardados como estaban. Este formulario no puede diagnosticar un fallo de configuración del propio
equipo. Conserva las claves de recuperación y las copias existentes si el rechazo persiste.

Si el equipo indica que la copia en el bucket no está en marcha, abre **Copias de seguridad** y pulsa
**Volver a iniciar la copia**, que la inicia con los ajustes que ya tiene. Si se vuelve a detener,
elige **Cambiar de bucket** y pulsa **Probar** para comprobar el bucket.

Si la copia en el bucket indica que otro equipo está escribiendo la copia de este local en el mismo
bucket y ese equipo sustituyó a este, apaga este equipo: nunca deben vender dos equipos para un
mismo local.

## Crea las nuevas series {#series}

Si este navegador guardó observaciones de facturas del contribuyente y entorno seleccionados, el
formulario muestra **Facturas vistas en este dispositivo**. Cada entrada indica el último número
que el navegador guardó de esa serie, su fecha de expedición y su huella. Compáralas con el
historial que conservas: la lista puede estar incompleta y desaparece si borras los datos del
navegador. Una serie anterior sigue siendo una observación; la recuperación usa series nuevas.
Puedes recuperar desde un dispositivo nuevo o aunque el almacenamiento del navegador no esté
disponible. Las observaciones permanecen en este navegador y no se envían con la solicitud de
recuperación. El informe lee el almacenamiento disponible en esta dirección de Waitron; no busca
observaciones en otros dispositivos.

La restauración sustituye la base de datos que ya está en este equipo.

Elige **Comparar relojes**. Sigue las instrucciones sobre relojes y esperas; no hay ningún código de
instalación que escribir. Elige **Crear las series** cuando la página lo permita; después muestra el
nombre de las nuevas series. Marca la confirmación que muestra la página —«Confirmo que ningún otro
servidor en funcionamiento tiene datos más recientes del restaurante.» para un archivo de copia o
una copia del bucket (para una copia del bucket, también «Este es mi negocio. Restáuralo en este
servidor.»), o «Confirmo que el servidor anterior y los demás servidores que queden están
detenidos, y acepto perder los cambios posteriores a esta instantánea.» para una copia de Waitron
Cloud— y elige **Restaurar la copia**, **Restaurar desde mi bucket** o **Restaurar esta
instantánea**.

Si la copia tiene ventas con una fecha posterior en más de un minuto a la hora del equipo, el equipo
deja de cobrar al terminar la recuperación hasta que su reloj las alcance o se confirme su hora: consulta
[Cuando se paran los cobros por la hora](box-status.md#clock-behind).

Una clave que abre la copia no evita las comprobaciones del historial y del reloj. Si la comprobación
del reloj lo impide, resuelve la causa e inténtalo de nuevo. Si después el equipo muestra una
página que dice que no pudo crear sus nuevas series de facturas, conéctalo a internet y pulsa
**Reintentar un arranque normal**.

Si la copia no tiene ningún administrador activo con contraseña, elige otra copia de seguridad.

## Si una recuperación se interrumpe {#resume}

Si sigue guardada una restauración anterior, se ejecutará cuando arranque el servidor. Elige otra restauración para sustituirla.

Hasta que eliges el botón de restaurar, la página conserva lo que introdujiste solo mientras sigue
abierta. Cambiar el archivo, la clave o el entorno descarta lo que comprobó, y al recargar se abre
la primera pantalla de la página; desde ahí elige **Unirse o recuperar** y empieza de nuevo la
restauración. Si el equipo rechaza la restauración, la página vuelve al formulario y tienes que
introducir de nuevo la clave de recuperación del nodo.

Cuando eliges el botón de restaurar, la página dice «Configurando este servidor» y te pide que la
mantengas abierta. El equipo guarda la solicitud y se reinicia. Si se detiene después de guardar la
solicitud, el siguiente arranque la ejecuta; si se detiene mientras escribe la copia en su sitio,
cada arranque siguiente la vuelve a ejecutar.

## Un conflicto de facturación en un equipo en marcha {#invoice-conflict}

Si el equipo conserva tus pedidos y pagos pero deja de emitir facturas por un conflicto de
identidad, sigue [Recuperar una identidad de facturación](box-status.md#invoice-conflict) con su clave
de recuperación actual. Ese procedimiento cambia la identidad activa sin restaurar una copia.
Conserva el registro rechazado y su incidencia abierta. Desconecta cualquier equipo antiguo o
copiado antes de continuar.
