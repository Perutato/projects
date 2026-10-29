// =============================================================================
// dashboards.js
// Construye y renderiza los dashboards Tienda y Logística: barra de filtros,
// tarjetas de KPI (con tooltips y comparación con período anterior), top 5,
// los 8 gráficos, la tabla por sucursal y el detalle por persona.
// =============================================================================

import { fmtMiles, fmtPct, fmtHoras, fmtDec1 } from './config.js';
import * as charts from './charts.js';
import { exportarExcel, exportarCSV } from './exports.js';

const PALETA = { Tienda: '#1f4e78', 'Logística': '#375623' };

// Definición de las tarjetas de KPI. good: dirección "buena" (para la flecha).
const CARDS = [
  // Fila 1
  { key: 'personas', label: 'Personas', fmt: 'int', tip: 'Personas únicas (keyID) en el filtro.' },
  { key: 'fiscalizables', label: 'Fiscalizables', fmt: 'int', tip: 'Personas únicas con fiscalización = Fiscalizado.' },
  { key: 'noFiscalizables', label: 'No fiscalizables', fmt: 'int', tip: 'No fiscalizado o Sin dato.' },
  { key: 'pctAsistencia', label: '% Asistencia', fmt: 'pct', good: 'up', tip: 'Σ presente / Σ días esperados.' },
  { key: 'pctMalla', label: '% Cumplimiento malla', fmt: 'pct', good: 'up', semaforo: true, tip: '1 − (días no planificados / Σ trabajo).' },
  { key: 'diasNoPlan', label: 'Días no planificados', fmt: 'int', good: 'down', tip: 'Σ días trabajados sin turno planificado.' },
  { key: 'trabajadoresNoPlan', label: 'Trabajadores no planif.', fmt: 'int', good: 'down', tip: 'Personas únicas con al menos un día no planificado.' },
  // Fila 2
  { key: 'tardanzasDias', label: 'Tardanzas E1 (días)', fmt: 'int', good: 'down', tip: 'Σ días con atraso en la primera entrada (E1).' },
  { key: 'minTardanza', label: 'Min de tardanza', fmt: 'int', good: 'down', tip: 'Σ minutos de atraso en E1.' },
  { key: 'personasTardanza', label: 'Personas con tardanza', fmt: 'int', good: 'down', tip: 'Personas únicas con tardanza.' },
  { key: 'pctTardanza', label: '% Tardanza', fmt: 'pct', good: 'down', tip: 'Σ tardanzas / Σ presentes.' },
  { key: 'salidasAntDias', label: 'Salidas anticipadas (días)', fmt: 'int', good: 'down', tip: 'Días con adelanto en la salida final (S2) > 0.' },
  { key: 'minSalidaAnt', label: 'Min salida anticipada', fmt: 'int', good: 'down', tip: 'Σ minutos de adelanto en S2.' },
  { key: 'fugaH', label: 'Fuga (h)', fmt: 'h', good: 'down', tip: 'Σ (atraso E1 + adelanto S2) / 60.' },
  { key: 'fugaHporFisc', label: 'Fuga h / fiscalizable', fmt: 'dec', good: 'down', tip: 'Fuga (h) dividida SOLO entre fiscalizables.' },
  { key: 'diasJustificacion', label: 'Días con justificación', fmt: 'int', good: 'up', tip: 'Días con justificación registrada.' },
  { key: 'minJustificados', label: 'Min justificados', fmt: 'int', good: 'up', tip: 'Σ (min atraso justificado + min salida justificada).' },
  // Fila 3
  { key: 'marcasManuales', label: 'Marcas manuales', fmt: 'int', good: 'down', tip: 'Σ marcas con Tipo = "M".' },
  { key: 'marcacionCompleta', label: 'Marcación completa', fmt: 'int', good: 'up', tip: 'Días con marcación completa.' },
  { key: 'marcacionIncompleta', label: 'Marcación incompleta', fmt: 'int', good: 'down', tip: 'Días con marcación iniciada pero incompleta.' },
  { key: 'faltasInjust', label: 'Faltas injustificadas', fmt: 'int', good: 'down', tip: 'Días con estado = Falta injustificada.' },
  { key: 'diasSinMarcacion', label: 'Días sin marcación', fmt: 'int', good: 'down', tip: 'Días con turno pero sin ninguna marca.' },
  { key: 'trabajoEnDescanso', label: 'Trabajó en descanso', fmt: 'int', good: 'down', tip: 'Días con turno Descanso y al menos una marca.' },
  { key: 'excesoRefrigerioDias', label: 'Exceso refrigerio (días)', fmt: 'int', good: 'down', tip: 'Días con exceso de refrigerio sobre la tolerancia.' },
  { key: 'trabajoFeriado', label: 'Trabajó en feriado', fmt: 'int', tip: 'Días feriados con trabajo.' },
  { key: 'hheeEjecH', label: 'HHEE ejecutadas (h)', fmt: 'h', tip: 'Σ tiempo extra ejecutado / 60.' },
  { key: 'hheeAutH', label: 'HHEE autorizadas (h)', fmt: 'h', tip: 'Σ HEA / 60.' },
  { key: 'hheeReconH', label: 'HHEE reconocidas (h)', fmt: 'h', good: 'up', tip: 'Σ finales (reconocido/pagable) / 60.' },
  { key: 'hheeNoReconH', label: 'HHEE no reconocidas (h)', fmt: 'h', good: 'down', tip: 'Ejecutadas − reconocidas.' },
  { key: 'pctHHEERecon', label: '% HHEE reconocidas', fmt: 'pct', good: 'up', tip: 'Finales / ejecutadas.' },
];

// Columnas de la tabla por sucursal.
const COLS_SUC = [
  { key: 'sucursal', label: 'Sucursal', tipo: 'txt' },
  { key: 'personas', label: 'Personas', tipo: 'int' },
  { key: 'pctAsistencia', label: '% Asist.', tipo: 'pct' },
  { key: 'pctMalla', label: '% Malla', tipo: 'pct' },
  { key: 'diasNoPlan', label: 'No planif.', tipo: 'int' },
  { key: 'tardanzasDias', label: 'Tardanzas', tipo: 'int' },
  { key: 'pctTardanza', label: '% Tard.', tipo: 'pct' },
  { key: 'fugaH', label: 'Fuga (h)', tipo: 'h' },
  { key: 'fugaHporFisc', label: 'Fuga/fisc.', tipo: 'dec' },
  { key: 'faltasInjust', label: 'Faltas', tipo: 'int' },
  { key: 'diasSinMarcacion', label: 'Sin marc.', tipo: 'int' },
  { key: 'excesoRefrigerioDias', label: 'Exc. refr.', tipo: 'int' },
  { key: 'hheeEjecH', label: 'HHEE ej.', tipo: 'h' },
  { key: 'pctHHEERecon', label: '% HHEE rec.', tipo: 'pct' },
];

export function crearDashboards({ callWorker, getCfg }) {
  let opciones = null; // opciones de filtro (del recalc)
  const estado = {
    Tienda: filtrosPorDefecto('Tienda'),
    'Logística': filtrosPorDefecto('Logística'),
  };
  const ultTabla = {}; // última tabla por sucursal (para exportar)

  function filtrosPorDefecto(dashboard) {
    return {
      dashboard,
      granularidad: 'dia',
      fechaDesde: null,
      fechaHasta: null,
      sucursales: [],
      jefes: [],
      cargos: [],
      campanero: '',
      sindicalizado: '',
      jornada: '',
      modeloDias: '',
      fiscalizacion: '',
      calendario: '',
      comparar: false,
    };
  }

  function setOpciones(op) {
    opciones = op;
  }

  async function render(dashboard) {
    const cont = document.getElementById('vista-' + dashboard.toLowerCase().replace('í', 'i'));
    if (!cont) return;
    if (!opciones) {
      cont.innerHTML = '<div class="proxima">Carga datos para ver el dashboard.</div>';
      return;
    }
    charts.limpiarGraficos();
    cont.innerHTML = esqueleto(dashboard);
    cablearFiltros(dashboard, cont);
    await actualizar(dashboard, cont);
  }

  async function actualizar(dashboard, cont) {
    const filtros = estado[dashboard];
    const cfg = getCfg();
    const data = await callWorker('dashboard', { filtros, cfg });
    ultTabla[dashboard] = data.porSucursal;
    pintarEncabezado(dashboard, cont, filtros, data);
    pintarCards(dashboard, cont, data);
    pintarTop5(cont, data);
    pintarGraficos(dashboard, data);
    pintarTabla(dashboard, cont, data);
  }

  // ---- Esqueleto HTML ------------------------------------------------------
  function esqueleto(dashboard) {
    return `
      <header class="vista-head">
        <h1>Dashboard ${dashboard}</h1>
        <div class="acciones">
          <button class="btn btn-sec" data-accion="imprimir">Imprimir / PDF</button>
          <button class="btn btn-sec" data-accion="csv">Exportar CSV</button>
          <button class="btn" data-accion="excel">Exportar Excel</button>
        </div>
      </header>
      <div class="encabezado-periodo" data-encabezado></div>
      <div class="filtros" data-filtros></div>
      <div class="cards" data-cards></div>
      <div class="top5" data-top5></div>
      <div class="graficos">
        <div class="grafico g-ancho" id="gr01"></div>
        <div class="grafico" id="gr02"></div>
        <div class="grafico" id="gr03"></div>
        <div class="grafico" id="gr04"></div>
        <div class="grafico g-ancho" id="gr05"></div>
        <div class="grafico" id="gr06"></div>
        <div class="grafico" id="gr07"></div>
        <div class="grafico g-ancho" id="gr08"></div>
      </div>
      <h2>KPI por sucursal</h2>
      <div class="tabla-herramientas">
        <input type="search" placeholder="Buscar sucursal…" data-buscar-suc class="input-busqueda" />
        <span class="nota">Clic en una fila para ver el detalle por persona.</span>
      </div>
      <div data-tabla-suc></div>
      <div class="modal" data-modal hidden></div>`;
  }

  // ---- Encabezado de período ----------------------------------------------
  function pintarEncabezado(dashboard, cont, filtros, data) {
    const el = cont.querySelector('[data-encabezado]');
    const rango = filtros.fechaDesde
      ? `${fmtFecha(filtros.fechaDesde)} – ${fmtFecha(filtros.fechaHasta)}`
      : `${fmtFecha(opciones.fechaMin)} – ${fmtFecha(opciones.fechaMax)} (todo)`;
    el.innerHTML = `
      <div class="eh-izq" style="border-color:${PALETA[dashboard]}">
        <div><span class="eh-lbl">Período</span><b>${rango}</b></div>
        <div><span class="eh-lbl">Fecha de corte</span><b>${new Date().toLocaleDateString('es-PE')}</b></div>
        <div><span class="eh-lbl">Días persona-día</span><b>${fmtMiles(data.nFilas)}</b></div>
      </div>
      <div class="eh-aviso">⚠️ La Dotación es una foto <em>actual</em>: sucursal, cargo y jefe son los vigentes hoy, aunque la asistencia sea de un período pasado.</div>`;
  }

  // ---- Barra de filtros ----------------------------------------------------
  function cablearFiltros(dashboard, cont) {
    const f = estado[dashboard];
    const cajaFiltros = cont.querySelector('[data-filtros]');
    cajaFiltros.innerHTML = plantillaFiltros(f);

    // Granularidad
    cajaFiltros.querySelectorAll('[data-gran]').forEach((b) =>
      b.addEventListener('click', () => {
        f.granularidad = b.dataset.gran;
        cajaFiltros.querySelectorAll('[data-gran]').forEach((x) => x.classList.toggle('activo', x === b));
        actualizar(dashboard, cont);
      })
    );
    // Preselecciones de rango
    cajaFiltros.querySelectorAll('[data-rango]').forEach((b) =>
      b.addEventListener('click', () => {
        aplicarPreseleccion(f, b.dataset.rango);
        cablearFiltros(dashboard, cont); // redibuja inputs de fecha
        actualizar(dashboard, cont);
      })
    );
    // Fechas manuales
    const dDesde = cajaFiltros.querySelector('[data-desde]');
    const dHasta = cajaFiltros.querySelector('[data-hasta]');
    const onFecha = () => {
      f.fechaDesde = dDesde.value ? dDesde.value.replace(/-/g, '') : null;
      f.fechaHasta = dHasta.value ? dHasta.value.replace(/-/g, '') : null;
      actualizar(dashboard, cont);
    };
    dDesde.addEventListener('change', onFecha);
    dHasta.addEventListener('change', onFecha);

    // Selects simples
    const bindSel = (sel, campo) => {
      const el = cajaFiltros.querySelector(sel);
      el.addEventListener('change', () => {
        f[campo] = el.value;
        actualizar(dashboard, cont);
      });
    };
    bindSel('[data-jefe]', 'jefes'); // manejado abajo como array
    bindSel('[data-cargo]', 'cargos');
    bindSel('[data-campanero]', 'campanero');
    bindSel('[data-sindicalizado]', 'sindicalizado');
    bindSel('[data-jornada]', 'jornada');
    bindSel('[data-modelo]', 'modeloDias');
    bindSel('[data-fiscalizacion]', 'fiscalizacion');
    bindSel('[data-calendario]', 'calendario');

    // Jefe y Cargo como arrays (un valor => array de uno o vacío)
    const jefeSel = cajaFiltros.querySelector('[data-jefe]');
    jefeSel.addEventListener('change', () => { f.jefes = jefeSel.value ? [jefeSel.value] : []; actualizar(dashboard, cont); });
    const cargoSel = cajaFiltros.querySelector('[data-cargo]');
    cargoSel.addEventListener('change', () => { f.cargos = cargoSel.value ? [cargoSel.value] : []; actualizar(dashboard, cont); });

    // Comparar
    const chk = cajaFiltros.querySelector('[data-comparar]');
    chk.addEventListener('change', () => { f.comparar = chk.checked; actualizar(dashboard, cont); });

    // Multiselect de sucursal
    cablearMultiSucursal(dashboard, cajaFiltros, cont);

    // Acciones (exportar / imprimir)
    cont.querySelector('[data-accion="imprimir"]').addEventListener('click', () => window.print());
    cont.querySelector('[data-accion="excel"]').addEventListener('click', () => exportarTabla(dashboard, 'excel'));
    cont.querySelector('[data-accion="csv"]').addEventListener('click', () => exportarTabla(dashboard, 'csv'));
  }

  function plantillaFiltros(f) {
    const sucFiltrables = opciones.sucursales;
    const opt = (arr, sel) => ['<option value="">(Todos)</option>']
      .concat(arr.map((v) => `<option value="${esc(v)}" ${sel === v ? 'selected' : ''}>${esc(v)}</option>`)).join('');
    const seg = (g, lbl) => `<button data-gran="${g}" class="${f.granularidad === g ? 'activo' : ''}">${lbl}</button>`;
    return `
      <div class="fila-filtros">
        <div class="fgrupo">
          <label>Granularidad</label>
          <div class="segment">${seg('dia', 'Día')}${seg('semana', 'Semana')}${seg('mes', 'Mes')}</div>
        </div>
        <div class="fgrupo">
          <label>Rango</label>
          <div class="segment">
            <button data-rango="dia">Último día</button>
            <button data-rango="semana">Última semana</button>
            <button data-rango="mes">Último mes</button>
            <button data-rango="todo">Todo</button>
          </div>
        </div>
        <div class="fgrupo"><label>Desde</label><input type="date" data-desde value="${isoDate(f.fechaDesde)}" /></div>
        <div class="fgrupo"><label>Hasta</label><input type="date" data-hasta value="${isoDate(f.fechaHasta)}" /></div>
        <div class="fgrupo fgrupo-suc"><label>Sucursal</label><div data-multisuc></div></div>
      </div>
      <div class="fila-filtros">
        <div class="fgrupo"><label>Jefe directo</label><select data-jefe>${opt(opciones.jefes, f.jefes[0] || '')}</select></div>
        <div class="fgrupo"><label>Cargo</label><select data-cargo>${opt(opciones.cargos, f.cargos[0] || '')}</select></div>
        <div class="fgrupo"><label>Campañero</label><select data-campanero>${optSiNo(f.campanero)}</select></div>
        <div class="fgrupo"><label>Sindicalizado</label><select data-sindicalizado>${optSiNo(f.sindicalizado)}</select></div>
        <div class="fgrupo"><label>Jornada</label><select data-jornada>${opt(opciones.jornadas, f.jornada)}</select></div>
        <div class="fgrupo"><label>Modelo de días</label><select data-modelo>${opt(opciones.modelosDias, f.modeloDias)}</select></div>
        <div class="fgrupo"><label>Fiscalización</label><select data-fiscalizacion>${opt(opciones.fiscalizaciones, f.fiscalizacion)}</select></div>
        <div class="fgrupo"><label>Calendario</label><select data-calendario>${opt(opciones.calendarios, f.calendario)}</select></div>
        <div class="fgrupo fgrupo-chk"><label class="chk"><input type="checkbox" data-comparar ${f.comparar ? 'checked' : ''}/> Comparar con período anterior</label></div>
      </div>`;
  }

  function cablearMultiSucursal(dashboard, cajaFiltros, cont) {
    const f = estado[dashboard];
    const host = cajaFiltros.querySelector('[data-multisuc]');
    const n = f.sucursales.length;
    host.innerHTML = `
      <div class="multi">
        <button type="button" class="multi-btn" data-multi-btn>${n ? n + ' seleccionadas' : 'Todas'}</button>
        <div class="multi-panel" data-multi-panel hidden>
          <input type="search" placeholder="Buscar…" data-multi-buscar class="input-busqueda" />
          <div class="multi-acc"><button type="button" data-multi-todos>Todas</button><button type="button" data-multi-ninguno>Ninguna</button></div>
          <div class="multi-lista" data-multi-lista></div>
        </div>
      </div>`;
    const btn = host.querySelector('[data-multi-btn]');
    const panel = host.querySelector('[data-multi-panel]');
    const lista = host.querySelector('[data-multi-lista]');
    const buscar = host.querySelector('[data-multi-buscar]');

    const pintarLista = (filtro = '') => {
      const sel = new Set(f.sucursales);
      const items = opciones.sucursales.filter((s) => s.toLowerCase().includes(filtro.toLowerCase()));
      lista.innerHTML = items
        .map((s) => `<label class="multi-item"><input type="checkbox" value="${esc(s)}" ${sel.has(s) ? 'checked' : ''}/> ${esc(s)}</label>`)
        .join('') || '<p class="vacio">Sin coincidencias.</p>';
      lista.querySelectorAll('input').forEach((chk) =>
        chk.addEventListener('change', () => {
          if (chk.checked) f.sucursales.push(chk.value);
          else f.sucursales = f.sucursales.filter((x) => x !== chk.value);
          btn.textContent = f.sucursales.length ? f.sucursales.length + ' seleccionadas' : 'Todas';
        })
      );
    };
    btn.addEventListener('click', () => {
      const abierto = !panel.hidden;
      panel.hidden = abierto;
      if (!abierto) pintarLista(buscar.value);
    });
    buscar.addEventListener('input', () => pintarLista(buscar.value));
    host.querySelector('[data-multi-todos]').addEventListener('click', () => { f.sucursales = []; pintarLista(buscar.value); btn.textContent = 'Todas'; });
    host.querySelector('[data-multi-ninguno]').addEventListener('click', () => { f.sucursales = [...opciones.sucursales]; pintarLista(buscar.value); btn.textContent = f.sucursales.length + ' seleccionadas'; });
    // Al cerrar el panel (clic fuera), recomputar.
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !host.contains(e.target)) {
        panel.hidden = true;
        actualizar(dashboard, cont);
      }
    });
  }

  function aplicarPreseleccion(f, tipo) {
    const max = opciones.fechaMax;
    const min = opciones.fechaMin;
    if (!max) return;
    if (tipo === 'todo') { f.fechaDesde = null; f.fechaHasta = null; return; }
    const d = new Date(+max.slice(0, 4), +max.slice(4, 6) - 1, +max.slice(6, 8));
    let desde = new Date(d);
    if (tipo === 'dia') desde = d;
    else if (tipo === 'semana') desde = new Date(d.getTime() - 6 * 86400000);
    else if (tipo === 'mes') desde = new Date(d.getTime() - 29 * 86400000);
    const y = (x) => `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}`;
    f.fechaDesde = y(desde) < min ? min : y(desde);
    f.fechaHasta = max;
  }

  // ---- Tarjetas de KPI -----------------------------------------------------
  function pintarCards(dashboard, cont, data) {
    const el = cont.querySelector('[data-cards]');
    const color = PALETA[dashboard];
    el.innerHTML = CARDS.map((c) => tarjeta(c, data, color)).join('');
    // tooltips accesibles vía atributo title ya incluido
  }

  function tarjeta(c, data, color) {
    const val = data.kpis[c.key];
    const texto = formato(val, c.fmt);
    let extra = '';
    if (c.semaforo) {
      const sem = data.kpis.semaforoMalla;
      const clase = sem === 'Cumple' ? 'sem-ok' : sem === 'En riesgo' ? 'sem-amber' : 'sem-rojo';
      extra = `<span class="sem ${clase}">${sem}</span>`;
    }
    let delta = '';
    if (data.kpisPrev) {
      delta = variacion(c, val, data.kpisPrev[c.key]);
    }
    return `
      <div class="card" title="${esc(c.tip)}">
        <div class="card-top"><span class="card-lbl">${c.label}</span>${extra}</div>
        <div class="card-val" style="color:${color}">${texto}</div>
        ${delta}
      </div>`;
  }

  function variacion(c, cur, prev) {
    if (prev === undefined || prev === null) return '';
    const esPct = c.fmt === 'pct';
    const diff = cur - prev;
    if (Math.abs(diff) < 1e-9) return '<div class="card-delta neutro">— sin cambio</div>';
    let txt;
    if (esPct) txt = (diff > 0 ? '+' : '') + fmtDec1(diff) + ' pp';
    else {
      const pct = prev !== 0 ? (diff / Math.abs(prev)) * 100 : 100;
      txt = (diff > 0 ? '+' : '') + fmtDec1(pct) + '%';
    }
    // Color según dirección buena
    let bueno = null;
    if (c.good === 'up') bueno = diff > 0;
    else if (c.good === 'down') bueno = diff < 0;
    const clase = bueno === null ? 'neutro' : bueno ? 'suben-bien' : 'suben-mal';
    const flecha = diff > 0 ? '▲' : '▼';
    return `<div class="card-delta ${clase}">${flecha} ${txt}</div>`;
  }

  // ---- Top 5 ---------------------------------------------------------------
  function pintarTop5(cont, data) {
    const el = cont.querySelector('[data-top5]');
    const bloque = (titulo, arr, campo, fmt) => `
      <div class="top5-card">
        <h4>${titulo}</h4>
        <ol>${arr.map((s) => `<li><span>${esc(s.sucursal)}</span><b>${formato(s[campo], fmt)}</b></li>`).join('') || '<li class="vacio">Sin datos</li>'}</ol>
      </div>`;
    el.innerHTML =
      bloque('Peor % de asistencia', data.top5.peorAsistencia, 'pctAsistencia', 'pct') +
      bloque('Más tardanzas', data.top5.tardanzas, 'tardanzasDias', 'int') +
      bloque('Más días no planificados', data.top5.noPlan, 'diasNoPlan', 'int');
  }

  // ---- Gráficos ------------------------------------------------------------
  function pintarGraficos(dashboard, data) {
    const color = PALETA[dashboard];
    const g = data.graficos;
    charts.barrasHorizontales('gr01', 'GR-01 · % Asistencia por sucursal (top 15 por personas)', g.gr01, color, '%');
    charts.barrasHorizontales('gr02', 'GR-02 · Tardanzas E1 por sucursal', g.gr02, color, '', 0);
    charts.dobleSerie('gr03', 'GR-03 · Días no planificados y trabajadores afectados', g.gr03, color);
    charts.barrasHorizontales('gr04', 'GR-04 · Fuga (h) por fiscalizable', g.gr04, color, ' h', 2);
    charts.tendencia('gr05', 'GR-05 · Tendencia', g.gr05, color);
    charts.anillo('gr06', 'GR-06 · Calidad de marcación', g.gr06);
    charts.hheeComparado('gr07', 'GR-07 · HHEE ejecutadas vs reconocidas', g.gr07, color);
    charts.mallaPorSucursal('gr08', 'GR-08 · % Cumplimiento de malla por sucursal', g.gr08, color, 95);
    setTimeout(() => charts.resizeTodos(), 30);
  }

  // ---- Tabla por sucursal --------------------------------------------------
  let ordenTabla = { campo: 'personas', dir: -1 };
  function pintarTabla(dashboard, cont, data) {
    const host = cont.querySelector('[data-tabla-suc]');
    const buscar = (cont.querySelector('[data-buscar-suc]').value || '').toLowerCase();
    let filas = data.porSucursal.filter((s) => s.sucursal.toLowerCase().includes(buscar));
    const { campo, dir } = ordenTabla;
    filas = [...filas].sort((a, b) => {
      const va = a[campo], vb = b[campo];
      if (typeof va === 'string') return va.localeCompare(vb) * dir;
      return (va - vb) * dir;
    });
    const th = COLS_SUC.map(
      (c) => `<th data-ord="${c.key}" class="${c.tipo !== 'txt' ? 'num' : ''} ${campo === c.key ? 'ordenado' : ''}">${c.label}${campo === c.key ? (dir === -1 ? ' ▼' : ' ▲') : ''}</th>`
    ).join('');
    const tr = filas
      .map(
        (s) => `<tr data-suc="${esc(s.sucursal)}">${COLS_SUC.map((c) => `<td class="${c.tipo !== 'txt' ? 'num' : ''}">${c.tipo === 'txt' ? esc(s[c.key]) : formato(s[c.key], c.tipo)}</td>`).join('')}</tr>`
      )
      .join('');
    host.innerHTML = `<table class="tabla tabla-suc"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
    host.querySelectorAll('th[data-ord]').forEach((h) =>
      h.addEventListener('click', () => {
        const k = h.dataset.ord;
        ordenTabla = { campo: k, dir: ordenTabla.campo === k ? -ordenTabla.dir : (k === 'sucursal' ? 1 : -1) };
        pintarTabla(dashboard, cont, data);
      })
    );
    host.querySelectorAll('tr[data-suc]').forEach((row) =>
      row.addEventListener('click', () => abrirDetalle(dashboard, cont, row.dataset.suc))
    );
    // buscador
    const inputBuscar = cont.querySelector('[data-buscar-suc]');
    if (!inputBuscar._cableado) {
      inputBuscar._cableado = true;
      inputBuscar.addEventListener('input', () => pintarTabla(dashboard, cont, data));
    }
  }

  // ---- Detalle por persona (modal) ----------------------------------------
  async function abrirDetalle(dashboard, cont, sucursal) {
    const modal = cont.querySelector('[data-modal]');
    modal.hidden = false;
    modal.innerHTML = `<div class="modal-caja"><p>Cargando detalle de ${esc(sucursal)}…</p></div>`;
    const cfg = getCfg();
    const data = await callWorker('detalleSucursal', { sucursal, filtros: estado[dashboard], cfg });
    const filas = data.personas;
    const tr = filas
      .map(
        (p) => `<tr>
          <td>${esc(p.keyId)}</td><td>${esc(p.nombre)}</td><td>${esc(p.cargo)}</td><td>${esc(p.jefe)}</td>
          <td class="num">${fmtMiles(p.dias)}</td><td class="num">${fmtMiles(p.presentes)}</td>
          <td class="num">${fmtMiles(p.tardanzas)}</td><td class="num">${fmtMiles(p.faltas)}</td>
          <td class="num">${fmtMiles(p.sinMarcacion)}</td><td class="num">${fmtMiles(p.minAtraso)}</td></tr>`
      )
      .join('');
    modal.innerHTML = `
      <div class="modal-caja grande">
        <div class="modal-head">
          <h3>Detalle por persona · ${esc(sucursal)} <span class="nota">(${fmtMiles(filas.length)} personas)</span></h3>
          <div>
            <button class="btn btn-sec" data-cerrar>Cerrar</button>
          </div>
        </div>
        <div class="modal-body">
          <table class="tabla">
            <thead><tr><th>KeyID</th><th>Nombre</th><th>Cargo</th><th>Jefe</th><th class="num">Días</th><th class="num">Presentes</th><th class="num">Tardanzas</th><th class="num">Faltas</th><th class="num">Sin marc.</th><th class="num">Min atraso</th></tr></thead>
            <tbody>${tr}</tbody>
          </table>
        </div>
      </div>`;
    modal.querySelector('[data-cerrar]').addEventListener('click', () => { modal.hidden = true; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  }

  // ---- Exportación de la tabla por sucursal --------------------------------
  function exportarTabla(dashboard, formatoExp) {
    const filas = ultTabla[dashboard] || [];
    const columnas = COLS_SUC.map((c) => c.key);
    const titulos = COLS_SUC.map((c) => c.label);
    // Normaliza números (redondeo) para exportar limpio.
    const data = filas.map((s) => {
      const o = {};
      for (const c of COLS_SUC) {
        const v = s[c.key];
        o[c.key] = c.tipo === 'txt' ? v : typeof v === 'number' ? +v.toFixed(c.tipo === 'pct' || c.tipo === 'dec' ? 1 : c.tipo === 'h' ? 1 : 0) : v;
      }
      return o;
    });
    const nombre = `KPI_${dashboard}_${new Date().toISOString().slice(0, 10)}`;
    if (formatoExp === 'excel') exportarExcel(nombre, columnas, data, titulos);
    else exportarCSV(nombre, columnas, data, titulos);
  }

  return { setOpciones, render };
}

// --- Utilidades --------------------------------------------------------------
function formato(v, fmt) {
  if (fmt === 'pct') return fmtPct(v);
  if (fmt === 'h') return fmtHoras(v);
  if (fmt === 'dec') return fmtDec1(v);
  return fmtMiles(v);
}
function optSiNo(sel) {
  return ['', 'Sí', 'No'].map((v) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${v === '' ? '(Todos)' : v}</option>`).join('');
}
function isoDate(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return '';
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}
function fmtFecha(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return '—';
  return `${yyyymmdd.slice(6, 8)}/${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(0, 4)}`;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
