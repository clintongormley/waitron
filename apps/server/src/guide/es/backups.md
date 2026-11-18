# Copias de seguridad

Usa **Copias de seguridad** en el panel para elegir dónde guardas las copias y preparar lo que necesitas si falla el servidor. Guarda una copia fuera del servidor para no perder tu única copia junto con él.

## Paquete de recuperación {#recovery-pack}

Elige **Hacer paquete de recuperación** y completa la identificación que te pida. Usa **Descargar PDF** o **Abrir para imprimir** y guarda el paquete bajo llave, fuera del servidor.

Revisa esta tarjeta después de cambiar los ajustes de las copias o las claves. Sigue sus indicaciones para hacer un paquete nuevo y conserva los anteriores que aún nombre. Si pierdes un paquete o queda expuesto, sigue [Pérdidas habituales](data-protection.md#breach-losses). Para el inicio de emergencia, consulta [Consultar el inicio de emergencia en Cloud](servers.md#cloud-emergency).

## Exportar la configuración {#configuration-export}

Para reutilizar tu configuración en un local nuevo, introduce y confirma una contraseña de exportación de al menos 12 caracteres y elige **Descargar configuración**. Guarda el archivo descargado y su contraseña en un lugar seguro. Si lo que necesitas es recuperar este local desde una copia, sigue [Recuperar desde una copia](backup-recovery.md#source).

## Copias programadas {#archives}

Puedes guardar copias en una carpeta de este servidor o en un bucket compatible con S3. Para un bucket, introduce sus datos de conexión.

Elige los días y la hora y establece cuántas copias guardar y qué antigüedad pueden tener. Deja seleccionado **Que lo decida el servidor** si quieres hacer las copias tras el cierre y los informes del día. Guarda la clave de recuperación como se indica abajo y elige **Activar las copias**.

Si puedes elegir **Waitron Cloud**, selecciona **Todos los días** para que Cloud reciba las copias según la programación de tu local. Waitron Cloud decide cuándo caducan sus copias antiguas.

Con las copias activadas, usa **Cambiar el destino o la programación** y **Guardar cambios** para ajustarlas. Revisa la última copia de cada destino y atiende los fallos que muestre.

## Guarda tus claves {#keys}

Usa **Copiar** o **Descargar archivo de clave** para guardar la clave de recuperación en un lugar seguro fuera del servidor. Marca **He guardado esta clave en un lugar seguro** cuando lo hayas hecho.

Al cambiar la clave de recuperación, usa **Mostrar la clave actual** para guardar también la clave antigua. Conserva las claves y los paquetes antiguos de las copias que aún guardes. Consulta [Identifícate ante la copia elegida](backup-recovery.md#proof) para saber qué necesitas al restaurar.

## Copia continua en tu bucket {#bucket-copy}

Demostración no ofrece esta copia.

En **Copia continua en tu bucket**, introduce los datos de conexión del bucket. Elige **Probar** y después **Guardar y activar**. Revisa **Última copia confirmada** y **Cambios que aún no están en el bucket** para saber cómo de reciente es tu copia.

Usa **Cambiar de bucket** para actualizar la conexión. Si necesitas restaurar la copia en otro servidor, sigue [Elige tu copia](backup-recovery.md#source).
