# Módulos

## Configurar un proveedor de tarjeta {#set-up}

Abre **Módulos** en Ajustes, o elige **Configurar proveedores de tarjeta** en **Pagos con tarjeta**.
El enlace de Pagos con tarjeta muestra todos los proveedores, incluidos los que aún necesitan configuración.

Elige **Configurar** en el menú de la fila del proveedor, introduce sus credenciales y pulsa **Guardar**.
Usa **Cancelar** para descartar los cambios. Un proveedor configurado puede rechazar un pago;
consulta el estado de los lectores y los pagos pendientes en **Pagos con tarjeta**.

Los filtros **Habilitado**, **Deshabilitado** y **Todos** muestran el estado de un módulo por separado
de su configuración. **Añadir un módulo** muestra los módulos deshabilitados en la misma lista.
Elige **Todas las categorías** para ver todos los módulos opcionales. Reservas se puede activar o desactivar; los demás módulos opcionales aún no.

## Activar o desactivar un proveedor de tarjetas {#provider-state}

Como administrador, elige **Desactivar** en el menú de la fila del proveedor y confirma.
Antes, elimina o desvincula sus lectores en **Pagos con tarjeta**. Si quedan lectores asociados,
el aviso los nombra y te ofrece un enlace a esa página. Al desactivarlo, conservas sus credenciales
para pagos anteriores y reembolsos.

Para volver a añadir lectores, selecciona **Deshabilitado** o **Todos**, luego elige **Activar** y confirma. **Configurado** indica si sus
credenciales están guardadas; es independiente de **Habilitado**.

## Activar o desactivar Reservas {#bookings-state}

Como administrador, elige **Desactivar** o **Activar** en el menú de la fila de Reservas y confirma.
**Pendiente de reinicio** indica que el cambio está guardado. Abre **Estado del servidor** en Ajustes y elige **Reiniciar el servidor**
cuando puedas pausar el servicio. Las cajas se reconectan; comprueba y repite cualquier envío a cocina interrumpido por el reinicio.
Las reservas guardadas permanecen en este equipo cuando Reservas está desactivado.

Si el servidor principal falla repetidamente al arrancar, su página de recuperación ofrece **Desactivar Reservas y volver a arrancar**.
Abre la dirección segura e introduce la contraseña de un administrador activo, o elige **Parar** para dejarlo sin cambios.
Un administrador sin contraseña no puede usar esa acción de recuperación.

## Revisar devoluciones de pedidos abandonados {#abandoned-refunds}

Si un cliente se marcha después de un cobro de SumUp, abre **Pagos con tarjeta** y revisa **Devoluciones de pedidos abandonados**.
Waitron intenta una devolución completa cuando SumUp identifica el pago como tuyo, el importe coincide y no existe ninguna devolución.
Un pago cobrado en el lector fuera de Waitron queda para que lo revises.

**Devolución confirmada** significa que SumUp indica que se ha devuelto todo el importe. Si no está confirmada, usa su fecha de cobro, referencia e importe para comprobarlo en SumUp antes de devolverlo allí para no devolver el dinero dos veces.
Revisa esta lista aunque siga abierta una advertencia anterior en Alertas.
