# Apariencia

El panel y las cajas pueden llevar los colores de tu local en lugar del azul de Waitron. La página
**Apariencia**, dentro de **Ajustes**, muestra el aspecto en uso y permite a un encargado
cambiarlo y ver el resultado antes de que lo vea nadie más.

## Consulta el aspecto en uso {#look}

Abre **Ajustes** y después **Apariencia**. La tarjeta **Aspecto** muestra el **Tema en uso** y las
elecciones que lo forman:

- **Logotipo**: **Ninguno**, o el logotipo del tema seguido de cómo lo muestran las pantallas
  oscuras: «Pantallas oscuras: versión propia» cuando el tema tiene una versión para pantallas
  oscuras, o «Pantallas oscuras: sobre una placa clara» cuando no la tiene. La imagen sigue el
  propio ajuste de **Tema** de este panel, así que un panel oscuro muestra el logotipo como lo
  mostrarán las pantallas oscuras.
- **Color de marca**: el color de los botones principales y de los elementos seleccionados.
  **De Waitron** significa que el tema conserva el color propio de Waitron. Un color que no es una
  de las muestras aparece como **Personalizado** con su código. Si se eligió un tono legible en
  lugar del color, la fila también lo indica, y si los botones principales de una versión
  recibieron un color a mano, la fila nombra ese color seguido de «fijado a mano», por ejemplo
  «pantallas oscuras #5fa77a, fijado a mano».
- **Fondo**: **Neutro** conserva los grises de Waitron, y **Teñido** da a la página, al relleno de
  los campos y a los bordes un ligero matiz del color de marca.
- **Esquinas**: **Rectas**, **Estándar** o **Redondeadas**, para botones, campos y tarjetas.
- **Tamaño del texto**: lo grande que el tema hace el texto de todas las pantallas: «100 %
  (estándar)», o un paso mayor, como «115 %».
- **Colores fijados a mano**: los colores del tema que recibieron un valor propio en lugar de
  calcularse a partir del color de marca, o **Ninguno**. La sección **Avanzado** del editor los
  fija, como explica «Fija colores y texto a mano», más abajo.
- **Texto fijado a mano**: los ajustes de texto que recibieron un valor propio, por ejemplo
  **Texto pequeño**, o **Ninguno**. Los explica «Fija el texto a mano», más abajo.

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

El editor se abre con el **Logotipo** del tema en primer lugar, como explica «Añade tu logotipo»,
más abajo, y después las cuatro elecciones del tema:

- **Color de marca**: elige **De Waitron**, una de las muestras, o **Personalizado** para escoger
  cualquier color. También puedes escribir un código como `#1e5b3a` en la casilla junto a
  **Personalizado**. Un código debe ser `#` seguido de seis dígitos o letras de la a a la f; si no
  lo es, Guardar te lo indica debajo del campo.
- **Fondo**: **Neutro** o **Teñido**.
- **Esquinas**: **Rectas**, **Estándar** o **Redondeadas**.
- **Tamaño del texto**: un control deslizante del 100 % al 130 % en pasos del 5 %, con los cuatro
  tamaños que da debajo, por ejemplo «Texto en pantalla: pequeño 12 px · normal 14 px · grande 18 px
  · muy grande 22 px» al 100 %.

Debajo del color de marca, **Elegir otro color para las pantallas oscuras** da a los botones
principales de la versión oscura un color propio: abre Avanzado y pone el cursor en la casilla del
código de **Botones principales** en las pantallas oscuras. Una vez fijado ese color, el enlace deja
paso a una línea como «Botones en pantallas oscuras: #5fa77a, fijado a mano», y **Usar el color de
marca**, a su lado, quita ese color, de modo que las pantallas oscuras vuelven a calcular sus
botones a partir del color de marca.

Al lado o debajo de las elecciones, la **Vista previa** pinta una pequeña muestra del panel con el
aspecto que estás preparando: una **Versión clara** y una **Versión oscura**, cada una encabezada
por una franja con el logotipo y la razón social del local, y después un elemento del menú
seleccionado, un campo, los botones Guardar y Cancelar, un interruptor, un enlace, una elección
entre Claro y Oscuro, y después el botón de un producto de una caja y una línea de la cuenta. Las
dos versiones se dibujan con el tamaño del texto que has elegido. El nombre del producto está en el
idioma principal del contenido de la carta del local cuando el panel lo tiene y, si no, en el idioma
del panel. Es una imagen, así que sus botones no hacen nada. El editor se organiza según el ancho de
la tarjeta, no el de la ventana. En una tarjeta ancha la vista previa queda al lado de las
elecciones, y en una estrecha, debajo. Cuando la vista previa tiene espacio,
las dos versiones quedan una al lado de la otra; si no, la versión clara queda encima de la oscura.

Nada más en la página, ni ninguna otra pantalla, cambia hasta que guardas. **Usar el aspecto de
Waitron** quita el logotipo y devuelve todas las elecciones a las de Waitron: el color de marca de
Waitron, Neutro, esquinas Estándar, tamaño del texto 100 % y ningún color fijado a mano. No guarda
nada por sí solo, y aparece desactivado mientras no hay logotipo y las elecciones ya son el aspecto
de Waitron. **Cancelar** cierra el editor sin guardar. Si has cambiado algo, Cancelar, salir de la
página y abrir otro tema desde la tarjeta Temas te lo preguntan antes.

## Agranda el texto {#text-size}

El control **Tamaño del texto** agranda el texto de todos los paneles, cajas, terminales de camarero
y pantallas de cocina: cada uno de los cuatro tamaños de texto crece en el mismo porcentaje,
redondeado al píxel. El 100 % es el tamaño de Waitron, y el 130 %, el mayor. Los espacios no
cambian, ni tampoco el tamaño mínimo de un botón, incluidos los botones de producto de una caja, así
que un nombre largo que ya no cabe ocupa otra línea.

En una caja o un terminal de camarero de un local cuyo [idioma de contenido
predeterminado](content-and-images.md#languages) es el español, una palabra de ocho
letras o más en el nombre de un producto, en un botón de producto o en una línea de la cuenta, puede
cortarse por una sílaba con un guion; una palabra más corta nunca se divide con guion. En un idioma
que el navegador no divide con guiones, entre ellos el inglés, una palabra más larga que su botón o
su línea se corta en mitad de la palabra, sin guion, con cualquier tamaño de texto; con el texto más
grande ocurre más a menudo.

Un tamaño de texto guardado llega a los paneles y las cajas igual que los colores de un tema guardado
(consulta [Guarda un tema](appearance.md#save)). Una pantalla de cocina en la que nadie inicia sesión
lo toma la próxima vez que se inicia.

El papel impreso conserva los tamaños de Waitron: los recibos, las comandas de cocina, la etiqueta
del equipo y el kit de recuperación del nodo. El botón de inicio de sesión de Google conserva el
tamaño de Google.

Un tamaño fijado a mano también crece con el control, como explica [Fija el texto a
mano](appearance.md#text-by-hand).

## Añade tu logotipo {#logo}

Sin logotipo, el campo **Logotipo** muestra **+ Añadir un logotipo**, que abre la biblioteca de
imágenes: sube allí una imagen o busca una que ya esté allí, y elige **Usar imagen** en ella. Un
logotipo es un archivo PNG, JPEG o WebP, como todas las imágenes de la biblioteca; un archivo SVG se
rechaza. La pista bajo el campo dice «PNG, JPEG o WebP. Queda mejor con fondo transparente y al
menos 200 píxeles de alto.»

Con un logotipo, el campo muestra la imagen sobre una placa blanca, con **Sustituir** encima de
**Quitar** a su lado. Sustituir abre la biblioteca de imágenes para elegir otra imagen. Quitar
retira el logotipo del tema, junto con su versión para pantallas oscuras. La propia imagen sigue en
la biblioteca de imágenes.

Cuando hay un logotipo, **Para pantallas oscuras (opcional)** ofrece **+ Añadir una versión para
pantallas oscuras**: una segunda imagen, como un dibujo claro de tu logotipo, que las pantallas
oscuras muestran en lugar de la principal. Hasta que añadas una, la pista dice «Sin ella, las
pantallas oscuras muestran tu logotipo sobre una placa clara.» La versión para pantallas oscuras
tiene sus propios Sustituir y Quitar.

Debajo de **Para pantallas oscuras (opcional)**, una imagen pequeña muestra cómo se imprime el
logotipo principal en los recibos de los departamentos sin logotipo de recibo propio: en los puntos
negros de una impresora de recibos de 80 mm. Consulta [En los tickets y las
facturas](appearance.md#logo-receipts). Cuando el logotipo no imprimiría ningún punto, como ocurre
con un logotipo blanco sobre fondo transparente, debajo de la imagen aparece «Este logotipo se
imprime en blanco en los recibos.»: elige una imagen más oscura o da a los departamentos un logotipo
de recibo propio. Si falla la consulta de la imagen, aparece en su lugar «No se ha podido mostrar cómo
se imprime este logotipo.», con **Reintentar**.

La vista previa muestra el logotipo en la franja superior de cada versión, seguido de la razón
social del local: el logotipo principal en la versión clara y, en la versión oscura, la versión para
pantallas oscuras o el logotipo principal sobre su placa clara. Sin logotipo, la franja muestra el
logotipo propio de Waitron.

**Guardar** y **Cancelar** tratan el logotipo igual que las demás elecciones. El logotipo se guarda
con el tema.

## Dónde se ve tu logotipo {#logo-screens}

El logotipo del tema en uso se ve en estos lugares:

- **La franja superior del panel**, antes de la razón social de la empresa, tanto con la sesión
  iniciada como en la página de inicio de sesión.
- **La barra superior de un terminal de camarero**, en lugar de la palabra «Waitron». Es
  lo primero que la barra deja fuera cuando le falta sitio, y una pantalla estrecha, como la de un
  teléfono, lo deja fuera del todo.
- **La pantalla de inicio de sesión de una caja registradora o de un terminal de camarero**, encima
  del nombre del dispositivo y de la lista de nombres.
- **«Con la tecnología de Waitron»**, que se ve mientras hay un logotipo: bajo el formulario de
  inicio de sesión del panel; en la franja superior del panel con la sesión iniciada, antes de los
  botones del final (en una pantalla estrecha, como la de un teléfono, tras la razón social, en la
  segunda línea de la franja, o debajo de ella si no caben en la misma línea); al pie de la pantalla
  de inicio de sesión de una caja registradora o de un terminal de camarero; y al pie del menú
  **Más** (☰) de un terminal de camarero, bajo **Salir**.
- **Un ticket que se muestra en la pantalla de una caja registradora o de un terminal de
  camarero**, encima del nombre del local. Ahí también tiene prioridad el logotipo de ticket propio
  del departamento, y siempre se ve el logotipo principal, nunca la versión para pantallas oscuras.

La barra superior de una caja registradora todavía no muestra ningún logotipo.

Cada una de las demás pantallas muestra la imagen clara o la oscura según su propio ajuste de
**Tema**. Una pantalla
oscura, cuando el tema no tiene versión para pantallas oscuras, muestra el logotipo principal sobre
una placa blanca.

Las demás pantallas muestran un logotipo nuevo, o dejan de mostrar el que se quitó, cuando adoptan
un cambio de colores, como describe «Guarda un tema», más abajo.

Cuando una de las demás pantallas no puede cargar la imagen, la franja superior del panel muestra
el logotipo de Waitron, la barra de un terminal de camarero muestra la palabra «Waitron» y la
pantalla de inicio de sesión de una caja registradora o de un terminal de camarero no muestra ningún
logotipo, sin dejar un hueco donde iría. No se ve la línea «Con la tecnología de». La pantalla vuelve
a intentar cargar la imagen cada minuto y la muestra en cuanto carga.

## En los tickets y las facturas {#logo-receipts}

El logotipo del tema en uso también se imprime, en puntos negros, encima del nombre del local en los
tickets y las facturas en A4 de un departamento que no tiene logotipo de ticket propio, y de una
venta sin departamento.

El logotipo de ticket propio de un departamento, elegido en su pestaña **Recibos**, siempre tiene
prioridad. Así es como un departamento imprime una imagen distinta de la del resto del local.

En papel se imprime el logotipo principal, nunca la versión para pantallas oscuras.

Guardar un logotipo nuevo, quitarlo o poner otro tema en uso cambia lo que imprime el siguiente
ticket o la siguiente factura, incluida la reimpresión de una venta anterior. Un tema que no está en
uso no imprime nada.

La vista previa de la pestaña **Recibos** de un departamento muestra el logotipo del tema mientras
no hay ningún logotipo de ticket elegido en la pestaña, salvo cuando no se pueden leer los ajustes
de ticket guardados del departamento: entonces no muestra ningún logotipo.

Cuando no se pueden leer los ajustes de ticket de un departamento, sus tickets y facturas no
imprimen ningún logotipo, en lugar de uno que podría no ser el correcto.

## Fija colores y texto a mano {#advanced}

Debajo de las elecciones y de la vista previa, el editor tiene una sección titulada **Avanzado:
fijar colores y texto a mano**. Empieza cerrada cada vez que se abre el editor, y su línea cerrada dice qué
está fijado a mano: «Ninguno fijado a mano. Waitron calcula todos los colores y tamaños de texto.»,
o un recuento y los nombres de los colores, por ejemplo «2 fijados a mano: Página (versión clara),
Texto (versión clara)». Mientras haya colores o tamaños de texto fijados a mano que se leen mal, la línea añade
cuántos, como en «1 fijado a mano: Texto (versión clara) · 1 se lee mal». Pulsa el título para
abrirla.

Dentro, una fila por cada color del tema da su valor en las pantallas claras y en las oscuras, bajo
los títulos **Pantallas claras** y **Pantallas oscuras** en una tarjeta ancha, o con la etiqueta
**Claro** u **Oscuro** en cada valor en una estrecha, cada uno con un selector de color y una casilla para un código de color. Junto al código de
cada valor, o debajo en una pantalla estrecha, un color calculado dice **Calculado**; Botones principales dice **Color de marca**, o
**Corregido** si se eligió un tono legible para ese tipo de pantalla. Cambiar cualquiera de los dos
valores, con el selector o escribiendo un código, fija ese valor a mano y deja el del otro tipo de
pantalla como estaba. Un valor fijado a mano lleva la marca **Fijado a mano**, con **Usar el color
calculado** debajo para volver al valor que calcula Waitron. **Volver a calcularlos todos**, al
final de la sección, devuelve todos los valores a calculados, también los del texto; aparece
desactivado mientras no hay nada fijado a mano. Después de los colores, bajo **Texto**, vienen las
filas del tipo de letra, los tamaños de texto y los grosores, que explica «Fija el texto a mano»,
más abajo.

Un color fijado a mano se queda como lo fijaste cuando cambias el color de marca, el fondo o las
esquinas. Si cambias el color de marca o el fondo mientras hay colores fijados a mano, una nota
debajo del color de marca lo dice, por ejemplo «Has fijado 1 color a mano y se mantiene: Texto
(versión clara). Lo verás en Avanzado.»

Fijar a mano **Botones principales** sustituye el color de marca en ese tipo de pantalla, así que
se descarta el tono legible que se hubiera elegido allí.

Un código debe ser `#` seguido de seis dígitos o letras de la a a la f. Si no lo es, Guardar te lo
indica debajo de esa casilla y no guarda nada, y Avanzado se abre para mostrarlo y no se puede cerrar
hasta que corriges el código.

## Fija el texto a mano {#text-by-hand}

Bajo **Texto**, después de los colores, Avanzado tiene ocho filas: **Tipo de letra**, **Texto
pequeño**, **Texto normal**, **Texto grande**, **Texto muy grande**, **Grosor normal**, **Grosor
medio** y **Grosor de negrita**. Cada una muestra el valor propio de Waitron, con la marca
**Calculado**, hasta que lo cambias:

- **Tipo de letra** ofrece **El del dispositivo**, el tipo de letra que usa cada pantalla salvo que
  se le indique otro, y **Con serifa**, un tipo de letra con pequeños remates en los extremos de las
  letras. Qué tipo de letra con serifa dibuja una pantalla depende del dispositivo.
- Un tamaño es un número entero de píxeles del 8 al 40, escrito o ajustado con − y +. Los de Waitron
  son 12, 14, 18 y 22.
- Un grosor es 400, 500, 600, 700 u 800: cuanto más alto, más grueso. Los de Waitron son 400, 500 y 600.

Cambiar una fila la fija a mano, aunque elijas el valor propio de Waitron: su valor pasa a negrita,
lleva la marca **Fijado a mano**, y **Usar el tamaño calculado**, **Usar el tipo de letra
calculado** o **Usar el grosor calculado**, debajo, la devuelve. **Volver a calcularlos todos**
devuelve las filas del texto junto con los colores.

Un tamaño que fijas es el tamaño al 100 %, y el control **Tamaño del texto** lo agranda igual que
los de Waitron. Fuera del 100 %, cada fila de tamaño dice lo que dibuja, por ejemplo «al 115 %: 16
px», y la línea bajo el control da los tamaños dibujados.

Un tamaño dibujado por debajo de 12 px avisa bajo su fila, por ejemplo «Texto pequeño: 10 px es
menor que 12 px; un texto tan pequeño suele leerse mal.», con un botón que fija el tamaño más
pequeño que dibuja 12 px: **Usar 12 px** al 100 %, o **Usar 9 px (12 px al 130 %)** con el control
al 130 %. Cuenta como algo que se lee mal, igual que un color: lo cuentan la línea cerrada de
Avanzado, **Corregir todos**, el diálogo **Difícil de leer** y la tarjeta Temas.

Un tamaño dibujado por encima del tamaño con el que Waitron comprueba las cajas, que es el de
Waitron al 130 % (16, 18, 23 y 29 px), recibe en cambio una nota: «Texto muy grande: 33 px es mayor
que el tamaño con el que Waitron comprueba las cajas; los nombres largos pueden ocupar más líneas o
cortarse.», con un botón que fija el tamaño más grande dentro de ese límite, por ejemplo **Usar 22
px (29 px al 130 %)**. La nota no es un aviso: nada la cuenta y puedes guardar el tamaño tal cual.

Un tamaño que no es un número entero del 8 al 40 no se usa. Guardar indica «Introduce un número
entero del 8 al 40.» debajo, no guarda nada y abre Avanzado para mostrarlo.

El tipo de letra y los grosores llegan a todas las pantallas que pinta el tema, y toda palabra en
negrita, todo título y toda cabecera de tabla siguen el **Grosor de negrita**. El papel impreso, el
botón de inicio de sesión de Google y el tipo de letra de los códigos conservan la letra de
Waitron.

## Cuando un color se lee mal {#hard-to-read}

Algunos colores de marca hacen que los botones se vean mal. Un amarillo soleado como `#f2c94c`,
por ejemplo, apenas destaca en una pantalla clara. Cuando ocurre, aparece un aviso debajo del color
de marca: «Los botones de este color se ven mal en pantallas claras.»

Si un tono de tu color se leería bien, el aviso trae un botón que lo ofrece. Para ese amarillo con
el fondo Neutro, el botón dice **Usar #a78612 en pantallas claras**. Púlsalo y las pantallas claras
usan ese tono, mientras que las oscuras conservan tu color. La línea pasa a decir «Botones en
pantallas claras:» con el tono, y **Deshacer** devuelve tu color.

Un tono que eliges pertenece a su color. Elegir otro color de marca lo descarta, y volver al color
guardado del tema recupera su tono guardado, salvo en un tipo de pantalla cuyos **Botones
principales** estén fijados a mano en Avanzado. Cambiar el fondo o las esquinas lo conserva.

Un color fijado a mano en Avanzado también se comprueba. Si se lee mal, un aviso debajo de su fila
nombra el tipo de pantalla y sobre qué cuesta leerlo, o qué cuesta leer encima. Texto fijado en
`#9a9a9a` en las pantallas claras, por ejemplo, avisa «Pantallas claras: cuesta leerlo sobre Página,
Tarjetas, …», nombrando cada color sobre el que cuesta leerlo. Si un tono se leería bien, un botón
lo ofrece: para ese gris dice **Usar #585858**. Púlsalo y el valor toma ese tono, y aparece una
línea que dice «Pantallas claras: corregido desde #9a9a9a» con **Deshacer**, que devuelve tu color.
Deshacer sigue ahí hasta que vuelves a cambiar ese valor o se cierra el editor.

Algunos colores fijados a mano no tienen ningún tono que se lea bien. Su aviso termina en «Elige
otro color.» o, si otro color fijado a mano lo impide, lo nombra: con Página en `#777777` y Texto en
`#888888` en las pantallas claras, el aviso de Página termina en «mientras el color Texto está
fijado a mano en #888888».

Cuando dos o más avisos ofrecen cada uno una corrección, una línea debajo del editor cuenta los
colores y tamaños de texto que se leen mal y ofrece **Corregir todos**, que aplica todas las correcciones a la vez,
también las de los colores fijados a mano.

Waitron nunca rechaza un color. Un aviso es un consejo: puedes guardar el color que elegiste y
quedarte con él.

Un tamaño de texto dibujado por debajo de 12 px cuenta igual como algo que se lee mal, y **Corregir
todos** y **Corregir y guardar** también aplican su corrección: consulta [Fija el texto a
mano](appearance.md#text-by-hand).

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
cada color o tamaño de texto afectado. Ofrece tres opciones:

- **Volver** te devuelve al editor sin guardar nada.
- **Guardar de todos modos** guarda los colores tal como los elegiste.
- **Corregir y guardar** aplica todas las correcciones y después guarda. El diálogo solo la ofrece
  cuando corregirlo todo no dejaría ningún aviso.

Cuando Guardar pide un nombre, **Guardar de todos modos** y **Corregir y guardar** abren el diálogo
del nombre en lugar de guardar al momento. Mientras su interruptor está activado, el diálogo del
nombre muestra los colores y tamaños de texto que siguen leyéndose mal, para que los veas antes de que el tema llegue
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
cada color o tamaño de texto que sigue leyéndose mal, para que también lo vea la próxima persona que abra la página.

Mientras editas uno de los temas propios del local, el editor ofrece también **Guardar como tema
nuevo…**. Abre el diálogo del nombre con el nombre del tema seguido de «(copia)», guarda tus
elecciones con el nombre que le des, deja el tema que estabas editando tal como se guardó por última
vez y cierra el editor. Su interruptor **Usarlo ya en todas las pantallas** empieza activado cuando
el tema que editas está en uso. Si algún color o tamaño de texto sigue leyéndose mal, primero aparece el diálogo
**Difícil de leer**, igual que con Guardar. Como Guardar, te indica debajo del campo si un código de
color que escribiste no es válido, y no guarda nada hasta que lo corriges.

## Los temas del local {#themes}

La tarjeta **Temas** muestra todos los temas del local, primero el de Waitron. Cada fila muestra el
**Nombre** del tema, sus **Colores** y su **Estado**. Los colores son tres puntos: el color de
marca y después el color de la página de la versión clara y de la versión oscura. Cuando la tarjeta
es estrecha, como en un teléfono o junto al menú lateral en una pantalla pequeña, no muestra los
colores, y en un teléfono las etiquetas de estado van tras el nombre del tema en lugar de en una
columna propia. Las etiquetas de estado dicen qué tema está **En uso** y cuántos de los colores y tamaños
de texto de un tema se leen mal, por ejemplo «2 se leen mal». El tema de Waitron lleva la etiqueta
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
pantallas?». Si el tema tiene colores o tamaños de texto que se leen mal, la pregunta los muestra bajo «Se leen mal:».
**Usarlo** pone el tema en uso, y **Volver** no cambia nada.

Cuando un tema pasa a estar en uso, el panel que estás usando cambia a él al momento y los demás
paneles abiertos a la vez lo siguen por su cuenta. Las cajas con la sesión iniciada lo siguen igual
que cuando guardas el tema en uso, como explica «Guarda un tema», más arriba. Waitron nunca rechaza
un tema porque se lea mal: la lista está ahí para que elijas sabiéndolo.

## Elimina un tema {#delete}

**Eliminar** pregunta antes, nombrando el tema y avisando de que no se puede deshacer. Si el tema es
el que está en uso, el diálogo lo dice bajo «Qué cambia»: al eliminarlo, se pone el tema de Waitron
en todas las pantallas, y las pantallas cambian igual que cuando pones un tema en uso.
