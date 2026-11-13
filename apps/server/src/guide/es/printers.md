# Impresoras

## Añadir una impresora {#add-printer}

En **Impresoras**, abre la pestaña **Impresoras** y elige **Añadir impresora**. Waitron busca
impresoras de red, USB y Bluetooth. Elige **Añadir** junto a una impresora de recibos, cambia el
nombre si quieres y vuelve a elegir **Añadir**; después se abre la calibración. Una impresora de
oficina muestra en su lugar **Añadir como impresora A4**.

Una impresora Bluetooth debe estar antes en modo de emparejamiento. Elige **Emparejar y añadir**
junto a ella, introduce su PIN y vuelve a elegir **Emparejar y añadir**. Si es una impresora nueva, se
abre el diálogo del nombre: elige **Añadir**.

Si no aparece una impresora de red, abre **Comprobar una dirección conocida**, escribe su dirección
IP y elige **Conectar**.

Para quitar una impresora de recibos o cocina, elige **Eliminar** en su menú o en sus detalles.
La confirmación indica las asignaciones que se eliminan y el trabajo que finaliza. Para volver a
usarla, elige **Añadir impresora** y después **Añadir** junto a ella. Si se reconoce, conserva su
nombre y calibración, así que no necesitas repetirlos. Vuelve a asignar sus dispositivos y
puestos de cocina.

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
cualquier impresora de tickets; una comanda de cocina o un justificante de devolución, a una al menos
igual de ancha. Una impresión que espera en una impresora deshabilitada, o en una impresora USB o Bluetooth que
ningún agente ve, se puede mover igual, y allí se cancela. Las demás impresiones solo se reimprimen en su propia impresora.

## Agentes de impresión {#print-agents}

En **Impresoras**, abre **Agentes** y elige **Eliminar** en el menú del agente. Las impresoras accesibles solo a través de este agente no pueden imprimir hasta que lo añadas de nuevo; siguen en la lista.

Para usar un agente en el que sigas confiando, elige **Añadir un agente** y **Añadir** junto a su nombre guardado, incluido el agente marcado como **En esta caja**. Los trabajos que sigan pendientes pueden imprimirse cuando vuelva.

Para añadir otro agente, sigue los pasos de **Añadir un agente** y comprueba su número. Tras vincular un agente nuevo, busca y añade de nuevo sus impresoras A4.

## Lectores de tarjetas {#card-readers}

En **Pagos con tarjeta**, busca el lector en **Lectores de tarjetas** y elige **Eliminar** en su menú. La confirmación indica las asignaciones que se eliminan. Si hay un cobro en curso, deja que termine primero.

Para volver a usar el lector, elige **Añadir lector** en su proveedor. Si se reconoce el registro, verás el nombre y los ajustes de impresión guardados: elige **Añadir** y vuelve a asignarlo a dispositivos y perfiles. En caso contrario, vincúlalo siguiendo los pasos del proveedor.

Elige **Desvincular de …** para quitar solo su registro en el proveedor y conservarlo en la lista de Waitron. Tendrás que añadirlo o vincularlo de nuevo antes de usarlo.
