# Impresoras

## Añadir una impresora {#add-printer}

En **Impresoras**, abre la pestaña **Impresoras** y elige **Añadir impresora**. Waitron busca
impresoras de red, USB y Bluetooth. Elige **Añadir** junto a una impresora de recibos, cambia el
nombre si quieres y vuelve a elegir **Añadir**; después se abre la calibración. Una impresora de
oficina muestra en su lugar **Añadir como impresora A4**.

Una impresora Bluetooth debe estar antes en modo de emparejamiento. Elige **Emparejar y añadir**
junto a ella, introduce su PIN y vuelve a elegir **Emparejar y añadir**. Si es una impresora nueva, se
abre el diálogo del nombre: elige **Añadir**.

Espera a que termine el emparejamiento o la desvinculación antes de iniciar otra solicitud
en el mismo agente de impresión.

Si no aparece una impresora de red, abre **Comprobar una dirección conocida**, escribe su dirección
IP y elige **Conectar**.

Para quitar una impresora de recibos o de estación, elige **Eliminar** en su menú o en sus detalles.
La confirmación indica las asignaciones que se eliminan y el trabajo que finaliza. Para volver a
usarla, elige **Añadir impresora** y después **Añadir** junto a ella. Si se reconoce, conserva su
nombre y calibración, así que no necesitas repetirlos. Vuelve a asignar sus dispositivos y
estaciones de preparación.

Para imprimir comandas de estación, elige la impresora en cada estación en **Estaciones de
preparación**. Una impresora elegida en todas las estaciones imprime todo lo que se envía, para el
pase. Para añadir una impresora a todas a la vez, elige **Poner en todas las estaciones** en su
menú. Cuando tienes dos o más estaciones, **Añadir una estación** empieza con las impresoras que
ya usan todas las estaciones. La segunda estación empieza sin ninguna, así que vuelve a elegir
**Poner en todas las estaciones** después de añadirla.

## Calibrar una impresora de recibos {#calibrate}

La calibración tiene tres pasos. Se abre al añadir una impresora de recibos nueva, y **Calibrar
impresora** en los detalles de la impresora la repite.

- Elige **Imprimir prueba de ancho**. En el papel, elige el último número de la regla que se ve
  entero y mide el cuadrado negro del código QR sin su borde blanco. Waitron muestra el ancho del
  papel y la resolución de impresión que resultan. Si dice que no coinciden, vuelve a medir.
- Elige **Imprimir recibo de muestra** y comprueba que todas las letras salen con sus acentos y
  que el recibo ocupa el ancho del papel.
- Indica si hay un cajón portamonedas conectado y pruébalo. Activa **Impresora portátil** para una
  impresora que lleva una persona, como una de cinturón. Elige **Guardar**.

## Detalles de la impresora {#printer-details}

Elige el nombre de una impresora en la pestaña **Impresoras** o en la **Cola de impresión** para
abrir sus detalles. **Editar** cambia su nombre y, si
es una impresora de recibos de red, su dirección. **Calibrar impresora** repite la calibración.
Los detalles de una impresora A4 no tienen calibración;
**Imprimir página de prueba** la comprueba. Para quitarla, elige **Eliminar** en su menú. La
confirmación indica las asignaciones que se eliminan y el trabajo que finaliza. Para volver a
usarla, elige **Añadir impresora**, después **Añadir como impresora A4** junto a ella y **Añadir**.
Conserva su nombre y ajustes guardados. Vuelve a asignar sus dispositivos y perfiles de dispositivo.

Después de importar una configuración, busca sus impresoras A4 con **Añadir impresora** y vuelve a añadirlas.

En **Dispositivos**, elige **Editar** en el menú de la fila del dispositivo. Los nombres de
equipos en gris y cursiva heredan el valor del perfil. Elige un equipo para fijarlo en este
dispositivo; vuelve a elegir la opción en gris para heredarlo. La tabla de Dispositivos usa el
mismo estilo.

Waitron te avisa cuando la batería de un dispositivo está baja; si su lectura de batería en **Dispositivos** está en gris o indica **Sin datos**, comprueba su carga en el propio dispositivo.

En **Dispositivos**, consulta **Impresora de facturas** para ver dónde imprime las facturas cada
dispositivo. **· A4** tras el nombre identifica una impresora A4.

Una impresora Bluetooth que desvinculaste queda deshabilitada. Para volver a usarla, ponla en modo
de emparejamiento, abre sus detalles y elige **Emparejar de nuevo**.

## Cola de impresión {#print-queue}

Abre **Cola de impresión** para ver por qué espera un trabajo. Para añadir o eliminar un ordenador que imprime, consulta [Agentes de impresión](printers.md#print-agents). Si ningún agente ve una impresora
USB o Bluetooth, comprueba la conexión de la impresora y su agente de impresión. El mensaje de
conexión puede aparecer junto al último error de impresión comunicado.

Las órdenes del cajón no se pueden reenviar. Si el TPV muestra **El cajón no se abrió**, comprueba
la alimentación y la conexión de la impresora y pulsa **Abrir cajón** si aún necesitas abrirlo. Si no se recibió
el resultado, comprueba si el cajón se abrió antes de volver a abrirlo.

**Reimprimir** vuelve a enviar una impresión, a su impresora o a otra: un ticket o una factura, a
cualquier impresora de tickets; una comanda de estación o un justificante de devolución, a una al menos
igual de ancha. Una impresión que espera en una impresora deshabilitada, o en una impresora USB o Bluetooth que
ningún agente ve, se puede mover igual, y allí se cancela. Las demás impresiones solo se reimprimen en su propia impresora. Un justificante de pago solo se vuelve a imprimir desde aquí:
reimprime cuanto antes uno perdido, porque la lista guarda solo las últimas impresiones terminadas.

Si la cola indica que los datos guardados de una impresión han caducado, abre **Pedidos**
para imprimir el ticket o la factura desde la venta. Ya no puedes reimprimir desde ese trabajo
comandas de estación, recibos de devolución, comprobantes de pago ni informes si sus datos se han eliminado.

## Agentes de impresión {#print-agents}

En **Impresoras**, abre **Agentes** y elige **Eliminar** en el menú del agente. Las impresoras accesibles solo a través de este agente no pueden imprimir hasta que lo añadas de nuevo; siguen en la lista.

Para usar un agente en el que sigas confiando, elige **Añadir un agente** y **Añadir** junto a su nombre guardado, incluido el agente marcado como **En este servidor**. Los trabajos que sigan pendientes pueden imprimirse cuando vuelva.

Un agente marcado **En otro servidor** pertenece a otro servidor del local, como el de reserva. Si ese servidor sigue en uso, conserva el agente: vuelve a imprimir cuando ese servidor pase a ser el principal.

Para añadir otro agente, sigue los pasos de **Añadir un agente** y comprueba su número. Tras vincular un agente nuevo, busca y añade de nuevo sus impresoras A4.

## Lectores de tarjetas {#card-readers}

Para añadir un lector, abre **Pagos con tarjeta** en Hardware y elige **Añadir lector** encima de la tabla.
Elige el proveedor si se te pide y añade un lector de su lista o vincula uno nuevo.
Si no hay ningún proveedor conectado, elige **Configurar proveedores de tarjeta** para configurar uno primero.

Antes de cobrar, abre **Hardware → Dispositivos**, selecciona tu dispositivo y elige **Editar** para asignarle un lector de tarjetas. Si no aparece el porcentaje de batería de un lector, comprueba su carga en el propio lector.

En **Pagos con tarjeta**, busca el lector en **Lectores de tarjetas** y elige **Eliminar** en su menú. La confirmación indica las asignaciones que se eliminan. Si hay un cobro en curso, deja que termine primero.

Cuando vuelvas a añadir un lector eliminado, si se reconoce el registro, verás el nombre y los ajustes de impresión guardados: elige **Añadir** y vuelve a asignarlo a dispositivos y perfiles. En caso contrario, vincúlalo siguiendo los pasos del proveedor.

Elige **Desvincular de …** para quitar solo su registro en el proveedor y conservarlo en la lista de Waitron. Tendrás que añadirlo o vincularlo de nuevo antes de usarlo.
