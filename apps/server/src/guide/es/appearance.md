# Apariencia

El panel y las cajas pueden llevar los colores de tu local en lugar del azul de Waitron. La página
**Apariencia**, dentro de **Ajustes**, muestra el aspecto en uso y permite a un encargado
cambiarlo y ver el resultado antes de que lo vea nadie más.

## Consulta el aspecto en uso {#look}

Abre **Ajustes** y después **Apariencia**. La tarjeta **Aspecto** muestra el **Tema en uso** y las
elecciones que lo forman:

- **Color de marca**: el color de los botones principales y de los elementos seleccionados.
  **De Waitron** significa que el tema conserva el color propio de Waitron. Un color que no es una
  de las muestras aparece como **Personalizado** con su código. Si se eligió un tono legible en
  lugar del color, la fila también lo indica.
- **Fondo**: **Neutro** conserva los grises de Waitron, y **Teñido** da a la página, al relleno de
  los campos y a los bordes un ligero matiz del color de marca.
- **Esquinas**: **Rectas**, **Estándar** o **Redondeadas**, para botones, campos y tarjetas.
- **Colores fijados a mano**: los colores del tema que recibieron un valor propio en lugar de
  calcularse a partir del color de marca, o **Ninguno**. Esta página no puede fijar un color a
  mano, pero sus correcciones pueden sustituir uno que se lee mal por un tono legible, y **Usar el
  aspecto de Waitron** los quita todos.

La nota al pie de la tarjeta explica que un mismo aspecto se aplica al panel y a todas las cajas.
Cada tema tiene una versión clara y una oscura, y cada pantalla muestra una de ellas, según su
propio ajuste de **Tema**: Claro, Oscuro o Según el dispositivo. La tarjeta **Temas**, debajo,
muestra los temas del local.

Cualquier persona con el rol **Supervisor** o superior puede abrir esta página y leer las dos tarjetas.
Solo un **Encargado** o un **Administrador** puede cambiar el aspecto.

## Edita un tema {#edit}

La tarjeta Aspecto muestra **Editar** a un **Encargado** o a un **Administrador**, sea cual sea el
tema en uso. Abre el tema en uso. Para editar otro de los temas del local, o para empezar uno
nuevo, usa la tarjeta **Temas**, debajo.

Mientras está en uso el tema de Waitron, Editar se abre con las elecciones de Waitron. El tema
propio de Waitron no cambia nunca, así que al guardar, Guardar te pide un nombre y guarda tus
elecciones como un tema nuevo. Así es como un local crea su primer tema.

Una línea en la parte superior del editor dice qué hace guardar. Si editas el tema en uso, dice
«Tema en uso:» con el nombre del tema, y «Al guardar cambian todas las pantallas.» Si editas
cualquier otro tema, dice «No está en uso. Al guardar no cambia ninguna pantalla hasta que lo
uses.», y el título de la tarjeta nombra el tema, o dice **Añadir tema**.

El editor abre las tres elecciones del tema en el mismo sitio:

- **Color de marca**: elige **De Waitron**, una de las muestras, o **Personalizado** para escoger
  cualquier color. También puedes escribir un código como `#1e5b3a` en la casilla junto a
  **Personalizado**. Un código debe ser `#` seguido de seis dígitos o letras de la a a la f; si no
  lo es, Guardar te lo indica debajo del campo.
- **Fondo**: **Neutro** o **Teñido**.
- **Esquinas**: **Rectas**, **Estándar** o **Redondeadas**.

Al lado o debajo de las elecciones, la **Vista previa** pinta una pequeña muestra del panel con el
aspecto que estás preparando: una **Versión clara** y una **Versión oscura**, cada una con un
elemento del menú seleccionado, un campo, los botones Guardar y Cancelar, un interruptor, un enlace
y una elección entre Claro y Oscuro. Es una imagen, así que sus botones no hacen nada. El editor se
organiza según el ancho de la tarjeta, no el de la ventana. En una tarjeta ancha la vista previa
queda al lado de las elecciones, y en una estrecha, debajo. Cuando la vista previa tiene espacio,
las dos versiones quedan una al lado de la otra; si no, la versión clara queda encima de la oscura.

Nada más en la página, ni ninguna otra pantalla, cambia hasta que guardas. **Usar el aspecto de
Waitron** devuelve todas las elecciones a las de Waitron: el color de marca de Waitron, Neutro,
esquinas Estándar y ningún color fijado a mano. No guarda nada por sí solo, y aparece desactivado
mientras las elecciones ya son el aspecto de Waitron. **Cancelar** cierra el editor sin guardar.
Si has cambiado algo, Cancelar, salir de la página y abrir otro tema desde la tarjeta Temas te lo
preguntan antes.

## Cuando un color se lee mal {#hard-to-read}

Algunos colores de marca hacen que los botones se vean mal. Un amarillo soleado como `#f2c94c`,
por ejemplo, apenas destaca en una pantalla clara. Cuando ocurre, aparece un aviso debajo del color
de marca: «Los botones de este color se ven mal en pantallas claras.»

Si un tono de tu color se leería bien, el aviso trae un botón que lo ofrece. Para ese amarillo con
el fondo Neutro, el botón dice **Usar #a78612 en pantallas claras**. Púlsalo y las pantallas claras
usan ese tono, mientras que las oscuras conservan tu color. La línea pasa a decir «Botones en
pantallas claras:» con el tono, y **Deshacer** devuelve tu color.

Un tono que eliges pertenece a su color. Elegir otro color de marca lo descarta, y volver al color
guardado del tema recupera su tono guardado. Cambiar el fondo o las esquinas lo conserva.

Cuando dos o más avisos ofrecen cada uno una corrección, una línea debajo del editor cuenta los
colores que se leen mal y ofrece **Corregir todos**, que aplica todas las correcciones a la vez.

Waitron nunca rechaza un color. Un aviso es un consejo: puedes guardar el color que elegiste y
quedarte con él.

## Guarda un tema {#save}

**Guardar** aparece desactivado hasta que cambias algo. Lo que hace después depende del tema que
estás editando.

Si editas uno de los temas propios del local, Guardar guarda tus cambios en él y cierra el editor.

Si editas el tema de Waitron, o un tema que empezaste con **Añadir tema**, Guardar abre el diálogo
**Pon nombre a este tema**, después del diálogo **Difícil de leer** cuando aparece, porque tus
elecciones van a convertirse en un tema propio. Su interruptor **Usarlo ya en todas las pantallas**
empieza activado cuando editas el tema de Waitron en uso, y desactivado para un tema nuevo.
**Guardar** en el diálogo guarda el tema nuevo y cierra el editor. **Volver** te deja en el editor
sin guardar nada, y antes te lo pregunta si cambiaste algo en el diálogo. Las reglas de un nombre están en
«Pon nombre a un tema», más abajo.

Si algo sigue leyéndose mal, Guardar abre primero el diálogo **Difícil de leer**, con una línea por
cada color afectado. Ofrece tres opciones:

- **Volver** te devuelve al editor sin guardar nada.
- **Guardar de todos modos** guarda los colores tal como los elegiste.
- **Corregir y guardar** aplica todas las correcciones y después guarda. El diálogo solo la ofrece
  cuando corregirlo todo no dejaría ningún aviso.

Cuando Guardar pide un nombre, **Guardar de todos modos** y **Corregir y guardar** abren el diálogo
del nombre en lugar de guardar al momento. Mientras su interruptor está activado, el diálogo del
nombre muestra los colores que siguen leyéndose mal, para que los veas antes de que el tema llegue
a todas las pantallas.

Cuando el tema que guardaste es el que está en uso, el panel que estás usando cambia al nuevo
aspecto al momento. Los demás paneles abiertos a la vez lo siguen por su cuenta, y una caja con la
sesión iniciada lo sigue la próxima vez que comprueba si su carta ha cambiado. Un teléfono o una
tableta de mano, y una caja registradora preparada para el servicio en mostrador, lo comprueban
cada 15 segundos. Cualquier otra caja registradora lo comprueba cada 15 segundos mientras tiene
abierto el pedido de una mesa y, si no, lo sigue cuando vuelve a abrir uno, o cuando se reinicia.
Guardar un tema que no está en uso no cambia ninguna pantalla hasta que lo pones en uso.

Si guardaste de todos modos, la fila de ese tema en la tarjeta Temas muestra una etiqueta como «2 se
leen mal» y, mientras sea el tema en uso, la tarjeta Aspecto conserva además una línea de aviso por
cada color que sigue leyéndose mal, para que también lo vea la próxima persona que abra la página.

Mientras editas uno de los temas propios del local, el editor ofrece también **Guardar como tema
nuevo…**. Abre el diálogo del nombre con el nombre del tema seguido de «(copia)», guarda tus
elecciones con el nombre que le des, deja el tema que estabas editando tal como se guardó por última
vez y cierra el editor. Su interruptor **Usarlo ya en todas las pantallas** empieza activado cuando
el tema que editas está en uso. Si algún color sigue leyéndose mal, primero aparece el diálogo
**Difícil de leer**, igual que con Guardar. Como Guardar, te indica debajo del campo si un código de
color que escribiste no es válido, y no guarda nada hasta que lo corriges.

## Los temas del local {#themes}

La tarjeta **Temas** muestra todos los temas del local, primero el de Waitron. Cada fila muestra el
**Nombre** del tema, sus **Colores** y su **Estado**. Los colores son tres puntos: el color de
marca y después el color de la página de la versión clara y de la versión oscura. Cuando la tarjeta
es estrecha, como en un teléfono o junto al menú lateral en una pantalla pequeña, no muestra los
colores, y en un teléfono las etiquetas de estado van tras el nombre del tema en lugar de en una
columna propia. Las etiquetas de estado dicen qué tema está **En uso** y cuántos de los colores de
un tema se leen mal, por ejemplo «2 se leen mal». El tema de Waitron lleva la etiqueta
**integrado**.

Un **Encargado** o un **Administrador** ve **Añadir tema** en la tarjeta, que abre el editor con las
elecciones de Waitron para un tema que aún no está guardado, y un menú en cada fila:

- **Editar** abre ese tema en el editor de la tarjeta Aspecto. Un tema que no está en uso se abre
  con la línea «No está en uso. Al guardar no cambia ninguna pantalla hasta que lo uses.»
- **Cambiar el nombre** le da al tema un nombre nuevo.
- **Hacer una copia** guarda una copia del tema con un nombre nuevo. El diálogo del nombre propone
  el nombre del tema seguido de «(copia)». La copia no está en uso salvo que actives **Usarlo ya en
  todas las pantallas** antes de guardar.
- **Usar en todas las pantallas** pone el tema en uso. La fila del tema en uso no lo ofrece.
- **Eliminar** elimina el tema. La fila del tema abierto en el editor no lo ofrece.

La fila de Waitron solo ofrece **Hacer una copia**, y **Usar en todas las pantallas** mientras está
en uso otro tema, porque el tema de Waitron no se puede editar, cambiar de nombre ni eliminar. Un
**Supervisor** ve la lista, sin Añadir tema y sin los menús.

## Pon nombre a un tema {#names}

El diálogo **Pon nombre a este tema** pide un nombre siempre que un tema se guarda con uno nuevo: el
primer guardado del tema de Waitron o de un tema nuevo, Guardar como tema nuevo…, Hacer una copia y
Cambiar el nombre. Un nombre tiene de 1 a 60 caracteres, y se quitan los espacios de los extremos.
Dos temas no pueden compartir nombre, aunque cambien las mayúsculas: mientras exista un tema llamado
«Terraza», llamar «terraza» a otro se rechaza con «Ya existe un tema con este nombre.» Ningún tema
puede llamarse «Waitron», con ninguna combinación de mayúsculas, porque es el nombre del tema
integrado.

Todas las vías salvo Cambiar el nombre muestran el interruptor **Usarlo ya en todas las
pantallas**. Cambiar el nombre no tiene interruptor, y cambiar el nombre de un tema no cambia el
aspecto de ninguna pantalla.

## Pon un tema en uso {#switch}

**Usar en todas las pantallas** pregunta antes, con una pregunta como «¿Usar Terraza en todas las
pantallas?». Si el tema tiene colores que se leen mal, la pregunta los muestra bajo «Se leen mal:».
**Usarlo** pone el tema en uso, y **Volver** no cambia nada.

Cuando un tema pasa a estar en uso, el panel que estás usando cambia a él al momento y los demás
paneles abiertos a la vez lo siguen por su cuenta. Las cajas con la sesión iniciada lo siguen igual
que cuando guardas el tema en uso, como explica «Guarda un tema», más arriba. Waitron nunca rechaza
un tema porque se lea mal: la lista está ahí para que elijas sabiéndolo.

## Elimina un tema {#delete}

**Eliminar** pregunta antes, nombrando el tema y avisando de que no se puede deshacer. Si el tema es
el que está en uso, el diálogo lo dice bajo «Qué cambia»: al eliminarlo, se pone el tema de Waitron
en todas las pantallas, y las pantallas cambian igual que cuando pones un tema en uso.
