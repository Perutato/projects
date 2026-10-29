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

1. Abre `index.html` con un servidor estático (necesario por el uso de ES modules
   y Web Workers). Por ejemplo:
   ```bash
   npx serve .
   # o
   python3 -m http.server 8080
   ```
   Luego entra a `http://localhost:8080`.
2. Ve a **Carga** y arrastra tus archivos `.xlsx`, `.xls` o `.csv`. El tipo se
   detecta automáticamente por los encabezados:
   - **Dotación:** contiene `Nº de documento` + `Grupo de ubicación`.
   - **Asistencia:** contiene `Identificador` + `Permiso` + `Turno`.
   - **Tiempo Extra:** contiene `TE` + `Finales`.
3. La **Dotación** se reemplaza con la última cargada. **Asistencia** y **Tiempo
   Extra** se **acumulan** (varios días/semanas/meses) y se deduplican por
   persona‑día (`keyDia`): gana el archivo cargado más recientemente, porque
   refleja las regularizaciones.
4. Revisa **Calidad** para verificar los controles CT‑01 … CT‑14 y los listados
   de diagnóstico.

Los datos cargados, el histórico de cortes y los parámetros se guardan localmente
en **IndexedDB**.

## Estructura

```
index.html
css/styles.css
js/
  app.js              Controlador de la interfaz
  worker.js           Web Worker: parseo + modelo + calidad (fuera del hilo UI)
  config.js           Parámetros por defecto y formato es‑PE
  model.js            Cruces e indicadores derivados por persona‑día
  quality.js          Controles de calidad (CT) y listados
  storage.js          Persistencia en IndexedDB (idb‑keyval)
  parsers/
    common.js         Funciones puras compartidas (fechas, DNI, hh:mm, anclaje)
    dotacion.js       Parser de Dotación + derivados del horario
    asistencia.js     Parser de Asistencia (mapeo por posición) + estadoDia
    tiempoExtra.js    Parser de Tiempo Extra (descarta filas "Totales")
tests/
  parsers.test.js     Pruebas unitarias de los parsers
  model.test.js       Pruebas del modelo y la calidad
```

## Librerías (CDN, cargadas en el navegador)

- [SheetJS (xlsx)](https://sheetjs.com) — lectura de `.xlsx/.xls/.csv`.
- [idb‑keyval](https://github.com/jakearchibald/idb-keyval) — IndexedDB.
- Apache ECharts — gráficos (se integra en la Fase 2).

## Pruebas

```bash
npm test     # node --test
```

Cubren los casos exigidos: fecha `"Mar 01-09-2026"`, turno
`"10:54 - 22:00(90 mins)"`, DNI con relleno de ceros, filas `"Totales"`, la
validación de horas conocida (`CORPORACION 45 HORAS` vs contrato 48 → *Revisar*),
el `estadoDia`, el `tipoMarcacion`, los cruces del modelo y los controles CT.

## Plan por fases

- [x] **Fase 1 — Parsers + modelo + calidad de datos** ← *actual*
- [ ] Fase 2 — KPIs y dashboards (Tienda / Logística) con ECharts
- [ ] Fase 3 — Complementarios + alertas por persona
- [ ] Fase 4 — Histórico de cortes + exportaciones + parámetros

## Notas de negocio

- La Dotación es una **foto actual**: sucursal, cargo y jefe son los vigentes hoy,
  aunque la asistencia sea de un período pasado.
- Por defecto se excluyen del cálculo los días anteriores a la entrada al puesto y
  los posteriores al cese (configurable). Sin esto, la asistencia de los campañeros
  cae a ~18 %.
