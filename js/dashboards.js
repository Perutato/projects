// =============================================================================
// dashboards.js
// Construye y renderiza los dashboards Tienda y Logística: barra de filtros,
// tarjetas de KPI (con tooltips y comparación con período anterior), top 5,
// los 8 gráficos, la tabla por sucursal y el detalle por persona.
// =============================================================================

import { fmtMiles, fmtPct, fmtHoras, fmtDec1 } from './config.js';
import * as charts from './charts.js';
import { exportarExcel, exportarCSV } from './exports.js';
import { icon } from './icons.js';

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

// Agrupación de los KPIs en secciones, para una lectura más rápida.
const GRUPOS_KPI = [
  { titulo: 'Personal', keys: ['personas', 'fiscalizables', 'noFiscalizables'] },
  { titulo: 'Asistencia y malla', keys: ['pctAsistencia', 'pctMalla', 'diasNoPlan', 'trabajadoresNoPlan'] },
  { titulo: 'Puntualidad y fuga', keys: ['tardanzasDias', 'minTardanza', 'personasTardanza', 'pctTardanza', 'salidasAntDias', 'minSalidaAnt', 'fugaH', 'fugaHporFisc', 'diasJustificacion', 'minJustificados'] },
  { titulo: 'Marcación', keys: ['marcasManuales', 'marcacionCompleta', 'marcacionIncompleta', 'faltasInjust', 'diasSinMarcacion', 'trabajoEnDescanso', 'excesoRefrigerioDias', 'trabajoFeriado'] },
  { titulo: 'Horas extra (HHEE)', keys: ['hheeEjecH', 'hheeAutH', 'hheeReconH', 'hheeNoReconH', 'pctHHEERecon'] },
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
  const ultData = {}; // último dashboard completo (para exportar gráficos)

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
    ultData[dashboard] = data;
    pintarEncabezado(dashboard, cont, filtros, data);
    pintarHero(dashboard, cont, data);
    pintarDiagnostico(dashboard, cont, data);
    pintarCards(dashboard, cont, data);
    pintarGraficos(dashboard, cont, data);
    pintarTabla(dashboard, cont, data);
  }

  // ---- Esqueleto HTML ------------------------------------------------------
  // Id de gráfico con prefijo por dashboard (evita IDs duplicados entre vistas).
  function cid(dashboard, base) {
    return (dashboard === 'Tienda' ? 't_' : 'l_') + base;
  }

  // Tarjeta de gráfico con cabecera numerada y botón de exportación.
  function chartCard(dashboard, num, titulo, subtitulo, baseId, ancho) {
    return `
      <section class="chart-card ${ancho ? 'g-ancho' : ''}">
        <div class="chart-card-head">
          <div class="cch-left"><span class="sec-num">${num}</span>
            <div><h3>${titulo}</h3><p class="chart-sub">${subtitulo}</p></div>
          </div>
          <button class="btn-exp" data-export="${baseId}">${icon('download')}<span>Exportar</span></button>
        </div>
        <div class="grafico-body" id="${cid(dashboard, baseId)}"></div>
      </section>`;
  }

  function esqueleto(dashboard) {
    const cc = (num, titulo, sub, baseId, ancho) => chartCard(dashboard, num, titulo, sub, baseId, ancho);
    return `
      <div class="exec-banner" data-banner></div>
      <div class="filtros" data-filtros></div>
      <div class="alerta-dotacion" data-alerta></div>
      <div class="hero-kpis" data-hero></div>
      <div class="diag-wrap" data-diag></div>

      <section class="bloque">
        <h2 class="bloque-titulo"><span class="sec-num">A</span> Asistencia y marcación</h2>
        <div class="graficos">
          ${cc('GR-01', '% Asistencia por sucursal', 'Top 15 por dotación', 'gr01', true)}
          ${cc('GR-T', 'Tendencia del período', 'Tardanzas, fuga, días no planificados y HHEE', 'grTend', true)}
          ${cc('GR-06', 'Calidad de marcación', 'Distribución de días por tipo de marca', 'gr06', false)}
        </div>
      </section>

      <section class="bloque">
        <h2 class="bloque-titulo"><span class="sec-num">B</span> Planificación y disciplina</h2>
        <div class="graficos">
          ${cc('02', 'Días no planificados por tienda', 'Días laborados sin turno en la malla', 'gr02', false)}
          ${cc('03', 'Justificaciones por tienda', 'Días con justificación registrada', 'gr03', false)}
          ${cc('04', 'Horas justificadas por tienda', 'Atrasos de ingreso vs. adelantos de salida', 'gr04', false)}
          ${cc('05', 'Fuga de tiempo: tardanzas y salidas', 'Horas perdidas por ingresos tarde y salidas antes', 'gr05', false)}
        </div>
      </section>

      <section class="bloque">
        <h2 class="bloque-titulo"><span class="sec-num">C</span> Horas extra (HHEE)</h2>
        <div class="graficos">
          ${cc('06', 'Ejecutadas vs. Aprobadas vs. Cumplidas', 'Volumen de horas por encima de la jornada', 'gr07', true)}
          ${cc('07', 'Brecha: Aprobadas menos Ejecutadas', 'Sobre-ejecución (rojo) y sub-ejecución (azul)', 'gr08', false)}
          ${cc('08', '% Cumplimiento de malla por sucursal', 'Meta 95%', 'gr09', false)}
        </div>
      </section>

      <section class="bloque">
        <h2 class="bloque-titulo"><span class="sec-num">D</span> Indicadores detallados</h2>
        <div class="cards-wrap" data-cards></div>
      </section>

      <section class="bloque">
        <div class="recon-head">
          <h2 class="bloque-titulo"><span class="sec-num">E</span> Reconciliación · Resultado por sucursal</h2>
          <div class="acciones">
            <button class="btn btn-sec" data-accion="imprimir">${icon('printer')}<span>Imprimir / PDF</span></button>
            <button class="btn btn-sec" data-accion="csv">${icon('download')}<span>CSV</span></button>
            <button class="btn" data-accion="excel">${icon('download')}<span>Excel</span></button>
          </div>
        </div>
        <div class="tabla-herramientas">
          <span class="busqueda-wrap">${icon('search')}<input type="search" placeholder="Buscar sucursal…" data-buscar-suc class="input-busqueda" /></span>
          <span class="nota">Clic en una fila para ver el detalle por persona.</span>
        </div>
        <div data-tabla-suc></div>
      </section>
      <div class="modal" data-modal hidden></div>`;
  }

  // ---- Encabezado de período ----------------------------------------------
  function pintarEncabezado(dashboard, cont, filtros, data) {
    const el = cont.querySelector('[data-banner]');
    const rango = filtros.fechaDesde
      ? `${fmtFecha(filtros.fechaDesde)} – ${fmtFecha(filtros.fechaHasta)}`
      : 'Consolidado';
    const ambito = dashboard === 'Tienda' ? 'RETAIL TIENDAS' : 'CENTROS DE DISTRIBUCIÓN';
    el.className = 'exec-banner ' + (dashboard === 'Tienda' ? 'banner-tienda' : 'banner-log');
    el.innerHTML = `
      <div class="eb-top"><span class="eb-dot"></span><span class="eb-eyebrow">GESTIÓN OPERATIVA · ${ambito}</span></div>
      <div class="eb-main">
        <div>
          <h1 class="eb-title">Asistencia y Horas Extra · ${dashboard}</h1>
          <p class="eb-sub">Consolidado operativo de control de malla, ausentismos, fuga de tiempo y cumplimiento de horas extra.</p>
          <span class="eb-badge">Período: <b>${rango}</b></span>
          <span class="eb-badge eb-badge-ghost">${fmtMiles(data.nFilas)} días persona-día · corte ${new Date().toLocaleDateString('es-PE')}</span>
        </div>
      </div>
      <p class="eb-nota">${icon('warning')}<span>La Dotación es una foto <em>actual</em>: sucursal, cargo y jefe son los vigentes hoy, aunque la asistencia sea de un período pasado.</span></p>`;
  }

  // ---- Alerta de dotación reducida ----------------------------------------
  function pintarAlerta(cont, data) {
    const el = cont.querySelector('[data-alerta]');
    const reducidas = data.porSucursal.filter((s) => s.personas < 10).length;
    if (!reducidas) { el.innerHTML = ''; return; }
    el.innerHTML = `${icon('warning')}<span><b>${reducidas}</b> sucursal(es) con dotación reducida (&lt; 10 colaboradores): sus porcentajes pueden no ser representativos.</span>`;
  }

  // ---- Hero KPIs (fila ejecutiva) -----------------------------------------
  function pintarHero(dashboard, cont, data) {
    pintarAlerta(cont, data);
    const k = data.kpis;
    const promFuga = k.fiscalizables ? k.fugaH / k.fiscalizables : 0;
    const hero = [
      { acc: 'ok', ico: 'calidad', lbl: 'Fiscalizables', val: fmtMiles(k.fiscalizables), sub: `No fisc: ${fmtMiles(k.noFiscalizables)} · Total: ${fmtMiles(k.personas)}`, tip: 'Personas únicas con fiscalización = Fiscalizado.' },
      { acc: 'amber', ico: 'complementarios', lbl: 'No planificados', val: fmtMiles(k.diasNoPlan) + ' d', sub: `${fmtMiles(k.trabajadoresNoPlan)} colaboradores`, tip: 'Días trabajados sin turno planificado.' },
      { acc: 'rojo', ico: 'historico', lbl: 'Fuga de tiempo', val: fmtHoras(k.fugaH) + ' h', sub: `Promedio: ${fmtDec1(promFuga)} h/fisc.`, tip: 'Σ (atraso E1 + adelanto S2). Horas perdidas por tardanzas y salidas anticipadas.' },
      { acc: 'teal', ico: 'parametros', lbl: 'HHEE ejecutadas', val: fmtHoras(k.hheeEjecH) + ' h', sub: `Aprobadas: ${fmtHoras(k.hheeAutH)} h`, tip: 'Σ tiempo extra ejecutado.' },
      { acc: 'blue', ico: 'alertas', lbl: 'Desviación HHEE', val: fmtHoras(k.desviacionHHEEH) + ' h', sub: `Desajuste: ${fmtPct(k.pctDesviacionHHEE)}`, tip: 'Aprobadas − Ejecutadas. Negativo = sobre-ejecución.' },
    ];
    cont.querySelector('[data-hero]').innerHTML = hero.map((h) => `
      <div class="hero-card acc-${h.acc}" title="${esc(h.tip)}">
        <div class="hero-top"><span class="hero-ico">${icon(h.ico)}</span><span class="hero-help" title="${esc(h.tip)}">?</span></div>
        <div class="hero-lbl">${h.lbl}</div>
        <div class="hero-val">${h.val}</div>
        <div class="hero-sub">${h.sub}</div>
      </div>`).join('');
  }

  // ---- Diagnóstico ejecutivo (prioridades) --------------------------------
  function pintarDiagnostico(dashboard, cont, data) {
    const d = data.diagnostico || {};
    const el = cont.querySelector('[data-diag]');
    const titular = [];
    if (d.fuga) titular.push(`Revisar primero <b>${esc(d.fuga.sucursal)}</b>: concentra ${fmtHoras(d.fuga.horas)} h de fuga`);
    if (d.hhee) titular.push(`en HHEE, <b>${esc(d.hhee.sucursal)}</b> presenta la mayor desviación (${fmtHoras(d.hhee.desviacion)} h)`);
    const cards = [
      d.planificacion && { n: '01', tag: 'Planificación', suc: d.planificacion.sucursal, val: `${fmtMiles(d.planificacion.dias)} días`, desc: `${fmtMiles(d.planificacion.trabajadores)} colaborador(es) con al menos un día no planificado`, accion: 'Validar la malla y asignar turno a los colaboradores identificados.' },
      d.fuga && { n: '02', tag: 'Fuga de tiempo', suc: d.fuga.sucursal, val: `${fmtHoras(d.fuga.horas)} h`, desc: `${fmtMiles(d.fuga.trabajadores)} colaborador(es) con tardanzas o salidas anticipadas`, accion: 'Revisar las marcaciones de salida y el cierre de turnos en tienda.' },
      d.hhee && { n: '03', tag: 'Horas extra', suc: d.hhee.sucursal, val: `${fmtHoras(d.hhee.desviacion)} h`, desc: 'Brecha entre horas aprobadas y ejecutadas', accion: 'Revisar y regularizar el sobretiempo no programado que supera lo aprobado.' },
    ].filter(Boolean);
    if (!cards.length) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div class="diag-head"><span class="sec-num">G1</span><div><h2>Prioridades del período</h2><p class="chart-sub">Las revisiones prioritarias detectadas automáticamente según la magnitud del desvío.</p></div></div>
      ${titular.length ? `<div class="diag-titular">${titular.join('. ')}.</div>` : ''}
      <div class="diag-cards">${cards.map((c) => `
        <div class="diag-card">
          <div class="diag-card-top"><span class="diag-num">${c.n}</span><span class="diag-tag">${c.tag}</span></div>
          <div class="diag-suc">${esc(c.suc)}</div>
          <div class="diag-val">${c.val}</div>
          <div class="diag-desc">${esc(c.desc)}</div>
          <div class="diag-accion"><span>Acción recomendada</span> ${esc(c.accion)}</div>
        </div>`).join('')}</div>`;
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
    const porKey = Object.fromEntries(CARDS.map((c) => [c.key, c]));
    el.innerHTML = GRUPOS_KPI.map((g) => `
      <section class="cards-grupo">
        <h3 class="cards-grupo-titulo">${g.titulo}</h3>
        <div class="cards">${g.keys.map((k) => tarjeta(porKey[k], data, color)).join('')}</div>
      </section>`).join('');
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
    const flecha = icon(diff > 0 ? 'up' : 'down', 'ico-xs');
    return `<div class="card-delta ${clase}">${flecha}<span>${txt}</span></div>`;
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
  function pintarGraficos(dashboard, cont, data) {
    const color = PALETA[dashboard];
    const g = data.graficos;
    // Los títulos van en la cabecera de cada tarjeta; se pasa '' a ECharts.
    charts.barrasHorizontales(cid(dashboard, 'gr01'), '', g.gr01, color, '%');
    charts.tendencia(cid(dashboard, 'grTend'), '', g.tendencia, color);
    charts.anillo(cid(dashboard, 'gr06'), '', g.gr06);
    charts.barrasConBadge(cid(dashboard, 'gr02'), '', g.gr02, color, ' d', 'pers.');
    charts.barrasHorizontales(cid(dashboard, 'gr03'), '', g.gr03, color, '', 0);
    charts.barrasApiladas(cid(dashboard, 'gr04'), '', g.gr04, 'Atrasos de ingreso', 'Adelantos de salida', '#c0392b', '#2f9e5e', ' h');
    charts.barrasApiladas(cid(dashboard, 'gr05'), '', g.gr05, 'Tardanzas', 'Salidas anticipadas', '#1f4e78', '#5aa0dc', ' h');
    charts.barrasAgrupadas3(cid(dashboard, 'gr07'), '', g.gr07, ['#1e8e4e', '#5aa0dc', '#b7791f']);
    charts.barrasDivergentes(cid(dashboard, 'gr08'), '', g.gr08, ' h');
    charts.mallaPorSucursal(cid(dashboard, 'gr09'), '', g.gr09, color, 95);
    // Botones de exportación por gráfico.
    cont.querySelectorAll('[data-export]').forEach((b) =>
      b.addEventListener('click', () => exportarGrafico(dashboard, b.dataset.export))
    );
    setTimeout(() => charts.resizeTodos(), 30);
  }

  // Exporta a CSV los datos de un gráfico concreto.
  function exportarGrafico(dashboard, chartId) {
    const g = (ultData[dashboard] || {}).graficos;
    if (!g) return;
    const MAP = {
      gr01: { arr: g.gr01, cols: ['sucursal', 'valor'], tit: ['Sucursal', '% Asistencia'] },
      gr02: { arr: g.gr02, cols: ['sucursal', 'valor', 'badge'], tit: ['Sucursal', 'Días no planificados', 'Trabajadores'] },
      gr03: { arr: g.gr03, cols: ['sucursal', 'valor'], tit: ['Sucursal', 'Días con justificación'] },
      gr04: { arr: g.gr04, cols: ['sucursal', 'a', 'b'], tit: ['Sucursal', 'Atrasos justificados (h)', 'Salidas justificadas (h)'] },
      gr05: { arr: g.gr05, cols: ['sucursal', 'a', 'b'], tit: ['Sucursal', 'Tardanzas (h)', 'Salidas anticipadas (h)'] },
      gr07: { arr: g.gr07, cols: ['sucursal', 'ejecutadas', 'aprobadas', 'cumplidas'], tit: ['Sucursal', 'Ejecutadas (h)', 'Aprobadas (h)', 'Cumplidas (h)'] },
      gr08: { arr: g.gr08, cols: ['sucursal', 'valor'], tit: ['Sucursal', 'Desviación HHEE (h)'] },
      gr09: { arr: g.gr09, cols: ['sucursal', 'valor'], tit: ['Sucursal', '% Malla'] },
      grTend: { arr: g.tendencia, cols: ['periodo', 'tardanzas', 'fugaH', 'diasNoPlan', 'hheeH', 'pctAsistencia'], tit: ['Período', 'Tardanzas', 'Fuga (h)', 'Días no planif.', 'HHEE (h)', '% Asistencia'] },
    };
    const m = MAP[chartId];
    if (!m || !m.arr) return;
    exportarCSV(`${chartId}_${dashboard}_${new Date().toISOString().slice(0, 10)}`, m.cols, m.arr, m.tit);
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
      (c) => `<th data-ord="${c.key}" class="${c.tipo !== 'txt' ? 'num' : ''} ${campo === c.key ? 'ordenado' : ''}">${c.label}${campo === c.key ? icon(dir === -1 ? 'down' : 'up', 'ico-xs') : ''}</th>`
    ).join('');
    const tr = filas
      .map(
        (s) => `<tr data-suc="${esc(s.sucursal)}">${COLS_SUC.map((c) => {
          const clase = [c.tipo !== 'txt' ? 'num' : '', celColor(c.key, s[c.key])].filter(Boolean).join(' ');
          return `<td class="${clase}">${c.tipo === 'txt' ? esc(s[c.key]) : formato(s[c.key], c.tipo)}</td>`;
        }).join('')}</tr>`
      )
      .join('');
    host.innerHTML = `<div class="tabla-suc-wrap"><table class="tabla tabla-suc"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
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
// Color de celda según umbral (verde/ámbar/rojo) para lectura rápida.
function celColor(key, val) {
  if (typeof val !== 'number') return '';
  const mayorMejor = (v, a, b) => (v >= a ? 'cel-ok' : v >= b ? 'cel-amber' : 'cel-rojo');
  const menorMejor = (v, a, b) => (v <= a ? 'cel-ok' : v <= b ? 'cel-amber' : 'cel-rojo');
  switch (key) {
    case 'pctAsistencia':
    case 'pctMalla':
      return mayorMejor(val, 95, 90);
    case 'pctHHEERecon':
      return mayorMejor(val, 50, 30);
    case 'pctTardanza':
      return menorMejor(val, 5, 15);
    default:
      return '';
  }
}

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
