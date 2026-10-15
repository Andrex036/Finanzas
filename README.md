# Finanzas Familiares

App web estatica para control financiero personal/familiar. Funciona en el navegador con LocalStorage, sin servidor, login ni base de datos externa.

## Abrir localmente

Opcion recomendada con servidor local estatico:

```bash
python -m http.server 4173
```

Luego abre:

```text
http://localhost:4173/
```

La app no necesita backend ni base de datos. El servidor local solo entrega los archivos estaticos al navegador; los datos se guardan en LocalStorage.

## Funciones incluidas

- Inicio: resumen mensual del saldo disponible actual y el saldo proyectado despues de las obligaciones.
- Inicio incluye indicadores de ingresos, pagos, obligaciones pendientes y vencidas, compromiso de recursos, distribucion por categoria, estado de obligaciones y evolucion de seis meses. Las barras incluyen sus importes textuales y el diseño se adapta a pantallas moviles.
- Mi Futuro: planes de ahorro, metas con progreso, distribución mensual, destinos financieros, calendario de aportes, registro auditable de transferencias y retiros, e historial.
- El dinero libre para gastar de Mi Futuro resta las transferencias de ahorro confirmadas del saldo proyectado del mes. Estas transferencias internas no se convierten en gastos ni modifican los saldos de Inicio, Presupuesto o Movimientos.
- Simulador de productos de ahorro con tasas efectivas o nominales, capitalización, aportes, costos y retenciones. Los resultados son proyecciones hipotéticas, no rendimientos garantizados ni saldos reales.
- Presupuesto: registro separado del ingreso esperado y del importe efectivamente recibido.
- Movimientos: registro del valor total de cada obligacion, el importe pagado y el saldo pendiente.
- Categorias personalizadas desde la opcion `Otro` en Movimientos.
- Fecha de registro, fecha limite y estados calculados Pendiente/Parcial/Pagado/Vencido, con alertas de vencimiento.
- Boton `Pagado` para marcar un movimiento pendiente como pagado.
- Opcion para copiar los movimientos del mes anterior al mes actual.
- Guardado automatico en LocalStorage.
- Respaldo JSON descargable y recuperacion por restauracion o combinacion.
- Diseno responsive para escritorio, tablet y movil.

## Respaldo y recuperación

En Inicio, abre **Respaldo y recuperación** para descargar o importar un archivo JSON. Antes de recuperar, la aplicación valida la estructura, los importes y la versión y muestra el contenido detectado.

- **Restaurar** sustituye los datos actuales solo tras confirmación y luego de iniciar la descarga y el archivo local de una copia previa.
- **Combinar** conserva los datos y configuración actuales, agrega registros nuevos y deja intacto cualquier registro con el mismo identificador pero contenido distinto; esos conflictos se muestran antes de confirmar.
- Las migraciones crean un archivo local con el contenido original antes de actualizar el esquema. Nunca se utiliza `eval()` ni se envían datos financieros a servicios externos.
- Los datos permanecen en `localStorage` de este navegador y pueden perderse al borrar sus datos o cambiar de dispositivo. Conserva el archivo descargado en otro lugar seguro.
- Si el navegador no puede escribir por falta de espacio u otro error, la aplicación informa que los cambios no se guardaron. Los datos dañados o inválidos no se reemplazan automáticamente.

El respaldo exportado contiene configuración, ingresos, gastos, presupuestos, categorías, deudas, metas de ahorro, versión de esquema y fecha de generación. Las versiones anteriores admitidas se migran progresivamente y conservan un historial de migración.

## Publicar en GitHub Pages

1. Sube la carpeta `finanzas-app` a un repositorio.
2. En GitHub, ve a Settings > Pages.
3. Selecciona la rama y carpeta donde esta `index.html`.
4. Guarda y abre la URL generada.

## Publicar en Netlify

1. Entra a Netlify.
2. Arrastra la carpeta `finanzas-app` al area de deploy manual.
3. Netlify publicara el sitio sin configuracion adicional.

## Publicar en Vercel

1. Crea un proyecto en Vercel conectado al repositorio.
2. Usa la carpeta `finanzas-app` como raiz del proyecto si aplica.
3. No requiere comando de build.
4. El output directory puede quedar vacio o apuntar a la raiz.

## Uso basico

1. Entra a Presupuesto y registra por separado el ingreso esperado y lo que ya recibiste.
2. Entra a Movimientos y registra el total de cada gasto y cuanto has pagado hasta ahora.
3. Revisa Inicio: el saldo disponible descuenta solo ingresos recibidos y pagos realizados; el saldo proyectado tambien descuenta los saldos pendientes, incluidos los vencidos.

## Criterio contable

Los movimientos conservan `valorPresupuestado` como importe total, `valorPagado` como importe efectivamente abonado y `valorFaltante` como el saldo pendiente (nunca negativo). El modelo guarda `versionModeloFinanciero` y, para registros historicos ambiguos, `migracionFinanciera.original` conserva los valores anteriores y la regla aplicada. Un registro historico con estado `Pendiente` no se considera pagado durante la migracion.

El saldo disponible actual es ingresos recibidos menos gastos pagados. El saldo proyectado es el saldo actual menos las obligaciones pendientes. Ambos se calculan desde los registros del periodo y usan valores enteros en COP.

Los planes, metas, distribuciones, destinos, aportes programados, transferencias y retiros se guardan localmente en el mismo respaldo versionado. Las metas conservan su saldo inicial reconocido y el progreso se calcula desde transferencias confirmadas menos retiros. Una transferencia corregida o anulada queda en el historial para auditoría. El saldo declarado de un destino es una referencia y no se suma a los aportes contabilizados para evitar duplicarlos.

La suite automatizada (cálculos, persistencia, periodos y operaciones de formularios) se ejecuta con:

```bash
node --test
```
