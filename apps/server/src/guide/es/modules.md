# Módulos

## Configurar un proveedor de tarjeta {#set-up}

Abre **Módulos** en Sistema para configurar un proveedor de tarjetas.

Elige **Configurar** en el menú de la fila del proveedor, introduce sus credenciales y pulsa **Guardar**.
Usa **Cancelar** para descartar los cambios. Un proveedor configurado puede rechazar un pago;
consulta el estado de los lectores en **Pagos con tarjeta**. Para revisar pagos pendientes, abre
**Comprobar pagos con tarjeta** en Informes.

Los filtros **Habilitado**, **Deshabilitado** y **Todos** muestran el estado de un módulo por separado
de su configuración. **Añadir un módulo** muestra los módulos deshabilitados en la misma lista.
Elige **Todas las categorías** para ver todos los módulos opcionales.

## Activar las propinas o una cuenta de prueba {#payment-settings}

Abre **Pagos con tarjeta** y ve a **Ajustes**, debajo de **Lectores de tarjetas**. Activa
**Ofrecer propina en la caja** y pulsa **Guardar**.

En un servidor configurado para Preparar, configura primero las credenciales de prueba de tu
proveedor en **Módulos**. En **Pagos con tarjeta**, dentro de **Ajustes**, activa
**Usar las cuentas de prueba de los proveedores de tarjetas** y pulsa **Guardar**.
Desactiva la opción para volver al simulador de tarjetas.

## Desconectar un proveedor de tarjetas {#disconnect-provider}

Para quitar las credenciales guardadas de un proveedor, elige **Desconectar** en el menú de su
fila en Módulos y después **¿Desconectar este proveedor?** para confirmar. Si un aviso te pide
eliminar o desvincular sus lectores, hazlo en **Pagos con tarjeta** y vuelve aquí para desconectarlo.

## Activar o desactivar un proveedor de tarjetas {#provider-state}

Como administrador, elige **Desactivar** en el menú de la fila del proveedor y confirma.
Antes, elimina o desvincula sus lectores en **Pagos con tarjeta**. Si quedan lectores asociados,
el aviso los nombra y te ofrece un enlace a esa página. Al desactivarlo, conservas sus credenciales
para pagos anteriores y reembolsos.

Para volver a añadir lectores, selecciona **Deshabilitado** o **Todos**, luego elige **Activar** y confirma. **Configurado** indica si sus
credenciales están guardadas; es independiente de **Habilitado**.

## Activar o desactivar Reservas {#bookings-state}

Como administrador, elige **Desactivar** o **Activar** en el menú de la fila de Reservas y confirma.
**Pendiente de reinicio** indica que el cambio está guardado. Abre **Estado del servidor** en Sistema y elige **Reiniciar el servidor**
cuando puedas pausar el servicio. Las cajas se reconectan; comprueba y repite cualquier envío a la estación interrumpido por el reinicio.
Las reservas guardadas permanecen en este equipo cuando Reservas está desactivado.

Si el servidor principal falla repetidamente al arrancar, su página de recuperación ofrece **Desactivar Reservas y volver a arrancar**.
Abre la dirección segura e introduce la contraseña de un administrador activo, o elige **Parar** para dejarlo sin cambios.
Un administrador sin contraseña no puede usar esa acción de recuperación.

## Activar o desactivar Pagos o Normativa laboral española {#module-state}

Como administrador, elige **Desactivar** o **Activar** en el menú de la fila del módulo y confirma.
**Pendiente de reinicio** indica que tu elección está guardada. Abre **Estado del servidor** en Sistema
y elige **Reiniciar el servidor** cuando puedas pausar el servicio. Comprueba y repite cualquier envío a la estación interrumpido por el reinicio.

Antes de desactivar Pagos, desactiva todos los proveedores de tarjeta; elimina o desvincula sus lectores primero.
Tras reiniciar, puedes seguir cobrando en efectivo y registrando tarjetas cobradas en un terminal independiente.
Los pagos anteriores, reembolsos y comprobaciones de pagos siguen disponibles. Para volver a añadir lectores,
activa Pagos, reinicia y activa el proveedor.

Con Normativa laboral española desactivada, puedes seguir planificando turnos y registrando la jornada.
Las comprobaciones de normativa española y la exportación española del registro horario no están disponibles
hasta que actives el módulo y reinicies.
La descarga de tus datos personales conserva tus fichajes en `clock-entries.json`; omite los archivos
`time-record.pdf` y `time-record.csv` en formato español mientras el módulo está desactivado.

## Revisar devoluciones de pedidos abandonados {#abandoned-refunds}

Si un cliente se marcha después de un cobro de SumUp, abre **Comprobar pagos con tarjeta** en Informes y revisa **Devoluciones de pedidos abandonados**.
Waitron intenta una devolución completa cuando SumUp identifica el pago como tuyo, el importe coincide y no existe ninguna devolución.
Un pago cobrado en el lector fuera de Waitron queda para que lo revises.

**Devolución confirmada** significa que SumUp indica que se ha devuelto todo el importe. Si no está confirmada, usa su fecha de cobro, referencia e importe para comprobarlo en SumUp antes de devolverlo allí para no devolver el dinero dos veces.
Revisa esta lista aunque siga abierta una advertencia anterior en Alertas.
