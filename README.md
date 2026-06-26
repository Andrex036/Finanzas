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

- Inicio: resumen mensual de recursos, gastos, disponible y porcentaje usado.
- Presupuesto: ingreso de recursos del mes como nomina, arriendos, trabajos profesionales, proyectos y otros ingresos.
- Movimientos: registro, edicion y eliminacion de gastos por categoria.
- Categorias personalizadas desde la opcion `Otro` en Movimientos.
- Fecha de registro, fecha final de pago, estado Pendiente/Pagado y alertas de vencimiento.
- Boton `Pagado` para marcar un movimiento pendiente como pagado.
- Opcion para copiar los movimientos del mes anterior al mes actual.
- Guardado automatico en LocalStorage.
- Diseno responsive para escritorio, tablet y movil.

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

1. Entra a Presupuesto y registra los recursos esperados del mes.
2. Entra a Movimientos y registra cada gasto.
3. Revisa Inicio para ver cuanto entro, cuanto se gasto y cuanto queda disponible.
