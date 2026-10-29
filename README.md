# Dashboard de Asistencia y Alertas — Falabella Perú

Aplicación web **100% cliente** (HTML + CSS + JavaScript, sin backend) para analizar
la asistencia por sucursal. El usuario sube 3 tipos de archivo (Dotación, Gestión de
Asistencia y Tiempo Extra); la app los normaliza, los cruza por persona y por día,
calcula los KPIs y muestra dashboards, alertas, histórico y controles de calidad.

> 🔒 **Privacidad:** todo se procesa en el navegador. No se envía nada a internet.
> De la Dotación sólo se leen las columnas necesarias; nunca se leen ni guardan
> cuentas bancarias, CTS, montos, correos, celulares, fecha de nacimiento, estado
> civil ni discapacidad.

## Cómo usar

Hay **dos formas de abrirla**, las dos 100% locales y sin internet:

### Opción A — Un solo archivo, con DOBLE CLIC (sin servidor)

Abre **`dashboard.html`** directamente en tu navegador (doble clic). Es la app
completa empaquetada en un único archivo; no necesitas comandos ni `localhost`.
Ideal para repartir a usuarios finales.

> Para regenerarlo tras cambios en el código: `npm run build` (crea
> `dashboard.html` a partir de los módulos de `js/`).

### Opción B — Código modular, con un servidor estático local

Para desarrollar (archivos separados) sí hace falta un servidor estático, porque
el navegador bloquea los ES modules y el Web Worker bajo `file://`:

```bash
npx serve .
# o
python3 -m http.server 8080   # luego entra a http://localhost:8080
```

### Luego, en cualquiera de las dos opciones

1. Ve a **Carga** y arrastra tus archivos `.xlsx`, `.xls` o `.csv`. El tipo se
   detecta automáticamente por los encabezados:
   - **Dotación:** contiene `Nº de documento` + `Grupo de ubicación`.
   - **Asistencia:** contiene `Identificador` + `Permiso` + `Turno`.
   - **Tiempo Extra:** contiene `TE` + `Finales`.
2. La **Dotación** se reemplaza con la última cargada. **Asistencia** y **Tiempo
   Extra** se **acumulan** (varios días/semanas/meses) y se deduplican por
   persona‑día (`keyDia`): gana el archivo cargado más recientemente, porque
   refleja las regularizaciones.
3. Revisa **Calidad** para verificar los controles CT‑01 … CT‑14 y los listados
   de diagnóstico.

Los datos cargados, el histórico de cortes y los parámetros se guardan localmente
en **IndexedDB**.

## Estructura

```
dashboard.html        App completa en un solo archivo (doble clic) — generado
build.mjs             Empaqueta los módulos de js/ en dashboard.html
index.html            App modular (requiere servidor estático)
css/styles.css
js/
  app.js              Controlador de la interfaz (navegación, carga, worker)
  worker.js           Web Worker: parseo + modelo + calidad + dashboards
  config.js           Parámetros por defecto y formato es‑PE
  model.js            Cruces e indicadores derivados por persona‑día
  quality.js          Controles de calidad (CT) y listados
  kpis.js             Motor de KPIs y armado de dashboards (puro)
  charts.js           Gráficos con ECharts (GR‑01…GR‑08)
  dashboards.js       UI de los dashboards Tienda/Logística
  exports.js          Exportación a Excel/CSV
  storage.js          Persistencia en IndexedDB (idb‑keyval)
  parsers/
    common.js         Funciones puras compartidas (fechas, DNI, hh:mm, anclaje)
    dotacion.js       Parser de Dotación + derivados del horario
    asistencia.js     Parser de Asistencia (mapeo por posición) + estadoDia
    tiempoExtra.js    Parser de Tiempo Extra (descarta filas "Totales")
  vendor/             Librerías vendorizadas (ECharts, SheetJS, idb‑keyval)
tests/
  parsers.test.js     Pruebas unitarias de los parsers
  model.test.js       Pruebas del modelo y la calidad
  kpis.test.js        Pruebas del motor de KPIs
  pipeline.test.js    Prueba de integración end‑to‑end
```

## Librerías (vendorizadas localmente en `js/vendor/`)

Las librerías están incluidas en el repo para que la app sea **100% offline**
(no contacta ningún CDN):

- [SheetJS (xlsx)](https://sheetjs.com) `0.18.5` — lectura/escritura de `.xlsx/.xls/.csv`.
- [idb‑keyval](https://github.com/jakearchibald/idb-keyval) `6.2.1` — IndexedDB.
- [Apache ECharts](https://echarts.apache.org) `5.5.1` — gráficos.

> Nota de codificación: los `.csv` se leen en crudo (UTF‑8, con respaldo
> Latin‑1) para no corromper acentos ni fechas `d/mm/yyyy`. Los `.xlsx` traen
> las fechas como objetos `Date`.

## Pruebas

```bash
npm test     # node --test
```

Cubren los casos exigidos: fecha `"Mar 01-09-2026"`, turno
`"10:54 - 22:00(90 mins)"`, DNI con relleno de ceros, filas `"Totales"`, la
validación de horas conocida (`CORPORACION 45 HORAS` vs contrato 48 → *Revisar*),
el `estadoDia`, el `tipoMarcacion`, los cruces del modelo y los controles CT.

## Plan por fases

- [x] **Fase 1 — Parsers + modelo + calidad de datos**
- [x] **Fase 2 — KPIs y dashboards (Tienda / Logística) con ECharts**
- [x] **Fase 3 — Complementarios + alertas por persona**
- [x] **Fase 4 — Histórico de cortes + exportaciones + parámetros** ← *actual*

### Fase 2 (detalle)

- Barra de filtros globales: granularidad (Día/Semana ISO/Mes), rango con
  preselecciones, sucursal (multiselección con buscador), jefe, cargo,
  campañero, sindicalizado, jornada, modelo de días, fiscalización, calendario y
  "Comparar con período anterior".
- 30 tarjetas de KPI con tooltips de fórmula y variación vs. período anterior
  (puntos o %, con flecha verde/roja según la dirección buena del indicador).
- 3 diagnósticos top 5 y los 8 gráficos GR‑01…GR‑08.
- Tabla KPI por sucursal (ordenable, con búsqueda y exportable a Excel/CSV) y
  detalle por persona al hacer clic en una sucursal.
- El Web Worker mantiene el modelo en memoria y calcula cada dashboard bajo
  demanda, así las >200,000 filas nunca cruzan al hilo de la interfaz.

### Fase 3 (detalle)

- **Complementarios:** cortes por segmento (campañero, sindicalizado, jornada,
  modelo de días, calendario, top 15 jefes por tardanzas) con las 12 métricas;
  puntos de marcación (E1/S1/E2/S2 con días, % sobre presentes, minutos,
  promedio y máximo); distribución por rango de atraso; categorías de permiso;
  y feriados trabajados por calendario. Exporta todo a Excel (una hoja por
  corte).
- **Alertas por persona:** agrega las incidencias por persona en el período,
  aplica los umbrales (escalables por granularidad), asigna el nivel (Alta/
  Media) y los motivos, y calcula la reincidencia (semanas consecutivas con
  alerta). Exporta a CSV o a Excel con **una hoja por jefe directo**.

### Fase 4 (detalle)

- **Histórico de cortes:** cada carga de datos nuevos guarda un "corte" (foto de
  las incidencias: faltas, sin marcación, marcación incompleta y trabajó sin
  turno, en Tienda y Logística). Al comparar el corte actual con el anterior se
  clasifican en **nuevas / pendientes / regularizadas**, con % de regularización,
  gráfico de evolución y tablas por sucursal y por jefe. También se puede guardar
  un corte manualmente y eliminar cortes.
- **Parámetros:** pantalla para editar todos los parámetros (umbrales de alerta y
  criterios del nivel Alta, tolerancia de refrigerio, semáforo de malla, lista de
  sindicatos, texto de campañero, mapeo de grupo→dashboard y horas→jornada,
  exclusión de días fuera del empleo, definición de fuga y escala de umbrales por
  granularidad). Se guardan en IndexedDB y, al guardar, se **recalcula** todo
  (la Dotación se vuelve a derivar con los nuevos parámetros).
- **Exportaciones** a Excel/CSV en todas las tablas (dashboards, complementarios,
  alertas).

## Notas de negocio

- La Dotación es una **foto actual**: sucursal, cargo y jefe son los vigentes hoy,
  aunque la asistencia sea de un período pasado.
- Por defecto se excluyen del cálculo los días anteriores a la entrada al puesto y
  los posteriores al cese (configurable). Sin esto, la asistencia de los campañeros
  cae a ~18 %.
