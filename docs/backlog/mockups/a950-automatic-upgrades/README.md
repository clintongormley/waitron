<a id="a950-checking-an-update-and-returning-to-the-previous-version"></a>

# A950: checking a clean restart before rollback closes

[Revised design proposal](../../../superpowers/specs/2026-10-27-a950-automatic-upgrades-design.md),
§8, is the complete EN/ES screen contract.

**Revised 28 October 2026; needs-owner-review for the whole design.** The owner's closing rule
is resolved: successful restart, clean database upgrade and a running, answering system end
rollback automatically, before normal requests and duties resume. No first order, first action
or acceptance button ends it. Automatic-on, 03:00–05:00 and spare-first remain proposals.
No whole-design or build approval is recorded.

These revised static illustrations use example data and theme tokens. They prove no updater,
filesystem rollback, payment recovery, publication or two-box handover. Actual product
rendering/accessibility and runtime qualification remain build gates.

- [Checking the new version](01-upgrade-check.png): main-box validation is genuinely open.
  Explain all three checks, with orders/changes paused. Show **View details**, the separately
  authorised **Return to previous version**, and **Leave this screen**. Return offers on-screen
  admin authentication; Stop only leaves the screen and does not stop checks. Remove Return as
  soon as host closure wins, including while an old screen or auth prompt is open.
- [Previous version running again](02-rollback-complete.png): the failed candidate accepted no
  normal work; complete old state restoration, old-service checks and RESTORED are positively
  confirmed before claiming orders can resume. The failed version is not retried automatically.
  An uncertain journal/restore or postclosure failure uses its separate design state.

- [Update complete](03-upgrade-complete.png): the three checks passed and closure is recorded.
  Normal work is available, with no return or acceptance action.

The three short filenames are English, light theme, 390 px. Each also has
`-<en|es>-<light|dark>-<390|1280>.png` variants for both themes and phone/desktop widths.
The variants were regenerated together. There is no separate healthy READY illustration.

| State | English copy | Texto en español |
| --- | --- | --- |
| `01-upgrade-check` | **Checking the update**. “Waitron is checking that version {version} restarted successfully, the database upgraded cleanly and the system is running and answering. Orders and changes are paused during these checks. If a check fails, Waitron will return to the saved previous version and state.” **View details**, **Return to previous version**, **Leave this screen**. | **Comprobando la actualización**. «Waitron está comprobando que la versión {version} se ha reiniciado correctamente, que la base de datos se ha actualizado sin errores y que el sistema funciona y responde. Los pedidos y los cambios están en pausa durante estas comprobaciones. Si alguna falla, Waitron volverá a la versión y al estado anteriores guardados.» **Ver detalles**, **Volver a la versión anterior**, **Salir de esta pantalla**. |
| `02-rollback-complete` | **Previous version restored**. “Version {failedVersion} failed its checks. Version {oldVersion} and the saved state have been restored and checked. No changes were accepted on the new version. You can take orders again. This update will not be tried automatically again.” Show the actual failure. **Open till**, **View details**, **Leave this screen**. | **Versión anterior restaurada**. «La versión {failedVersion} no ha superado las comprobaciones. Se han restaurado y comprobado la versión {oldVersion} y el estado guardado. No se aceptaron cambios en la versión nueva. Ya puedes tomar pedidos. Esta actualización no se volverá a intentar automáticamente.» Mostrar el fallo real. **Abrir caja**, **Ver detalles**, **Salir de esta pantalla**. |
| `03-upgrade-complete` | **Update complete**. “Version {version} restarted successfully. The database checks passed and Waitron is running and answering. Normal work is enabled.” **Open till**, **View details**, **Leave this screen**. No return or acceptance action. | **Actualización completada**. «La versión {version} se ha reiniciado correctamente. La base de datos ha superado las comprobaciones y Waitron funciona y responde. Ya puedes trabajar con normalidad.» **Abrir caja**, **Ver detalles**, **Salir de esta pantalla**. Sin acción de volver ni de aceptar. |
| Postclosure failure, specified in design; no existing filename | **Waitron needs repair**. “Version {version} passed the restart, database and running-system checks. Returning to the saved previous state is no longer available. Waitron now needs repair using its current state.” Show current fault and actual availability separately. **View details**, **Download report**, **Leave this screen**. | **Waitron necesita una reparación**. «La versión {version} ha superado las comprobaciones de reinicio, base de datos y funcionamiento del sistema. Ya no se puede volver al estado anterior guardado. Ahora es necesario reparar Waitron conservando su estado actual.» Mostrar el fallo actual y la disponibilidad real por separado. **Ver detalles**, **Descargar informe**, **Salir de esta pantalla**. |

The failure-restoration example cannot describe an explicit return as a failed check. For an
explicit return substitute “You chose to return before checks finished” / «Has elegido volver
antes de que terminaran las comprobaciones». Show the design's inspection state whenever the
journal or restore is uncertain. A spare completion says it is ready to follow, not ready to sell.
