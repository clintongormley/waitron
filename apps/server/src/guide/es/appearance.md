# Apariencia

El panel y las cajas pueden llevar los colores de tu local en lugar del azul de Waitron. La página
**Apariencia**, dentro de **Ajustes**, muestra el aspecto en uso y permite cambiarlo y ver el
resultado antes de que lo vea nadie más.

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
propio ajuste de **Tema**: Claro, Oscuro o Según el dispositivo.

Cualquier persona con el rol **Supervisor** o superior puede abrir esta página y leer la tarjeta.
Solo un **Encargado** o un **Administrador** puede cambiar el aspecto.

## Edita el aspecto {#edit}

La tarjeta muestra **Editar** a un **Encargado** o a un **Administrador** mientras está en uso uno
de los temas propios del local. Mientras está en uso el tema de Waitron, la tarjeta no tiene
**Editar**.

Pulsa **Editar** y la tarjeta abre sus tres elecciones en el mismo sitio:

- **Color de marca**: elige **De Waitron**, una de las muestras, o **Personalizado** para escoger
  cualquier color. También puedes escribir un código como `#1e5b3a` en **Código de color**. Un
  código debe ser `#` seguido de seis dígitos o letras de la a a la f; si no lo es, Guardar te lo
  indica debajo del campo.
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
Si has cambiado algo, Cancelar, y salir de la página, te lo preguntan antes.

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

## Guarda el aspecto {#save}

**Guardar** aparece desactivado hasta que cambias algo. Si nada se lee mal, Guardar guarda el tema
y cierra el editor.

Si algo sigue leyéndose mal, Guardar abre primero el diálogo **Difícil de leer**, con una línea por
cada color afectado. Ofrece tres opciones:

- **Volver** te devuelve al editor sin guardar nada.
- **Guardar de todos modos** guarda los colores tal como los elegiste.
- **Corregir y guardar** aplica todas las correcciones y después guarda. El diálogo solo la ofrece
  cuando corregirlo todo no dejaría ningún aviso.

Cuando el tema que guardaste es el que está en uso, el panel que estás usando cambia al nuevo
aspecto al momento. Los demás paneles abiertos a la vez lo siguen por su cuenta, y una caja con la
sesión iniciada lo sigue la próxima vez que comprueba si su carta ha cambiado, cosa que una caja
que muestra una carta hace cada 15 segundos. Una caja que no muestra ninguna carta lo sigue cuando
vuelve a abrir una, o cuando se reinicia.

Si guardaste de todos modos, la tarjeta Aspecto conserva una línea de aviso por cada color que
sigue leyéndose mal, para que también lo vea la próxima persona que abra la página.
