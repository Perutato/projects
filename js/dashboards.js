// =============================================================================
// dashboards.js
// Vista de los dashboards Tienda y Logística.
// - Cabecera en un campo plano del color del dashboard con la cifra principal.
// - Barra de filtros (rango de fechas primero) que gobierna toda la vista.
// - Pestañas por tipo de análisis.
// - Cada tarjeta, barra, tramo, celda, punto o marca es clicable: abre el panel
//   de trabajadores detrás de ese número, con descarga a Excel (trabajadores +
//   detalle por día + filtro) o CSV.
// - "Anatomía de la jornada": las cuatro marcas del reloj (E1 · S1 · E2 · S2)
//   dibujadas sobre el turno típico, con los minutos que se fugan en cada una.
// =============================================================================

import { fmtMiles, fmtPct, fmtHoras, fmtDec1 } from './config.js';
import * as charts from './charts.js';
import { T } from './charts.js';
import { exportarCSV, exportarExcelHojas, hojaRegistro, hojaResumenIncidencias } from './exports.js';
import { icon, help } from './icons.js';

// Color de interfaz (campo de cabecera, acciones) y color de dato (marcas de
// gráfico; el mismo tono, un paso más claro para leerse como dato).
const COLOR = {
  Tienda: { ui: '#1F4E78', dato: '#1c5cab' },
  'Logística': { ui: '#375623', dato: '#3d7a2a' },
};
const NOMBRE = { Tienda: 'Tiendas', 'Logística': 'Centros de distribución' };

// ---- Catálogo de KPIs --------------------------------------------------------
// good: dirección buena; drill: métrica del panel de trabajadores; spark: campo
// de la serie temporal para la mini tendencia.
const KPI = {
  personas: { lbl: 'Personas', fmt: 'int', tip: 'Personas únicas (keyID) en el filtro.', drill: 'personas' },
  fiscalizables: { lbl: 'Fiscalizables', fmt: 'int', tip: 'Personas con "Exije huella" = Sí.', drill: 'fiscalizables' },
  noFiscalizables: { lbl: 'No fiscalizables', fmt: 'int', tip: 'Personas con "Exije huella" = No o sin dato.', drill: 'noFiscalizables' },
  pctAsistencia: { lbl: 'Asistencia', fmt: 'pct', good: 'up', tip: 'Σ días presentes ÷ Σ días esperados.', drill: 'asistencia', spark: 'pctAsistencia' },
  pctMalla: { lbl: 'Cumplimiento de malla', fmt: 'pct', good: 'up', tip: '1 − (días no planificados ÷ Σ días trabajados). Meta 95%.', drill: 'noPlan', estado: true },
  diasNoPlan: { lbl: 'Días no planificados', fmt: 'int', good: 'down', tip: 'Σ días trabajados sin turno en la malla.', drill: 'noPlan', spark: 'diasNoPlan' },
  trabajadoresNoPlan: { lbl: 'Personas sin turno', fmt: 'int', good: 'down', tip: 'Personas con al menos un día trabajado sin turno.', drill: 'noPlan' },
  faltasInjust: { lbl: 'Faltas injustificadas', fmt: 'int', good: 'down', tip: 'Días con estado Falta injustificada.', drill: 'faltas', spark: 'faltas' },
  diasSinMarcacion: { lbl: 'Días sin marcación', fmt: 'int', good: 'down', tip: 'Días con turno y sin ninguna marca.', drill: 'sinMarcacion', spark: 'sinMarcacion' },
  tardanzasDias: { lbl: 'Tardanzas (E1)', fmt: 'int', good: 'down', tip: 'Días con atraso en la primera entrada.', drill: 'tardanzas', spark: 'tardanzas' },
  pctTardanza: { lbl: 'Tardanza sobre presentes', fmt: 'pct', good: 'down', tip: 'Σ tardanzas ÷ Σ días presentes.', drill: 'tardanzas', spark: 'pctTardanza' },
  personasTardanza: { lbl: 'Personas con tardanza', fmt: 'int', good: 'down', tip: 'Personas con al menos una tardanza.', drill: 'tardanzas' },
  minTardanza: { lbl: 'Minutos de tardanza', fmt: 'int', good: 'down', tip: 'Σ minutos de atraso en E1.', drill: 'tardanzas' },
  salidasAntDias: { lbl: 'Salidas anticipadas', fmt: 'int', good: 'down', tip: 'Días con adelanto en la salida final (S2).', drill: 'salidas' },
  fugaH: { lbl: 'Fuga de tiempo', fmt: 'h', good: 'down', tip: 'Σ (atraso E1 + adelanto S2) ÷ 60.', drill: 'fuga', spark: 'fugaH' },
  fugaHporFisc: { lbl: 'Fuga por fiscalizable', fmt: 'dec', unidad: ' h', good: 'down', tip: 'Fuga (h) ÷ personas fiscalizadas.', drill: 'fuga' },
  diasJustificacion: { lbl: 'Días con justificación', fmt: 'int', tip: 'Días con justificación registrada.', drill: 'justificaciones' },
  minJustificados: { lbl: 'Minutos justificados', fmt: 'int', tip: 'Σ minutos de atraso y de salida justificados.', drill: 'justificaciones' },
  marcacionCompleta: { lbl: 'Marcación completa', fmt: 'int', good: 'up', tip: 'Días con las marcas completas.', drill: 'marcCompleta' },
  marcacionIncompleta: { lbl: 'Marcación incompleta', fmt: 'int', good: 'down', tip: 'Días con alguna marca, pero incompletos.', drill: 'marcIncompleta' },
  marcasManuales: { lbl: 'Marcas manuales', fmt: 'int', good: 'down', tip: 'Σ marcas con Tipo = "M" (ingresadas a mano).', drill: 'manuales' },
  excesoRefrigerioDias: { lbl: 'Exceso de refrigerio', fmt: 'int', unidad: ' d', good: 'down', tip: 'Días con refrigerio real − programado mayor a la tolerancia.', drill: 'exceso' },
  trabajoEnDescanso: { lbl: 'Trabajó en descanso', fmt: 'int', good: 'down', tip: 'Días con turno Descanso y alguna marca.', drill: 'descanso' },
  trabajoFeriado: { lbl: 'Trabajó en feriado', fmt: 'int', tip: 'Días feriados con trabajo.', drill: 'feriado' },
  hheeEjecH: { lbl: 'HHEE ejecutadas', fmt: 'h', tip: 'Σ tiempo extra ejecutado (TE) ÷ 60, de todo el archivo de Tiempo Extra.', drill: 'hhee', spark: 'hheeH' },
  hheeAutH: { lbl: 'HHEE aprobadas', fmt: 'h', tip: 'Σ HEA (autorizadas) ÷ 60.', drill: 'hhee' },
  hheeReconH: { lbl: 'HHEE reconocidas', fmt: 'h', good: 'up', tip: 'Σ Finales (reconocido / pagable) ÷ 60.', drill: 'hhee' },
  hheeNoReconH: { lbl: 'HHEE no reconocidas', fmt: 'h', good: 'down', tip: 'Ejecutadas − reconocidas.', drill: 'hheeNoRec' },
  pctHHEERecon: { lbl: 'HHEE reconocidas sobre ejecutadas', fmt: 'pct', good: 'up', tip: 'Finales ÷ ejecutadas.', drill: 'hhee' },
  desviacionHHEEH: { lbl: 'Desviación de HHEE', fmt: 'h', good: 'up', tip: 'Aprobadas − ejecutadas. Negativo = se trabajó más de lo aprobado.', drill: 'desviacion' },
};

// ---- Catálogo de gráficos -------------------------------------------------
const GRAF = {
  asistencia: {
    titulo: 'Asistencia por sucursal', sub: 'De menor a mayor', tipo: 'barras',
    formula: 'Σ días presentes ÷ Σ días esperados, por sucursal.',
    datos: (d) => d.graficos.asistencia, opts: { sufijo: '%', decimales: true, nombreSerie: 'asistencia' }, metrica: 'asistencia',
    cols: [['sucursal', 'Sucursal', 'txt'], ['valor', 'Asistencia', 'pct'], ['presentes', 'Presentes', 'int'], ['esperados', 'Días esperados', 'int']],
  },
  noPlan: {
    titulo: 'Días no planificados por sucursal', sub: 'Días trabajados sin turno, con las personas afectadas', tipo: 'barras',
    formula: 'Σ días trabajados sin turno en la malla. El segundo número son las personas afectadas.',
    datos: (d) => d.graficos.noPlan, opts: { sufijo: ' d', badge: true, etiquetaBadge: 'pers.', nombreSerie: 'días sin turno' }, metrica: 'noPlan',
    cols: [['sucursal', 'Sucursal', 'txt'], ['valor', 'Días', 'int'], ['badge', 'Personas', 'int']],
  },
  malla: {
    titulo: 'Cumplimiento de malla por sucursal', sub: 'De menor a mayor; la línea marca la meta de 95%', tipo: 'barras',
    formula: '1 − (días no planificados ÷ Σ días trabajados), por sucursal.',
    datos: (d) => d.graficos.malla, opts: { sufijo: '%', decimales: true, meta: 95, nombreSerie: 'cumplimiento' }, metrica: 'noPlan',
    cols: [['sucursal', 'Sucursal', 'txt'], ['valor', 'Cumplimiento', 'pct']],
  },
  justificaciones: {
    titulo: 'Días con justificación por sucursal', sub: 'Regularizaciones de tardanzas y salidas registradas', tipo: 'barras',
    formula: 'Días con justificación registrada (de atraso o de salida), por sucursal.',
    datos: (d) => d.graficos.justificaciones, opts: { sufijo: ' d', nombreSerie: 'días justificados' }, metrica: 'justificaciones',
    cols: [['sucursal', 'Sucursal', 'txt'], ['valor', 'Días', 'int']],
  },
  tardanzas: {
    titulo: 'Tardanzas por sucursal', sub: 'Días con atraso en E1 y personas que llegaron tarde', tipo: 'barras',
    formula: 'Σ días con atraso en la primera entrada (E1), por sucursal.',
    datos: (d) => d.graficos.tardanzas, opts: { sufijo: ' d', badge: true, etiquetaBadge: 'pers.', nombreSerie: 'tardanzas' }, metrica: 'tardanzas',
    cols: [['sucursal', 'Sucursal', 'txt'], ['valor', 'Tardanzas', 'int'], ['badge', 'Personas', 'int'], ['pct', '% sobre presentes', 'pct']],
  },
  fuga: {
    titulo: 'Fuga de tiempo por sucursal', sub: 'Horas perdidas por tardanzas y por salidas anticipadas', tipo: 'apiladas',
    formula: 'Σ atraso E1 (tardanzas) + Σ adelanto S2 (salidas anticipadas), en horas.',
    datos: (d) => d.graficos.fuga, sufijo: ' h', metricaReporte: 'fuga',
    series: [{ key: 'a', nombre: 'Tardanzas', color: T.s1, metrica: 'tardanzas' }, { key: 'b', nombre: 'Salidas anticipadas', color: T.s2, metrica: 'salidas' }],
    cols: [['sucursal', 'Sucursal', 'txt'], ['a', 'Tardanzas (h)', 'h'], ['b', 'Salidas anticipadas (h)', 'h']],
  },
  justHoras: {
    titulo: 'Horas justificadas por sucursal', sub: 'Atrasos de ingreso y adelantos de salida justificados', tipo: 'apiladas',
    formula: 'Σ minutos de atraso justificado y Σ minutos de salida justificada, en horas.',
    datos: (d) => d.graficos.justHoras, sufijo: ' h', metricaReporte: 'justificaciones',
    series: [{ key: 'a', nombre: 'Atrasos justificados', color: T.s1, metrica: 'justAtraso' }, { key: 'b', nombre: 'Salidas justificadas', color: T.s2, metrica: 'justSalida' }],
    cols: [['sucursal', 'Sucursal', 'txt'], ['a', 'Atrasos (h)', 'h'], ['b', 'Salidas (h)', 'h']],
  },
  hhee: {
    titulo: 'Horas extra por sucursal', sub: 'Ejecutadas, aprobadas y reconocidas', tipo: 'agrupadas',
    formula: 'Ejecutadas = TE; aprobadas = HEA; reconocidas = Finales. En horas, de todo el archivo de Tiempo Extra.',
    datos: (d) => d.graficos.hhee, sufijo: ' h', metrica: 'hhee',
    series: [{ key: 'ejecutadas', nombre: 'Ejecutadas', color: T.s1 }, { key: 'aprobadas', nombre: 'Aprobadas', color: T.s2 }, { key: 'cumplidas', nombre: 'Reconocidas', color: T.s3 }],
    cols: [['sucursal', 'Sucursal', 'txt'], ['ejecutadas', 'Ejecutadas (h)', 'h'], ['aprobadas', 'Aprobadas (h)', 'h'], ['cumplidas', 'Reconocidas (h)', 'h']],
  },
  brecha: {
    titulo: 'Brecha de horas extra', sub: 'Aprobadas menos ejecutadas: en rojo se trabajó más de lo aprobado', tipo: 'divergentes',
    formula: 'Aprobadas (HEA) − ejecutadas (TE), en horas. Negativo = sobre-ejecución.',
    datos: (d) => d.graficos.brecha, sufijo: ' h', metrica: 'desviacion',
    cols: [['sucursal', 'Sucursal', 'txt'], ['valor', 'Brecha (h)', 'h']],
  },
};

// Indicadores revisados: un gráfico por control.
const GRAF_CTL = {
  ctlFeriado: {
    titulo: 'HHEE aprobadas o compensadas en feriado', sub: 'No debería haber casos · horas por sucursal', tipo: 'agrupadas',
    formula: 'Días de Tiempo Extra en fecha feriada (F) con horas aprobadas (HEA > 0) o compensadas/reconocidas (Finales > 0). El feriado sale del calendario de asistencia de la persona.',
    datos: (d) => d.controles.graficos.hheeFeriado, sufijo: ' h', metrica: 'hheeFeriado', vacio: 'Sin casos en el filtro: el control se cumple.',
    series: [{ key: 'a', nombre: 'Aprobadas (HEA)', color: T.s1, metrica: 'hheeFeriadoAprob' }, { key: 'b', nombre: 'Compensadas (Finales)', color: T.s2, metrica: 'hheeFeriadoComp' }],
    cols: [['sucursal', 'Sucursal', 'txt'], ['casos', 'Días', 'int'], ['personas', 'Personas', 'int'], ['a', 'Aprobadas (h)', 'h'], ['b', 'Compensadas (h)', 'h']],
  },
  ctlPartTime: {
    titulo: 'HHEE aprobadas a part-time', sub: 'Solo por contingencia · horas aprobadas y personas', tipo: 'barras',
    formula: 'Días de Tiempo Extra con horas aprobadas (HEA > 0) de personas con jornada Part Time (según las horas semanales de la Dotación).',
    datos: (d) => d.controles.graficos.hheePartTime, opts: { sufijo: ' h', decimales: true, badge: true, etiquetaBadge: 'pers.', nombreSerie: 'HHEE aprobadas' }, metrica: 'hheePartTime',
    vacio: 'Sin HHEE aprobadas a part-time en el filtro.',
    cols: [['sucursal', 'Sucursal', 'txt'], ['casos', 'Días', 'int'], ['badge', 'Personas', 'int'], ['valor', 'Aprobadas (h)', 'h'], ['ejecH', 'Ejecutadas (h)', 'h']],
  },
  ctlFalta: {
    titulo: 'Faltas con turno y sin licencia', sub: 'Días con turno programado, sin ninguna marca y sin permiso que lo justifique', tipo: 'apiladas',
    formula: 'Turno programado + 0 marcas + permiso "Ninguno" o "Inasistencia injustificada" (sin vacaciones, descanso médico, licencia ni suspensión).',
    datos: (d) => d.controles.graficos.faltaSinLicencia, sufijo: ' d', decimales: false, metrica: 'faltaSinLicencia', vacio: 'Sin faltas sin licencia en el filtro.',
    series: [{ key: 'a', nombre: 'Registrada como inasistencia', color: T.s1, metrica: 'faltaSinLicReg' }, { key: 'b', nombre: 'Sin marcas ni permiso', color: T.s2, metrica: 'faltaSinLicSinMarca' }],
    cols: [['sucursal', 'Sucursal', 'txt'], ['casos', 'Días', 'int'], ['personas', 'Personas', 'int'], ['a', 'Registradas como inasistencia', 'int'], ['b', 'Sin marcas ni permiso', 'int']],
  },
  ctlMarca: {
    titulo: 'Días con una marca faltante', sub: 'Marcó, pero le falta la entrada, la salida o el refrigerio', tipo: 'agrupadas',
    formula: 'Días con al menos una marca en los que falta E1 (entrada), S2 (salida) o, con refrigerio programado, S1 o E2. Un mismo día puede faltar en más de una.',
    datos: (d) => d.controles.graficos.marcaFaltante, sufijo: ' d', decimales: false, metrica: 'marcaFaltante', vacio: 'Sin marcas faltantes en el filtro.',
    series: [
      { key: 'entrada', nombre: 'Falta entrada', color: T.s1, metrica: 'faltaEntrada' },
      { key: 'salida', nombre: 'Falta salida', color: T.s2, metrica: 'faltaSalida' },
      { key: 'refrigerio', nombre: 'Falta refrigerio', color: T.s3, metrica: 'faltaRefrigerio' },
    ],
    cols: [['sucursal', 'Sucursal', 'txt'], ['casos', 'Días', 'int'], ['personas', 'Personas', 'int'], ['entrada', 'Falta entrada', 'int'], ['salida', 'Falta salida', 'int'], ['refrigerio', 'Falta refrigerio', 'int']],
  },
  ctlPlan: {
    titulo: 'Marcaciones en descanso o sin planificación', sub: 'Probablemente se olvidó asignar el turno', tipo: 'apiladas',
    formula: 'Días con marcas y turno "Descanso", o con marcas y sin turno en la malla.',
    datos: (d) => d.controles.graficos.marcaSinPlan, sufijo: ' d', decimales: false, metrica: 'marcaSinPlan', vacio: 'Sin marcaciones fuera de la planificación en el filtro.',
    series: [{ key: 'a', nombre: 'En día de descanso', color: T.s1, metrica: 'descanso' }, { key: 'b', nombre: 'Sin turno asignado', color: T.s2, metrica: 'noPlan' }],
    cols: [['sucursal', 'Sucursal', 'txt'], ['casos', 'Días', 'int'], ['personas', 'Personas', 'int'], ['a', 'En descanso', 'int'], ['b', 'Sin turno', 'int']],
  },
};
Object.assign(GRAF, GRAF_CTL);

// Tarjetas de los controles: qué se revisa, cuántos casos y si cumple.
const CTL = [
  { id: 'hheeFeriado', graf: 'ctlFeriado', lbl: 'HHEE en feriado', te: true, estricto: true, unidad: 'días', extra: (r) => `${fmtHoras(r.aprobH)} h aprob. · ${fmtHoras(r.compH)} h comp.` },
  { id: 'hheePartTime', graf: 'ctlPartTime', lbl: 'HHEE a part-time', te: true, unidad: 'días', extra: (r) => `${fmtHoras(r.aprobH)} h aprobadas` },
  { id: 'faltaSinLicencia', graf: 'ctlFalta', lbl: 'Faltas con turno y sin licencia', unidad: 'días', extra: (r) => `${fmtMiles(r.sinMarca)} sin marcas ni permiso` },
  { id: 'marcaFaltante', graf: 'ctlMarca', lbl: 'Días con una marca faltante', unidad: 'días', extra: (r) => `${fmtMiles(r.entrada)} entr. · ${fmtMiles(r.salida)} sal. · ${fmtMiles(r.refrigerio)} refr.` },
  { id: 'marcaSinPlan', graf: 'ctlPlan', lbl: 'Marcó en descanso o sin turno', unidad: 'días', extra: (r) => `${fmtMiles(r.descanso)} descanso · ${fmtMiles(r.sinTurno)} sin turno` },
];

const TEND = [
  { campo: 'pctAsistencia', nombre: 'Asistencia', sufijo: '%', dec: true, metrica: 'asistencia' },
  { campo: 'tardanzas', nombre: 'Tardanzas', sufijo: '', metrica: 'tardanzas' },
  { campo: 'fugaH', nombre: 'Fuga de tiempo', sufijo: ' h', dec: true, metrica: 'fuga' },
  { campo: 'diasNoPlan', nombre: 'Días no planificados', sufijo: '', metrica: 'noPlan' },
  { campo: 'faltas', nombre: 'Faltas', sufijo: '', metrica: 'faltas' },
  { campo: 'hheeH', nombre: 'Horas extra', sufijo: ' h', dec: true, metrica: 'hhee' },
];
const CALOR = [
  { campo: 'incid', nombre: 'Incidencias', sufijo: '', metrica: 'incidencias', ayuda: 'Faltas injustificadas + días sin marcación + marcación incompleta.' },
  { campo: 'pctAsist', nombre: 'Asistencia', sufijo: '%', metrica: 'asistencia', ayuda: 'Σ presentes ÷ Σ días esperados (más oscuro = peor).' },
  { campo: 'tard', nombre: 'Tardanzas', sufijo: '', metrica: 'tardanzas', ayuda: 'Días con atraso en E1.' },
  { campo: 'fugaH', nombre: 'Fuga (h)', sufijo: ' h', metrica: 'fuga', ayuda: 'Horas de atraso E1 + adelanto S2.' },
  { campo: 'noPlan', nombre: 'No planificados', sufijo: '', metrica: 'noPlan', ayuda: 'Días trabajados sin turno.' },
];

const TABS = [
  { id: 'resumen', lbl: 'Resumen' },
  { id: 'asistencia', lbl: 'Asistencia y malla' },
  { id: 'marcacion', lbl: 'Marcación' },
  { id: 'fuga', lbl: 'Puntualidad y fuga' },
  { id: 'hhee', lbl: 'Horas extra' },
  { id: 'controles', lbl: 'Indicadores revisados' },
  { id: 'sucursales', lbl: 'Sucursales' },
];

const TOP = 15;

export function crearDashboards({ callWorker, getCfg }) {
  let opciones = null;
  const estado = { Tienda: filtrosPorDefecto('Tienda'), 'Logística': filtrosPorDefecto('Logística') };
  const tab = { Tienda: 'resumen', 'Logística': 'resumen' };
  const ultData = {};
  const vista = new Map(); // `${dashboard}:${grafico}` -> { modo: 'grafico'|'tabla', todas: bool }
  const tendCampo = { Tienda: 'pctAsistencia', 'Logística': 'pctAsistencia' };
  const calorCampo = { Tienda: 'incid', 'Logística': 'incid' };
  const anatSuc = { Tienda: '', 'Logística': '' };
  const anatMalla = { Tienda: '', 'Logística': '' }; // malla horaria elegida (clave) o '' = turno típico
  const anatMallaTodas = { Tienda: false, 'Logística': false };
  const ordenSuc = { Tienda: 'fugaH', 'Logística': 'fugaH' };
  let panelAbierto = null; // multiselect de sucursal abierto (un solo listener global)
  let drawerEstado = null;

  // Un único listener global para cerrar el selector de sucursales.
  document.addEventListener('click', (e) => {
    if (panelAbierto && !panelAbierto.host.contains(e.target)) cerrarMultiSucursal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (panelAbierto) cerrarMultiSucursal();
      else if (drawerEstado) cerrarDrawer();
    }
  });

  function filtrosPorDefecto(dashboard) {
    return {
      dashboard, granularidad: 'dia', fechaDesde: null, fechaHasta: null, sucursales: [], jefes: [], cargos: [],
      campanero: '', sindicalizado: '', jornada: '', modeloDias: '', fiscalizacion: '', calendario: '', comparar: false,
    };
  }
  function setOpciones(op) { opciones = op; }
  function contenedor(dashboard) {
    return document.getElementById('vista-' + dashboard.toLowerCase().replace('í', 'i'));
  }

  // ---------------------------------------------------------------------------
  async function render(dashboard) {
    const cont = contenedor(dashboard);
    if (!cont) return;
    cont.style.setProperty('--acento', COLOR[dashboard].ui);
    cont.style.setProperty('--dato', COLOR[dashboard].dato);
    if (!opciones) {
      cont.innerHTML = `<div class="vacio-vista"><h1>${NOMBRE[dashboard]}</h1><p>Todavía no hay datos. Carga la Dotación, la Asistencia y el Tiempo Extra en <b>Carga</b>.</p></div>`;
      return;
    }
    charts.limpiarGraficos();
    cont.innerHTML = `
      <header class="dash-head" data-head></header>
      <div class="filtros" data-filtros></div>
      <div class="dash-avisos" data-avisos></div>
      <nav class="tabs" role="tablist" aria-label="Tipo de análisis" data-tabs></nav>
      <div class="tab-content" role="tabpanel" data-tab-content></div>
      <div class="drawer-capa" data-drawer hidden></div>`;
    pintarFiltros(dashboard, cont);
    pintarTabs(dashboard, cont);
    await actualizar(dashboard, cont);
  }

  async function actualizar(dashboard, cont) {
    const host = cont.querySelector('[data-tab-content]');
    // Mantener el cuadro anterior atenuado mientras llegan los datos.
    if (host) host.classList.add('cargando');
    const data = await callWorker('dashboard', { filtros: estado[dashboard], cfg: getCfg() });
    ultData[dashboard] = data;
    pintarCabecera(dashboard, cont, data);
    const nCtl = CTL.filter((c) => data.controles.resumen[c.id].casos > 0).length;
    const tabCtl = cont.querySelector('[data-tab="controles"]');
    if (tabCtl) tabCtl.innerHTML = `Indicadores revisados${nCtl ? ` <span class="tab-cuenta" aria-label="${nCtl} con casos">${nCtl}</span>` : ''}`;
    pintarAvisos(dashboard, cont, data);
    renderTab(dashboard, cont);
    if (host) host.classList.remove('cargando');
  }

  // ---- Cabecera ---------------------------------------------------------------
  function pintarCabecera(dashboard, cont, data) {
    const f = estado[dashboard];
    const k = data.kpis;
    const desde = f.fechaDesde || opciones.fechaMin;
    const hasta = f.fechaHasta || opciones.fechaMax;
    const nSuc = data.porSucursal.length;
    const prev = data.kpisPrev;
    const delta = prev ? deltaTexto(KPI.pctAsistencia, k.pctAsistencia, prev.pctAsistencia, true) : '';
    cont.querySelector('[data-head]').innerHTML = `
      <div class="dash-head-txt">
        <h1>${NOMBRE[dashboard]}: asistencia y horas extra</h1>
        <p>Del ${fFecha(desde)} al ${fFecha(hasta)} · ${fmtMiles(k.personas)} personas en ${fmtMiles(nSuc)} ${nSuc === 1 ? 'sucursal' : 'sucursales'}</p>
      </div>
      <button class="dash-head-cifra" data-drill="asistencia" title="Ver a los trabajadores y su asistencia">
        <span class="cifra">${fmtPct(k.pctAsistencia)}</span>
        <span class="cifra-lbl">de asistencia${delta ? ` · ${delta}` : ''}</span>
      </button>`;
    cont.querySelector('[data-head] [data-drill]').addEventListener('click', () => abrirDrill(dashboard, { metrica: 'asistencia' }));
  }

  function pintarAvisos(dashboard, cont, data) {
    const f = estado[dashboard];
    const avisos = [];
    const pequenas = data.porSucursal.filter((s) => s.personas < 10).length;
    if (pequenas) avisos.push(`${fmtMiles(pequenas)} ${pequenas === 1 ? 'sucursal tiene' : 'sucursales tienen'} menos de 10 personas: sus porcentajes se mueven mucho con un solo caso.`);
    if (f.comparar && !data.kpisPrev) avisos.push('Para comparar con el período anterior elige primero un rango de fechas (Último día, Última semana o Mes).');
    if (f.comparar && data.rangoPrevio) avisos.push(`Comparando con el período anterior: del ${fFecha(data.rangoPrevio.fechaDesde)} al ${fFecha(data.rangoPrevio.fechaHasta)}.`);
    avisos.push('Sucursal, cargo y jefe salen de la Dotación vigente hoy, aunque la asistencia sea de un período pasado.');
    cont.querySelector('[data-avisos]').innerHTML = avisos.map((a, i) => `<p class="${i === avisos.length - 1 ? 'aviso-sutil' : 'aviso'}">${i === avisos.length - 1 ? '' : icon('warning')}<span>${a}</span></p>`).join('');
  }

  // ---- Filtros ----------------------------------------------------------------
  function pintarFiltros(dashboard, cont) {
    const f = estado[dashboard];
    const caja = cont.querySelector('[data-filtros]');
    const sel = (campo, lista) => `<select data-f="${campo}">${['<option value="">Todos</option>'].concat((lista || []).map((v) => `<option value="${esc(v)}" ${f[campo] === v || (Array.isArray(f[campo]) && f[campo][0] === v) ? 'selected' : ''}>${esc(v)}</option>`)).join('')}</select>`;
    const extras = ['jefes', 'cargos', 'campanero', 'sindicalizado', 'jornada', 'modeloDias', 'fiscalizacion', 'calendario']
      .filter((c) => (Array.isArray(f[c]) ? f[c].length : f[c])).length;
    const preset = presetActivo(f);
    const seg = (v, lbl) => `<button type="button" data-rango="${v}" class="${preset === v ? 'activo' : ''}" aria-pressed="${preset === v}">${lbl}</button>`;
    const gseg = (v, lbl) => `<button type="button" data-gran="${v}" class="${f.granularidad === v ? 'activo' : ''}" aria-pressed="${f.granularidad === v}">${lbl}</button>`;
    caja.innerHTML = `
      <div class="filtros-fila">
        <div class="fgrupo"><span class="flbl">Período</span>
          <div class="segment">${seg('dia', 'Último día')}${seg('semana', 'Última semana')}${seg('mes', 'Mes')}${seg('todo', 'Todo')}</div>
        </div>
        <label class="fgrupo"><span class="flbl">Desde</span><input type="date" data-desde value="${isoDate(f.fechaDesde)}" /></label>
        <label class="fgrupo"><span class="flbl">Hasta</span><input type="date" data-hasta value="${isoDate(f.fechaHasta)}" /></label>
        <div class="fgrupo"><span class="flbl">Sucursal</span><div class="multi" data-multisuc></div></div>
        <div class="fgrupo"><span class="flbl">Ver por</span><div class="segment">${gseg('dia', 'Día')}${gseg('semana', 'Semana')}${gseg('mes', 'Mes')}</div></div>
        <label class="fgrupo fcheck"><input type="checkbox" data-comparar ${f.comparar ? 'checked' : ''}/> <span>Comparar con el período anterior</span></label>
        <div class="fgrupo facc">
          <button type="button" class="btn-sec" data-mas aria-expanded="false">${icon('filtro')}<span>Más filtros${extras ? ` (${extras})` : ''}</span></button>
          <button type="button" class="btn-link" data-limpiar>Limpiar</button>
        </div>
      </div>
      <div class="filtros-fila filtros-mas" data-mas-panel hidden>
        <label class="fgrupo"><span class="flbl">Jefe directo</span>${sel('jefes', opciones.jefes)}</label>
        <label class="fgrupo"><span class="flbl">Cargo</span>${sel('cargos', opciones.cargos)}</label>
        <label class="fgrupo"><span class="flbl">Campañero</span>${sel('campanero', ['Sí', 'No'])}</label>
        <label class="fgrupo"><span class="flbl">Sindicalizado</span>${sel('sindicalizado', ['Sí', 'No'])}</label>
        <label class="fgrupo"><span class="flbl">Jornada</span>${sel('jornada', opciones.jornadas)}</label>
        <label class="fgrupo"><span class="flbl">Modelo de días</span>${sel('modeloDias', opciones.modelosDias)}</label>
        <label class="fgrupo"><span class="flbl">Fiscalización</span>${sel('fiscalizacion', opciones.fiscalizaciones)}</label>
        <label class="fgrupo"><span class="flbl">Calendario</span>${sel('calendario', opciones.calendarios)}</label>
      </div>`;

    const recargar = () => { pintarFiltros(dashboard, cont); actualizar(dashboard, cont); };
    caja.querySelectorAll('[data-rango]').forEach((b) => b.addEventListener('click', () => { aplicarPreset(f, b.dataset.rango); recargar(); }));
    caja.querySelectorAll('[data-gran]').forEach((b) => b.addEventListener('click', () => { f.granularidad = b.dataset.gran; recargar(); }));
    const dD = caja.querySelector('[data-desde]');
    const dH = caja.querySelector('[data-hasta]');
    const onFecha = () => {
      f.fechaDesde = dD.value ? dD.value.replace(/-/g, '') : null;
      f.fechaHasta = dH.value ? dH.value.replace(/-/g, '') : null;
      recargar();
    };
    dD.addEventListener('change', onFecha);
    dH.addEventListener('change', onFecha);
    caja.querySelector('[data-comparar]').addEventListener('change', (e) => { f.comparar = e.target.checked; actualizar(dashboard, cont); });
    caja.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => {
      const c = s.dataset.f;
      f[c] = c === 'jefes' || c === 'cargos' ? (s.value ? [s.value] : []) : s.value;
      actualizar(dashboard, cont);
      const b = caja.querySelector('[data-mas] span');
      const n = ['jefes', 'cargos', 'campanero', 'sindicalizado', 'jornada', 'modeloDias', 'fiscalizacion', 'calendario'].filter((x) => (Array.isArray(f[x]) ? f[x].length : f[x])).length;
      b.textContent = `Más filtros${n ? ` (${n})` : ''}`;
    }));
    const mas = caja.querySelector('[data-mas]');
    const masPanel = caja.querySelector('[data-mas-panel]');
    if (extras) { masPanel.hidden = false; mas.setAttribute('aria-expanded', 'true'); }
    mas.addEventListener('click', () => {
      masPanel.hidden = !masPanel.hidden;
      mas.setAttribute('aria-expanded', String(!masPanel.hidden));
    });
    caja.querySelector('[data-limpiar]').addEventListener('click', () => {
      estado[dashboard] = filtrosPorDefecto(dashboard);
      estado[dashboard].granularidad = f.granularidad;
      recargar();
    });
    pintarMultiSucursal(dashboard, cont, caja.querySelector('[data-multisuc]'));
  }

  function pintarMultiSucursal(dashboard, cont, host) {
    const f = estado[dashboard];
    const lista = (opciones.sucursalesPorDashboard && opciones.sucursalesPorDashboard[dashboard]) || opciones.sucursales || [];
    const etiqueta = () => (f.sucursales.length === 0 ? 'Todas' : f.sucursales.length === 1 ? f.sucursales[0] : `${f.sucursales.length} sucursales`);
    host.innerHTML = `
      <button type="button" class="multi-btn" aria-haspopup="listbox" aria-expanded="false">${esc(etiqueta())}</button>
      <div class="multi-panel" hidden>
        <input type="search" class="input" placeholder="Buscar sucursal" aria-label="Buscar sucursal" />
        <div class="multi-acc"><button type="button" class="btn-link" data-todas>Todas</button><button type="button" class="btn-link" data-ninguna>Quitar selección</button></div>
        <div class="multi-lista" role="listbox" aria-multiselectable="true"></div>
        <div class="multi-pie"><button type="button" class="btn" data-aplicar>Aplicar</button></div>
      </div>`;
    const btn = host.querySelector('.multi-btn');
    const panel = host.querySelector('.multi-panel');
    const buscar = host.querySelector('input');
    const caja = host.querySelector('.multi-lista');
    let seleccion = new Set(f.sucursales);
    const pintar = () => {
      const q = buscar.value.toLowerCase();
      const items = lista.filter((s) => s.toLowerCase().includes(q));
      caja.innerHTML = items.length
        ? items.map((s) => `<label class="multi-item"><input type="checkbox" value="${esc(s)}" ${seleccion.has(s) ? 'checked' : ''}/> <span>${esc(s)}</span></label>`).join('')
        : '<p class="nota">Sin coincidencias.</p>';
      caja.querySelectorAll('input').forEach((c) => c.addEventListener('change', () => {
        if (c.checked) seleccion.add(c.value); else seleccion.delete(c.value);
      }));
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!panel.hidden) { cerrarMultiSucursal(); return; }
      seleccion = new Set(f.sucursales);
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      panelAbierto = { host, panel, btn };
      pintar();
      buscar.focus();
    });
    buscar.addEventListener('input', pintar);
    host.querySelector('[data-todas]').addEventListener('click', () => { lista.forEach((s) => seleccion.add(s)); pintar(); });
    host.querySelector('[data-ninguna]').addEventListener('click', () => { seleccion.clear(); pintar(); });
    host.querySelector('[data-aplicar]').addEventListener('click', () => {
      const nueva = [...seleccion].filter((s) => lista.includes(s));
      // "Todas marcadas" equivale a sin filtro.
      f.sucursales = nueva.length === lista.length ? [] : nueva;
      cerrarMultiSucursal();
      pintarFiltros(dashboard, cont);
      actualizar(dashboard, cont);
    });
  }
  function cerrarMultiSucursal() {
    if (!panelAbierto) return;
    panelAbierto.panel.hidden = true;
    panelAbierto.btn.setAttribute('aria-expanded', 'false');
    panelAbierto = null;
  }

  function presetActivo(f) {
    const max = opciones.fechaMax;
    if (!f.fechaDesde && !f.fechaHasta) return 'todo';
    if (f.fechaHasta !== max) return '';
    if (f.fechaDesde === max) return 'dia';
    if (f.fechaDesde === ymd(addDias(dateDe(max), -6)) || f.fechaDesde === opciones.fechaMin && diasEntre(f.fechaDesde, max) < 7) return 'semana';
    if (f.fechaDesde === mesInicio(max) || f.fechaDesde === opciones.fechaMin && f.fechaDesde > mesInicio(max)) return 'mes';
    return '';
  }
  function aplicarPreset(f, tipo) {
    const max = opciones.fechaMax;
    const min = opciones.fechaMin;
    if (!max || tipo === 'todo') { f.fechaDesde = null; f.fechaHasta = null; return; }
    let desde = max;
    if (tipo === 'semana') desde = ymd(addDias(dateDe(max), -6));
    else if (tipo === 'mes') desde = mesInicio(max);
    f.fechaDesde = desde < min ? min : desde;
    f.fechaHasta = max;
  }

  // ---- Pestañas -----------------------------------------------------------------
  function pintarTabs(dashboard, cont) {
    const nav = cont.querySelector('[data-tabs]');
    nav.innerHTML = TABS.map((t) => `<button role="tab" class="tab" data-tab="${t.id}" aria-selected="${tab[dashboard] === t.id}" tabindex="${tab[dashboard] === t.id ? 0 : -1}">${t.lbl}</button>`).join('');
    const botones = [...nav.querySelectorAll('[data-tab]')];
    const activar = (b) => {
      tab[dashboard] = b.dataset.tab;
      botones.forEach((x) => { x.setAttribute('aria-selected', String(x === b)); x.tabIndex = x === b ? 0 : -1; });
      renderTab(dashboard, cont);
    };
    botones.forEach((b, i) => {
      b.addEventListener('click', () => activar(b));
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + botones.length) % botones.length;
        botones[j].focus();
        activar(botones[j]);
      });
    });
  }

  function renderTab(dashboard, cont) {
    const data = ultData[dashboard];
    if (!data) return;
    charts.limpiarGraficos();
    const host = cont.querySelector('[data-tab-content]');
    const t = tab[dashboard];
    const graf = [];
    let html = '';
    if (t === 'resumen') {
      html = `
        ${tiles(['pctAsistencia', 'diasNoPlan', 'fugaH', 'faltasInjust', 'hheeEjecH', 'desviacionHHEEH'], data, dashboard)}
        ${anatomiaHTML(dashboard, data)}
        <div class="rejilla-2">
          ${prioridadesHTML(data)}
          ${panelTendencia(dashboard)}
        </div>`;
    } else if (t === 'asistencia') {
      html = `
        ${lectura(insightsAsistencia(data))}
        ${tiles(['pctAsistencia', 'pctMalla', 'diasNoPlan', 'trabajadoresNoPlan', 'faltasInjust', 'diasSinMarcacion'], data, dashboard)}
        ${panelCalor(dashboard, data)}
        <div class="rejilla-2">${panelGraf(dashboard, 'asistencia', data)}${panelGraf(dashboard, 'noPlan', data)}</div>
        <div class="rejilla-2">${panelGraf(dashboard, 'malla', data)}${panelGraf(dashboard, 'justificaciones', data)}</div>`;
      graf.push('asistencia', 'noPlan', 'malla', 'justificaciones');
    } else if (t === 'marcacion') {
      html = `
        ${lectura(insightsMarcacion(data))}
        ${tiles(['marcacionCompleta', 'marcacionIncompleta', 'diasSinMarcacion', 'marcasManuales', 'excesoRefrigerioDias', 'trabajoEnDescanso'], data, dashboard)}
        ${segmentadaHTML(data)}
        ${panelPuntos(data)}`;
    } else if (t === 'fuga') {
      html = `
        ${lectura(insightsFuga(data))}
        ${tiles(['tardanzasDias', 'pctTardanza', 'personasTardanza', 'salidasAntDias', 'fugaH', 'fugaHporFisc'], data, dashboard)}
        <div class="rejilla-2">${panelGraf(dashboard, 'fuga', data)}${panelGraf(dashboard, 'tardanzas', data)}</div>
        <div class="rejilla-2">${panelGraf(dashboard, 'justHoras', data)}${panelTop10(data)}</div>`;
      graf.push('fuga', 'tardanzas', 'justHoras');
    } else if (t === 'hhee') {
      html = `
        ${lectura(insightsHHEE(data))}
        ${tiles(['hheeEjecH', 'hheeAutH', 'hheeReconH', 'hheeNoReconH', 'pctHHEERecon', 'desviacionHHEEH'], data, dashboard)}
        <div class="rejilla-2">${panelGraf(dashboard, 'hhee', data)}${panelGraf(dashboard, 'brecha', data)}</div>`;
      graf.push('hhee', 'brecha');
    } else if (t === 'controles') {
      html = `
        ${lectura(insightsControles(data))}
        ${tilesControles(data)}
        <div class="rejilla-2">${panelGraf(dashboard, 'ctlFeriado', data)}${panelGraf(dashboard, 'ctlPartTime', data)}</div>
        <div class="rejilla-2">${panelGraf(dashboard, 'ctlFalta', data)}${panelGraf(dashboard, 'ctlMarca', data)}</div>
        ${panelGraf(dashboard, 'ctlPlan', data)}`;
      graf.push('ctlFeriado', 'ctlPartTime', 'ctlFalta', 'ctlMarca', 'ctlPlan');
    } else if (t === 'sucursales') {
      html = panelMatriz(dashboard, data);
    }
    host.innerHTML = html;

    // Montaje de gráficos y eventos.
    graf.forEach((g) => montarGraf(dashboard, cont, g));
    if (t === 'resumen') { montarTendencia(dashboard, cont); montarAnatomia(dashboard, cont); montarPrioridades(dashboard, cont); }
    if (t === 'asistencia') montarCalor(dashboard, cont);
    if (t === 'marcacion') montarSegmentada(dashboard, cont);
    if (t === 'fuga') montarTop10(dashboard, cont);
    if (t === 'sucursales') montarMatriz(dashboard, cont);
    montarTiles(dashboard, cont);
    montarPuntos(dashboard, cont);
    host.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => exportarGrafico(dashboard, b.dataset.export)));
    requestAnimationFrame(() => charts.resizeTodos());
  }

  // ---- Tarjetas (stat tiles) ----------------------------------------------------
  function tiles(keys, data, dashboard) {
    const k = data.kpis;
    const p = data.kpisPrev;
    const serie = data.graficos.tendencia || [];
    return `<div class="tiles">${keys.map((key) => {
      const c = KPI[key];
      const v = k[key];
      const delta = p ? deltaTexto(c, v, p[key]) : '';
      const sp = c.spark && serie.length > 1 ? charts.sparkline(serie.map((x) => x[c.spark]), COLOR[dashboard].dato) : '';
      const estado = c.estado ? `<span class="estado estado-${k.semaforoMalla === 'Cumple' ? 'ok' : k.semaforoMalla === 'En riesgo' ? 'warn' : 'crit'}">${icon(k.semaforoMalla === 'Cumple' ? 'calidad' : 'warning', 'ico-xs')}${k.semaforoMalla}</span>` : '';
      return `<button class="tile" data-drill="${c.drill}" title="${esc(c.tip)} · Clic para ver los trabajadores">
        <span class="tile-lbl">${c.lbl}${help(c.tip, false)}</span>
        <span class="tile-val">${fmtKpi(v, c)}</span>
        ${estado}${delta ? `<span class="tile-delta">${delta}</span>` : ''}
        ${sp ? `<span class="tile-spark">${sp}</span>` : ''}
      </button>`;
    }).join('')}</div>`;
  }
  function montarTiles(dashboard, cont) {
    cont.querySelectorAll('[data-tab-content] .tile[data-drill]').forEach((b) =>
      b.addEventListener('click', () => abrirDrill(dashboard, { metrica: b.dataset.drill })));
  }

  function tilesControles(data) {
    const r = data.controles.resumen;
    const sinTE = !data.nFilasTE;
    return `<div class="tiles tiles-5">${CTL.map((c) => {
      const x = r[c.id];
      const est = c.te && sinTE ? null : x.casos === 0 ? 'ok' : c.estricto ? 'crit' : 'warn';
      const txt = est === null ? 'Sin datos de Tiempo Extra' : est === 'ok' ? 'Sin casos' : c.estricto ? 'No debería haber casos' : 'Revisar';
      const g = GRAF[c.graf];
      return `<button class="tile" data-drill="${c.id}" title="${esc(g.formula)} · Clic para ver los trabajadores">
        <span class="tile-lbl">${c.lbl}${help(g.formula, false)}</span>
        <span class="tile-val">${fmtMiles(x.casos)} <small class="tile-unidad">${c.unidad}</small></span>
        <span class="tile-delta">${fmtMiles(x.personas)} ${x.personas === 1 ? 'persona' : 'personas'} · ${c.extra(x)}</span>
        ${est ? `<span class="estado estado-${est}">${icon(est === 'ok' ? 'calidad' : 'warning', 'ico-xs')}${txt}</span>` : `<span class="estado estado-neutro">${txt}</span>`}
      </button>`;
    }).join('')}</div>`;
  }

  function lectura(items) {
    if (!items || !items.length) return '';
    return `<section class="lectura" aria-label="Lectura rápida"><h2>Lectura rápida</h2><ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul></section>`;
  }

  // ---- Panel de gráfico genérico -------------------------------------------------
  function panelGraf(dashboard, key, data) {
    const g = GRAF[key];
    const arr = g.datos(data) || [];
    const v = vista.get(`${dashboard}:${key}`) || { modo: 'grafico', todas: false };
    const largo = arr.length > TOP;
    const vacio = !arr.length;
    return `<section class="panel" data-graf="${key}">
      <header class="panel-head">
        <div>
          <h3>${g.titulo}${help(g.formula)}</h3>
          <p class="panel-sub">${g.sub}${vacio ? '' : ' · clic en una barra para ver a los trabajadores'}</p>
        </div>
        ${vacio ? '' : `<div class="panel-acc">
          <div class="segment segment-sm" role="group" aria-label="Forma de ver">
            <button type="button" data-modo="grafico" aria-pressed="${v.modo === 'grafico'}" class="${v.modo === 'grafico' ? 'activo' : ''}" title="Ver como gráfico">${icon('barras')}<span class="sr">Gráfico</span></button>
            <button type="button" data-modo="tabla" aria-pressed="${v.modo === 'tabla'}" class="${v.modo === 'tabla' ? 'activo' : ''}" title="Ver como tabla">${icon('tabla')}<span class="sr">Tabla</span></button>
          </div>
          <button type="button" class="btn-icono" data-export="${key}" title="Descargar Excel: datos del gráfico, trabajadores y sus días">${icon('download')}<span class="sr">Descargar Excel</span></button>
        </div>`}
      </header>
      ${vacio ? `<p class="vacio">${g.vacio || 'Sin casos en el filtro actual.'}</p>` : `
        <div class="chart" id="${cid(dashboard, key)}" ${v.modo === 'tabla' ? 'hidden' : ''}></div>
        <div class="tabla-twin" ${v.modo === 'tabla' ? '' : 'hidden'}></div>
        ${largo ? `<button type="button" class="btn-link mas-filas" data-todas>${v.todas ? `Ver solo las ${TOP} primeras` : `Ver las ${fmtMiles(arr.length)} sucursales`}</button>` : ''}`}
    </section>`;
  }

  function montarGraf(dashboard, cont, key) {
    const g = GRAF[key];
    const data = ultData[dashboard];
    const panel = cont.querySelector(`[data-graf="${key}"]`);
    if (!panel) return;
    const todos = g.datos(data) || [];
    if (!todos.length) return;
    const st = vista.get(`${dashboard}:${key}`) || { modo: 'grafico', todas: false };
    vista.set(`${dashboard}:${key}`, st);
    const arr = st.todas ? todos : todos.slice(0, TOP);
    const id = cid(dashboard, key);
    const color = COLOR[dashboard].dato;
    const drill = (suc, serieKey) => {
      const serie = g.series && g.series.find((s) => s.key === serieKey);
      abrirDrill(dashboard, { metrica: (serie && serie.metrica) || g.metrica, sucursal: suc });
    };
    if (st.modo === 'grafico') {
      if (g.tipo === 'barras') charts.barras(id, { datos: arr, color, ...g.opts, onClick: (s) => drill(s) });
      else if (g.tipo === 'apiladas') charts.apiladas(id, { datos: arr, series: g.series, sufijo: g.sufijo, decimales: g.decimales, onClick: drill });
      else if (g.tipo === 'agrupadas') charts.agrupadas(id, { datos: arr, series: g.series, sufijo: g.sufijo, decimales: g.decimales, onClick: drill });
      else if (g.tipo === 'divergentes') charts.divergentes(id, { datos: arr, sufijo: g.sufijo, onClick: (s) => drill(s) });
    }
    // Tabla gemela (accesible por teclado; clic o Enter abre los trabajadores).
    const twin = panel.querySelector('.tabla-twin');
    twin.innerHTML = tablaHTML(g.cols, arr, 'sucursal');
    twin.querySelectorAll('tr[data-fila]').forEach((tr) => {
      const go = () => drill(tr.dataset.fila);
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    panel.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
      st.modo = b.dataset.modo;
      const sec = panel;
      sec.querySelectorAll('[data-modo]').forEach((x) => { const on = x.dataset.modo === st.modo; x.classList.toggle('activo', on); x.setAttribute('aria-pressed', String(on)); });
      sec.querySelector('.chart').hidden = st.modo !== 'grafico';
      twin.hidden = st.modo !== 'tabla';
      if (st.modo === 'grafico') montarGraf(dashboard, cont, key);
    }));
    const mas = panel.querySelector('[data-todas]');
    if (mas && !mas._ok) {
      mas._ok = true;
      mas.addEventListener('click', () => {
        st.todas = !st.todas;
        mas.textContent = st.todas ? `Ver solo las ${TOP} primeras` : `Ver las ${fmtMiles(todos.length)} sucursales`;
        montarGraf(dashboard, cont, key);
      });
    }
  }

  // ---- Tendencia -----------------------------------------------------------------
  function panelTendencia(dashboard) {
    const c = tendCampo[dashboard];
    return `<section class="panel" data-tendencia>
      <header class="panel-head">
        <div><h3>Evolución${help('Serie por día, semana o mes según "Ver por". Una métrica a la vez: cada una tiene su propia escala.')}</h3>
        <p class="panel-sub">Clic en un punto para ver a los trabajadores de ese período</p></div>
      </header>
      <div class="segment segment-sm segment-wrap" role="group" aria-label="Métrica">
        ${TEND.map((m) => `<button type="button" data-tcampo="${m.campo}" class="${c === m.campo ? 'activo' : ''}" aria-pressed="${c === m.campo}">${m.nombre}</button>`).join('')}
      </div>
      <div class="chart" id="${cid(dashboard, 'tend')}"></div>
    </section>`;
  }
  function montarTendencia(dashboard, cont) {
    const data = ultData[dashboard];
    const serie = data.graficos.tendencia || [];
    const panel = cont.querySelector('[data-tendencia]');
    if (!panel) return;
    const pintar = () => {
      const m = TEND.find((x) => x.campo === tendCampo[dashboard]);
      if (serie.length < 2) {
        panel.querySelector('.chart').outerHTML = `<p class="vacio">Hace falta más de un ${estado[dashboard].granularidad === 'dia' ? 'día' : estado[dashboard].granularidad} de datos para ver una evolución.</p>`;
        return;
      }
      charts.linea(cid(dashboard, 'tend'), {
        serie, campo: m.campo, nombre: m.nombre, sufijo: m.sufijo, decimales: m.dec, color: COLOR[dashboard].dato,
        onClick: (clave) => abrirDrill(dashboard, { metrica: m.metrica, periodo: clave, granularidad: estado[dashboard].granularidad }),
      });
    };
    panel.querySelectorAll('[data-tcampo]').forEach((b) => b.addEventListener('click', () => {
      tendCampo[dashboard] = b.dataset.tcampo;
      panel.querySelectorAll('[data-tcampo]').forEach((x) => { const on = x === b; x.classList.toggle('activo', on); x.setAttribute('aria-pressed', String(on)); });
      pintar();
    }));
    pintar();
  }

  // ---- Malla de calor ----------------------------------------------------------------
  function panelCalor(dashboard, data) {
    const c = calorCampo[dashboard];
    const m = CALOR.find((x) => x.campo === c);
    const malla = data.graficos.malla_calor;
    const vacio = !malla || !malla.celdas.length;
    return `<section class="panel" data-calor>
      <header class="panel-head">
        <div><h3>La malla: sucursal por ${estado[dashboard].granularidad === 'dia' ? 'día' : estado[dashboard].granularidad}${help('Cada celda es una sucursal en un período. ' + m.ayuda)}</h3>
        <p class="panel-sub">Más oscuro = más casos · clic en una celda para ver a los trabajadores de ese día</p></div>
      </header>
      <div class="segment segment-sm segment-wrap" role="group" aria-label="Métrica de la malla">
        ${CALOR.map((x) => `<button type="button" data-ccampo="${x.campo}" class="${c === x.campo ? 'activo' : ''}" aria-pressed="${c === x.campo}">${x.nombre}</button>`).join('')}
      </div>
      ${vacio ? '<p class="vacio">Sin datos de asistencia en el filtro.</p>' : `<div class="chart chart-scroll-x"><div id="${cid(dashboard, 'calor')}" style="min-width:${Math.max(600, malla.periodos.length * 34 + 200)}px"></div></div>`}
    </section>`;
  }
  function montarCalor(dashboard, cont) {
    const data = ultData[dashboard];
    const panel = cont.querySelector('[data-calor]');
    if (!panel || !document.getElementById(cid(dashboard, 'calor'))) return;
    const pintar = () => {
      const m = CALOR.find((x) => x.campo === calorCampo[dashboard]);
      charts.calor(cid(dashboard, 'calor'), {
        malla: data.graficos.malla_calor, campo: m.campo, nombre: m.nombre, sufijo: m.sufijo,
        onClick: (suc, clave) => abrirDrill(dashboard, { metrica: m.metrica, sucursal: suc, periodo: clave, granularidad: estado[dashboard].granularidad }),
      });
    };
    panel.querySelectorAll('[data-ccampo]').forEach((b) => b.addEventListener('click', () => {
      calorCampo[dashboard] = b.dataset.ccampo;
      panel.querySelectorAll('[data-ccampo]').forEach((x) => { const on = x === b; x.classList.toggle('activo', on); x.setAttribute('aria-pressed', String(on)); });
      pintar();
    }));
    pintar();
  }

  // ---- Anatomía de la jornada (las cuatro marcas del reloj) ------------------
  // Se dibuja sobre el turno típico o sobre una malla horaria concreta: los
  // horarios (inicio–fin + refrigerio) que se repiten en la sucursal.
  function anatomiaHTML(dashboard, data) {
    const sucs = data.porSucursal.map((s) => s.sucursal);
    if (anatSuc[dashboard] && !sucs.includes(anatSuc[dashboard])) anatSuc[dashboard] = '';
    return `<section class="panel anatomia" data-anatomia>
      <header class="panel-head">
        <div><h3>Anatomía de la jornada${help('Sin malla elegida se dibuja el turno típico (mediana de inicio, fin y refrigerio de los turnos programados). Con una malla horaria se dibuja ese horario exacto y solo sus días. En rojo, los minutos promedio que se pierden en cada marca del reloj, en los días en que ocurre.')}</h3>
        <p class="panel-sub">Dónde se pierden los minutos en las cuatro marcas del reloj · clic en una marca para ver a los trabajadores</p></div>
        <div class="anat-sels">
          <label class="anat-sel"><span class="flbl">Sucursal</span>
            <select data-anat-suc><option value="">Todas</option>${sucs.map((s) => `<option value="${esc(s)}" ${anatSuc[dashboard] === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
          </label>
          <label class="anat-sel"><span class="flbl">Malla horaria${help('Cada malla es un horario que se repite: hora de inicio, hora de fin y minutos de refrigerio del turno programado.')}</span>
            <select data-anat-malla></select>
          </label>
        </div>
      </header>
      <div class="anat-cuerpo" data-anat-cuerpo></div>
      <div class="mallas" data-mallas></div>
    </section>`;
  }

  function montarAnatomia(dashboard, cont) {
    const selSuc = cont.querySelector('[data-anat-suc]');
    const selMalla = cont.querySelector('[data-anat-malla]');
    if (!selSuc) return;
    const alcance = () => {
      const data = ultData[dashboard];
      return (anatSuc[dashboard] ? data.anatomia.porSucursal[anatSuc[dashboard]] : data.anatomia.global) || null;
    };
    const pintarSelector = () => {
      const a = alcance();
      const mallas = (a && a.mallas) || [];
      if (anatMalla[dashboard] && !mallas.some((m) => m.id === anatMalla[dashboard])) anatMalla[dashboard] = '';
      selMalla.innerHTML = `<option value="">Turno típico (${fmtMiles(mallas.length)} ${mallas.length === 1 ? 'malla' : 'mallas'})</option>`
        + mallas.map((m) => `<option value="${esc(m.id)}" ${anatMalla[dashboard] === m.id ? 'selected' : ''}>${m.etiqueta} · refr. ${fmtMiles(m.refrigerio)} min · ${fmtMiles(m.dias)} días</option>`).join('');
      selMalla.disabled = !mallas.length;
    };
    const pintar = () => {
      const a = alcance();
      const malla = a && anatMalla[dashboard] ? a.mallas.find((m) => m.id === anatMalla[dashboard]) : null;
      const vistaA = malla ? { turno: { inicio: malla.inicio, fin: malla.fin, refrigerio: malla.refrigerio, n: malla.dias }, puntos: malla.puntos } : a;
      const cuerpo = cont.querySelector('[data-anat-cuerpo]');
      cuerpo.innerHTML = anatomiaSVG(vistaA, malla, anatSuc[dashboard]);
      cuerpo.querySelectorAll('[data-marca]').forEach((g) => {
        const go = () => abrirDrill(dashboard, { metrica: g.dataset.marca, sucursal: anatSuc[dashboard] || undefined, malla: anatMalla[dashboard] || undefined });
        g.addEventListener('click', go);
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      });
      const verMalla = cuerpo.querySelector('[data-ver-malla]');
      if (verMalla) verMalla.addEventListener('click', () => abrirDrill(dashboard, { metrica: 'personas', sucursal: anatSuc[dashboard] || undefined, malla: anatMalla[dashboard] }));
      pintarListaMallas(a ? a.mallas : []);
    };
    // Lista visual de mallas sobre un eje horario común: clic = elegir malla.
    const pintarListaMallas = (mallas) => {
      const host = cont.querySelector('[data-mallas]');
      if (!mallas.length) { host.innerHTML = ''; return; }
      const todas = anatMallaTodas[dashboard];
      const MAX = 6;
      const vis = todas ? mallas : mallas.slice(0, MAX);
      const t0 = Math.floor(Math.min(...mallas.map((m) => m.inicio)) / 60) * 60;
      const t1 = Math.ceil(Math.max(...mallas.map((m) => m.fin)) / 60) * 60;
      const span = Math.max(60, t1 - t0);
      const pct = (m) => (((m - t0) / span) * 100).toFixed(2);
      const paso = span > 16 * 60 ? 240 : span > 8 * 60 ? 120 : 60;
      const ticks = [];
      for (let t = t0; t <= t1; t += paso) ticks.push(t);
      const maxFuga = Math.max(1, ...mallas.map((m) => m.fugaMin / Math.max(1, m.dias)));
      const fila = (m) => {
        const trabajo = m.fin - m.inicio - m.refrigerio;
        const r0 = m.inicio + Math.round(trabajo / 2);
        const r1 = r0 + m.refrigerio;
        const activa = anatMalla[dashboard] === m.id;
        const fugaDia = m.fugaMin / Math.max(1, m.dias);
        return `<button type="button" class="malla-fila ${activa ? 'activa' : ''}" data-malla="${esc(m.id)}" aria-pressed="${activa}"
            aria-label="Malla ${m.etiqueta}, refrigerio ${m.refrigerio} minutos, ${m.dias} días, ${m.personas} personas. Ver en la anatomía.">
          <span class="malla-hora"><b>${m.etiqueta}</b><small>${fmtDec1(m.horas)} h · refr. ${fmtMiles(m.refrigerio)} min</small></span>
          <span class="malla-eje" aria-hidden="true">
            <span class="malla-bloque" style="left:${pct(m.inicio)}%;width:${(pct(r0) - pct(m.inicio)).toFixed(2)}%"></span>
            ${m.refrigerio ? `<span class="malla-refri" style="left:${pct(r0)}%;width:${(pct(r1) - pct(r0)).toFixed(2)}%"></span>` : ''}
            <span class="malla-bloque" style="left:${pct(r1)}%;width:${(pct(m.fin) - pct(r1)).toFixed(2)}%"></span>
          </span>
          <span class="malla-num"><b>${fmtMiles(m.dias)}</b> días<small>${fmtPct(m.pctDias)} · ${fmtMiles(m.personas)} pers.</small></span>
          <span class="malla-num malla-fuga"><b>${fmtDec1(fugaDia)}</b> min/día<small>fuga · ${fmtPct(m.pctTardanza)} tard.</small>
            <span class="malla-medidor" aria-hidden="true"><span style="width:${((fugaDia / maxFuga) * 100).toFixed(1)}%"></span></span></span>
        </button>`;
      };
      host.innerHTML = `
        <div class="mallas-head">
          <h4>Mallas horarias ${anatSuc[dashboard] ? `de ${esc(anatSuc[dashboard])}` : 'del filtro'}</h4>
          <span class="nota">${fmtMiles(mallas.length)} ${mallas.length === 1 ? 'horario distinto' : 'horarios distintos'}, de la más usada a la menos · clic para verla en la jornada</span>
        </div>
        <div class="malla-reglas" aria-hidden="true"><span></span><span class="malla-eje malla-eje-reglas">${ticks.map((t) => `<i style="left:${pct(t)}%">${hhmm(t)}</i>`).join('')}</span><span></span><span></span></div>
        <div class="malla-lista">${vis.map(fila).join('')}</div>
        ${mallas.length > MAX ? `<button type="button" class="btn-link mas-filas" data-mallas-todas>${todas ? `Ver solo las ${MAX} más usadas` : `Ver las ${fmtMiles(mallas.length)} mallas`}</button>` : ''}`;
      host.querySelectorAll('[data-malla]').forEach((b) => b.addEventListener('click', () => {
        anatMalla[dashboard] = anatMalla[dashboard] === b.dataset.malla ? '' : b.dataset.malla;
        pintarSelector();
        pintar();
        const nb = cont.querySelector(`[data-malla="${CSS.escape(b.dataset.malla)}"]`);
        if (nb) nb.focus();
      }));
      const t = host.querySelector('[data-mallas-todas]');
      if (t) t.addEventListener('click', () => { anatMallaTodas[dashboard] = !todas; pintarListaMallas(mallas); });
    };
    selSuc.addEventListener('change', () => { anatSuc[dashboard] = selSuc.value; anatMalla[dashboard] = ''; pintarSelector(); pintar(); });
    selMalla.addEventListener('change', () => { anatMalla[dashboard] = selMalla.value; pintar(); });
    pintarSelector();
    pintar();
  }

  function anatomiaSVG(a, malla = null, suc = '') {
    if (!a || !a.turno) return '<p class="vacio">No hay turnos programados en el filtro para dibujar la jornada.</p>';
    const { inicio, fin, refrigerio } = a.turno;
    const P = Object.fromEntries(a.puntos.map((p) => [p.id, p]));
    const t0 = inicio - 45;
    const t1 = fin + 45;
    const W = 1000;
    const x = (m) => 40 + ((m - t0) / (t1 - t0)) * (W - 80);
    const trabajo = fin - inicio - refrigerio;
    const r0 = inicio + Math.round(trabajo / 2); // salida a refrigerio
    const r1 = r0 + refrigerio; // retorno
    const yb = 96; // eje de la barra
    const h = 26;
    const marcas = [
      { id: 'E1', t: inicio, lado: 1, nombre: 'Ingreso' },
      { id: 'S1', t: r0, lado: -1, nombre: 'Sale a refrigerio' },
      { id: 'E2', t: r1, lado: 1, nombre: 'Vuelve de refrigerio' },
      { id: 'S2', t: fin, lado: -1, nombre: 'Salida' },
    ];
    const maxProm = Math.max(1, ...a.puntos.map((p) => p.promedio));
    const peor = [...a.puntos].sort((p, q) => q.minTotales - p.minTotales)[0];
    const fuga = a.puntos.reduce((s, p) => s + p.minTotales, 0);
    const bloques = `
      <rect x="${x(inicio)}" y="${yb - h / 2}" width="${x(r0) - x(inicio)}" height="${h}" rx="3" class="an-turno"/>
      <rect x="${x(r0)}" y="${yb - h / 2 + 8}" width="${x(r1) - x(r0)}" height="${h - 16}" rx="2" class="an-refri"/>
      <rect x="${x(r1)}" y="${yb - h / 2}" width="${x(fin) - x(r1)}" height="${h}" rx="3" class="an-turno"/>`;
    const marcasSVG = marcas.map((mk) => {
      const p = P[mk.id];
      const px = x(mk.t);
      // La fuga se dibuja hacia dentro del tramo de trabajo (después del ingreso, antes de la salida).
      const ancho = p.dias ? Math.max(5, x(mk.t + p.promedio) - x(mk.t)) : 0;
      const fx = mk.lado === 1 ? px : px - ancho;
      const arriba = mk.id === 'E1' || mk.id === 'E2';
      const ty = arriba ? 30 : 150;
      const intensidad = p.promedio / maxProm;
      return `<g class="an-marca ${p.dias ? '' : 'an-cero'}" data-marca="${mk.id}" role="button" tabindex="0"
          aria-label="${mk.id}, ${mk.nombre}: ${fmtMiles(p.dias)} días, ${fmtDec1(p.promedio)} minutos en promedio, ${fmtHoras(p.minTotales / 60)} horas en total. Ver trabajadores.">
        <rect x="${px - 40}" y="12" width="80" height="166" fill="transparent"/>
        <line x1="${px}" y1="${yb - h / 2 - 8}" x2="${px}" y2="${yb + h / 2 + 8}" class="an-tick"/>
        ${ancho ? `<rect x="${fx}" y="${yb - h / 2}" width="${ancho}" height="${h}" class="an-fuga" style="opacity:${(0.55 + 0.45 * intensidad).toFixed(2)}"/>` : ''}
        <text x="${px}" y="${ty}" text-anchor="middle" class="an-id">${mk.id} · ${mk.nombre}</text>
        <text x="${px}" y="${ty + 18}" text-anchor="middle" class="an-dato">${p.dias ? `${fmtDec1(p.promedio)} min prom. · ${fmtMiles(p.dias)} días` : 'sin casos'}</text>
      </g>`;
    }).join('');
    const horas = [inicio, r0, r1, fin].map((m) => `<text x="${x(m)}" y="${yb + h / 2 + 24}" text-anchor="middle" class="an-hora">${hhmm(m)}</text>`).join('');
    const frase = peor && peor.minTotales
      ? `La mayor fuga está en <b>${peor.id} · ${peor.nombre.toLowerCase()}</b>: ${fmtHoras(peor.minTotales / 60)} h en ${fmtMiles(peor.dias)} días (${fmtMiles(peor.personas)} personas), ${fmtPct(fuga ? (peor.minTotales / fuga) * 100 : 0)} de los minutos perdidos en las cuatro marcas.`
      : 'No hay minutos perdidos en las marcas del reloj en este filtro.';
    return `<div class="an-scroll"><svg class="an-svg" viewBox="0 0 ${W} 180" role="img" aria-label="Turno típico de ${hhmm(inicio)} a ${hhmm(fin)} con ${refrigerio} minutos de refrigerio">
        ${bloques}${horas}${marcasSVG}
      </svg></div>
      <p class="an-frase">${frase} <span class="nota">${malla
        ? `Malla ${malla.etiqueta}, refrigerio de ${fmtMiles(refrigerio)} min: ${fmtMiles(malla.dias)} días de ${fmtMiles(malla.personas)} personas (${fmtPct(malla.pctDias)} de los días con turno${suc ? ' de la sucursal' : ''}). <button type="button" class="btn-link" data-ver-malla>Ver a las ${fmtMiles(malla.personas)} personas de esta malla</button>`
        : `Turno típico ${hhmm(inicio)}–${hhmm(fin)}, refrigerio de ${fmtMiles(refrigerio)} min (mediana de ${fmtMiles(a.turno.n)} turnos). Elige una malla horaria para ver un horario concreto.`}</span></p>`;
  }

  // ---- Prioridades -------------------------------------------------------------------
  function prioridadesHTML(data) {
    const d = data.diagnostico || {};
    const filas = [
      d.fuga && { area: 'Fuga de tiempo', suc: d.fuga.sucursal, cifra: `${fmtHoras(d.fuga.horas)} h`, det: `${fmtMiles(d.fuga.trabajadores)} personas con tardanzas`, accion: 'Revisar las marcaciones de salida y el cierre de turnos.', metrica: 'fuga' },
      d.hhee && { area: 'Horas extra', suc: d.hhee.sucursal, cifra: `${fmtHoras(d.hhee.desviacion)} h`, det: 'Se trabajó más de lo aprobado', accion: 'Regularizar el sobretiempo que supera lo aprobado.', metrica: 'desviacion' },
      d.planificacion && { area: 'Planificación', suc: d.planificacion.sucursal, cifra: `${fmtMiles(d.planificacion.dias)} días`, det: `${fmtMiles(d.planificacion.trabajadores)} personas trabajaron sin turno`, accion: 'Asignar turno en la malla a estas personas.', metrica: 'noPlan' },
    ].filter(Boolean);
    return `<section class="panel" data-prioridades>
      <header class="panel-head"><div><h3>Qué revisar primero${help('La sucursal con más fuga de tiempo, la de mayor brecha de horas extra y la de más días no planificados en el filtro.')}</h3>
      <p class="panel-sub">Las tres desviaciones más grandes del período</p></div></header>
      ${filas.length ? `<ul class="prioridades">${filas.map((f) => `
        <li>
          <span class="prio-area">${f.area}</span>
          <span class="prio-suc">${esc(f.suc)}</span>
          <span class="prio-cifra">${f.cifra}</span>
          <span class="prio-det">${f.det}. ${f.accion}</span>
          <button type="button" class="btn-link" data-prio="${f.metrica}" data-suc="${esc(f.suc)}">Ver trabajadores ${icon('flecha', 'ico-xs')}</button>
        </li>`).join('')}</ul>` : '<p class="vacio">No hay desviaciones que destacar en el filtro.</p>'}
    </section>`;
  }
  function montarPrioridades(dashboard, cont) {
    cont.querySelectorAll('[data-prio]').forEach((b) => b.addEventListener('click', () => abrirDrill(dashboard, { metrica: b.dataset.prio, sucursal: b.dataset.suc })));
  }

  // ---- Calidad de marcación (barra segmentada) -----------------------------------
  function segmentadaHTML(data) {
    const m = data.graficos.marcacion;
    const partes = [
      { key: 'completa', nombre: 'Completa', color: T.ok, txt: '#fff', drill: 'marcCompleta' },
      { key: 'incompleta', nombre: 'Incompleta', color: T.warn, txt: '#14181b', drill: 'marcIncompleta' },
      { key: 'sinMarcacion', nombre: 'Sin marcación', color: T.serio, txt: '#14181b', drill: 'sinMarcacion' },
      { key: 'faltaInjust', nombre: 'Falta injustificada', color: T.critico, txt: '#fff', drill: 'faltas' },
    ];
    const total = partes.reduce((s, p) => s + m[p.key], 0);
    if (!total) return '<section class="panel"><p class="vacio">Sin días con turno en el filtro.</p></section>';
    return `<section class="panel" data-segmentada>
      <header class="panel-head"><div><h3>Calidad de marcación${help('Días con turno según su marcación: completa, incompleta, sin marcación o falta injustificada.')}</h3>
      <p class="panel-sub">${fmtMiles(total)} días · clic en un tramo para ver a los trabajadores</p></div></header>
      <div class="segbar" role="group" aria-label="Calidad de marcación">
        ${partes.filter((p) => m[p.key] > 0).map((p) => {
          const pct = (m[p.key] / total) * 100;
          return `<button type="button" class="seg" data-drill="${p.drill}" style="flex:${m[p.key]};background:${p.color};color:${p.txt}"
            aria-label="${p.nombre}: ${fmtMiles(m[p.key])} días, ${fmtPct(pct)}. Ver trabajadores." title="${p.nombre}: ${fmtMiles(m[p.key])} días (${fmtPct(pct)})">
            ${pct >= 9 ? `<span>${fmtPct(pct)}</span>` : ''}</button>`;
        }).join('')}
      </div>
      <ul class="leyenda">${partes.map((p) => `<li><span class="sw" style="background:${p.color}"></span>${p.nombre} <b>${fmtMiles(m[p.key])}</b></li>`).join('')}</ul>
    </section>`;
  }
  function montarSegmentada(dashboard, cont) {
    cont.querySelectorAll('[data-segmentada] .seg').forEach((b) => b.addEventListener('click', () => abrirDrill(dashboard, { metrica: b.dataset.drill })));
  }

  // ---- Puntos de marcación (tabla) ----------------------------------------------
  function panelPuntos(data) {
    const filas = data.puntos || [];
    return `<section class="panel" data-puntos>
      <header class="panel-head"><div><h3>Las cuatro marcas del reloj${help('Por marca: días con minutos > 0, % sobre días presentes, minutos totales, promedio por día y máximo.')}</h3>
      <p class="panel-sub">Clic en una fila para ver a los trabajadores</p></div></header>
      <div class="tabla-scroll"><table class="tabla">
        <thead><tr><th>Marca</th><th class="num">Días</th><th class="num">Personas</th><th class="num">% de presentes</th><th class="num">Min. totales</th><th class="num">Promedio</th><th class="num">Máximo</th></tr></thead>
        <tbody>${filas.map((p) => `<tr data-punto="${p.id}" tabindex="0">
          <td>${esc(p.punto)}</td><td class="num">${fmtMiles(p.dias)}</td><td class="num">${fmtMiles(p.personas)}</td><td class="num">${fmtPct(p.pctPresentes)}</td>
          <td class="num">${fmtMiles(p.minTotales)}</td><td class="num">${fmtDec1(p.promedio)}</td><td class="num">${fmtMiles(p.maximo)}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>`;
  }
  function montarPuntos(dashboard, cont) {
    cont.querySelectorAll('[data-tab-content] tr[data-punto]').forEach((tr) => {
      const go = () => abrirDrill(dashboard, { metrica: tr.dataset.punto });
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }

  // ---- Top 10 por fuga -----------------------------------------------------------
  function panelTop10(data) {
    const filas = data.topColaboradores || [];
    return `<section class="panel" data-top10>
      <header class="panel-head"><div><h3>Las 10 personas con más fuga${help('Personas ordenadas por Σ (atraso E1 + adelanto S2) en el filtro.')}</h3>
      <p class="panel-sub">Clic en una persona para ver sus días</p></div></header>
      ${filas.length ? `<div class="tabla-scroll"><table class="tabla">
        <thead><tr><th>Persona</th><th>Sucursal</th><th class="num">Tardanzas</th><th class="num">Fuga</th></tr></thead>
        <tbody>${filas.map((p) => `<tr data-persona="${esc(p.keyId)}" tabindex="0">
          <td><b>${esc(p.nombre)}</b><small>${esc(p.keyId)} · ${esc(p.cargo || '')}</small></td><td>${esc(p.sucursal)}</td>
          <td class="num">${fmtMiles(p.tardanzas)}</td><td class="num"><b>${fmtHoras(p.fugaH)} h</b></td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="vacio">Nadie registra fuga de tiempo en el filtro.</p>'}
    </section>`;
  }
  function montarTop10(dashboard, cont) {
    cont.querySelectorAll('tr[data-persona]').forEach((tr) => {
      const go = () => abrirDrill(dashboard, { metrica: 'fuga', keyId: tr.dataset.persona });
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }

  // ---- Matriz por sucursal ---------------------------------------------------------
  const ORDEN = [
    ['fugaH', 'Fuga de tiempo', -1], ['pctAsistencia', 'Asistencia (menor primero)', 1], ['diasNoPlan', 'Días no planificados', -1],
    ['hheeEjecH', 'HHEE ejecutadas', -1], ['desviacionHHEEH', 'Brecha de HHEE (mayor sobre-ejecución)', 1], ['personas', 'Personas', -1], ['sucursal', 'Nombre', 1],
  ];
  function panelMatriz(dashboard) {
    return `<section class="panel" data-matriz>
      <header class="panel-head">
        <div><h3>Resultado por sucursal${help('Una fila por sucursal con asistencia, planificación, fuga y horas extra. La última fila es el total del filtro.')}</h3>
        <p class="panel-sub">Clic o Enter en una sucursal para ver a todos sus trabajadores</p></div>
        <div class="panel-acc">
          <button type="button" class="btn-sec" data-mexp="csv">${icon('download')}<span>CSV</span></button>
          <button type="button" class="btn" data-mexp="excel">${icon('download')}<span>Excel</span></button>
        </div>
      </header>
      <div class="herramientas">
        <label class="busqueda">${icon('search')}<input type="search" class="input" placeholder="Buscar sucursal" aria-label="Buscar sucursal" data-mbuscar /></label>
        <label class="fgrupo-inline"><span class="flbl">Ordenar por</span>
          <select data-morden>${ORDEN.map(([k, l]) => `<option value="${k}" ${ordenSuc[dashboard] === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div data-mtabla></div>
    </section>`;
  }
  function montarMatriz(dashboard, cont) {
    const data = ultData[dashboard];
    const panel = cont.querySelector('[data-matriz]');
    const pintar = () => {
      const q = (panel.querySelector('[data-mbuscar]').value || '').toLowerCase();
      const [campo, , dir] = ORDEN.find((o) => o[0] === ordenSuc[dashboard]);
      const filas = data.porSucursal.filter((s) => s.sucursal.toLowerCase().includes(q))
        .sort((a, b) => (campo === 'sucursal' ? a.sucursal.localeCompare(b.sucursal) : (a[campo] - b[campo]) * dir));
      panel.querySelector('[data-mtabla]').innerHTML = matrizHTML(filas, data.kpis);
      panel.querySelectorAll('tr[data-suc]').forEach((tr) => {
        const go = () => abrirDrill(dashboard, { metrica: 'personas', sucursal: tr.dataset.suc });
        tr.addEventListener('click', go);
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      });
    };
    panel.querySelector('[data-mbuscar]').addEventListener('input', pintar);
    panel.querySelector('[data-morden]').addEventListener('change', (e) => { ordenSuc[dashboard] = e.target.value; pintar(); });
    panel.querySelectorAll('[data-mexp]').forEach((b) => b.addEventListener('click', () => exportarMatriz(dashboard, b.dataset.mexp)));
    pintar();
  }
  function matrizHTML(filas, k) {
    const cls = (v, a, b, inv) => {
      if (typeof v !== 'number') return '';
      if (inv) return v <= a ? 'cel-ok' : v <= b ? 'cel-warn' : 'cel-crit';
      return v >= a ? 'cel-ok' : v >= b ? 'cel-warn' : 'cel-crit';
    };
    const fila = (s) => `<tr data-suc="${esc(s.sucursal)}" tabindex="0">
      <td><b>${esc(s.sucursal)}</b>${s.personas < 10 ? '<small>Menos de 10 personas</small>' : ''}</td>
      <td class="num">${fmtMiles(s.personas)}</td>
      <td class="num ${cls(s.pctAsistencia, 95, 90)}"><b>${fmtPct(s.pctAsistencia)}</b><small>${fmtMiles(s.sumPresente)} de ${fmtMiles(s.sumDiaEsperado)} días</small></td>
      <td class="num"><b>${fmtMiles(s.diasNoPlan)} d</b><small>${fmtMiles(s.trabajadoresNoPlan)} personas</small></td>
      <td class="num"><b>${fmtHoras(s.fugaH)} h</b><small>${fmtHoras(s.tardanzaH)} tard. + ${fmtHoras(s.salidaAntH)} sal.</small></td>
      <td class="num"><b>${fmtHoras(s.hheeEjecH)} h</b><small>${fmtHoras(s.hheeAutH)} aprob. · ${fmtHoras(s.hheeReconH)} recon.</small></td>
      <td class="num ${s.desviacionHHEEH < 0 ? 'cel-crit' : ''}"><b>${fmtHoras(s.desviacionHHEEH)} h</b><small>${fmtPct(s.pctDesviacionHHEE)}</small></td>
    </tr>`;
    return `<div class="tabla-scroll tabla-alta"><table class="tabla tabla-matriz">
      <thead><tr><th>Sucursal</th><th class="num">Personas</th><th class="num">Asistencia</th><th class="num">No planificados</th><th class="num">Fuga</th><th class="num">Horas extra</th><th class="num">Brecha HHEE</th></tr></thead>
      <tbody>${filas.map(fila).join('') || '<tr><td colspan="7" class="vacio">Sin coincidencias.</td></tr>'}</tbody>
      <tfoot><tr><td><b>Total del filtro</b></td><td class="num"><b>${fmtMiles(k.personas)}</b></td><td class="num"><b>${fmtPct(k.pctAsistencia)}</b></td>
        <td class="num"><b>${fmtMiles(k.diasNoPlan)} d</b></td><td class="num"><b>${fmtHoras(k.fugaH)} h</b></td><td class="num"><b>${fmtHoras(k.hheeEjecH)} h</b></td>
        <td class="num"><b>${fmtHoras(k.desviacionHHEEH)} h</b><small>${fmtPct(k.pctDesviacionHHEE)}</small></td></tr></tfoot>
    </table></div>`;
  }

  // ---- Panel de trabajadores (drill-down) ----------------------------------------
  async function abrirDrill(dashboard, sel) {
    const cont = contenedor(dashboard);
    const capa = cont.querySelector('[data-drawer]');
    const anterior = document.activeElement;
    capa.hidden = false;
    capa.innerHTML = `<aside class="drawer" role="dialog" aria-modal="true" aria-label="Trabajadores"><p class="vacio">Buscando a los trabajadores…</p></aside>`;
    const res = await callWorker('drill', { filtros: estado[dashboard], sel, cfg: getCfg() });
    drawerEstado = { dashboard, sel, res, orden: null, q: '', anterior };
    pintarDrawer();
  }

  function columnasDrill(res) {
    const m = res.sel.metrica;
    const id = [['nombre', 'Persona', 'persona'], ['sucursal', 'Sucursal', 'txt'], ['jefe', 'Jefe', 'txt']];
    const ev = [['eventos', res.evento, 'int']];
    const h = (k, l) => [k, l, 'h'];
    const set = {
      personas: [['diasEsperados', 'Días esp.', 'int'], ['pctAsistencia', 'Asistencia', 'pct'], ['tardanzas', 'Tardanzas', 'int'], h('fugaH', 'Fuga'), h('hheeEjecH', 'HHEE')],
      asistencia: [['diasEsperados', 'Días esp.', 'int'], ['presentes', 'Presentes', 'int'], ['pctAsistencia', 'Asistencia', 'pct'], ['faltas', 'Faltas', 'int'], ['sinMarcacion', 'Sin marc.', 'int']],
      tardanzas: [...ev, ['minEvento', 'Min. de atraso', 'int'], h('fugaH', 'Fuga total')],
      salidas: [...ev, ['minEvento', 'Min. de adelanto', 'int'], h('fugaH', 'Fuga total')],
      fuga: [['tardanzas', 'Tardanzas', 'int'], ['minTardanza', 'Min. tard.', 'int'], ['salidas', 'Salidas', 'int'], ['minSalida', 'Min. sal.', 'int'], h('fugaH', 'Fuga')],
      hhee: [h('hheeEjecH', 'Ejecutadas'), h('hheeAprobH', 'Aprobadas'), h('hheeCumplH', 'Reconocidas'), h('desviacionH', 'Brecha')],
      hheeNoRec: [h('hheeEjecH', 'Ejecutadas'), h('hheeCumplH', 'Reconocidas'), h('hheeNoRecH', 'No reconocidas')],
      desviacion: [h('hheeEjecH', 'Ejecutadas'), h('hheeAprobH', 'Aprobadas'), h('desviacionH', 'Brecha')],
      hheeFeriado: [...ev, ['minEvento', 'Min. aprobados en feriado', 'int'], h('hheeAprobH', 'Aprobadas (todas)'), h('hheeCumplH', 'Reconocidas (todas)')],
      hheeFeriadoAprob: [...ev, ['minEvento', 'Min. aprobados en feriado', 'int'], h('hheeAprobH', 'Aprobadas (todas)')],
      hheeFeriadoComp: [...ev, ['minEvento', 'Min. compensados en feriado', 'int'], h('hheeCumplH', 'Reconocidas (todas)')],
      hheePartTime: [['jornada', 'Jornada', 'txt'], ...ev, ['minEvento', 'Min. aprobados', 'int'], h('hheeEjecH', 'Ejecutadas')],
    };
    const conMin = ['E1', 'S1', 'E2', 'S2', 'justAtraso', 'justSalida', 'exceso'];
    const cols = set[m] || (conMin.includes(m) ? [...ev, ['minEvento', 'Minutos', 'int'], ['diasEsperados', 'Días esp.', 'int']] : [...ev, ['diasEsperados', 'Días esp.', 'int'], ['pctAsistencia', 'Asistencia', 'pct']]);
    if (m === 'fiscalizables' || m === 'noFiscalizables') return [...id, ...set.personas];
    return [...id, ...cols];
  }

  function pintarDrawer() {
    const ds = drawerEstado;
    if (!ds) return;
    const { dashboard, sel, res } = ds;
    const capa = contenedor(dashboard).querySelector('[data-drawer]');
    const cols = columnasDrill(res);
    if (!esTodos(res) && res.personas.some((p) => p.fechas)) cols.splice(3, 0, ['fechas', 'Fechas', 'fechas']);
    let filas = res.personas;
    if (ds.q) {
      const q = ds.q.toLowerCase();
      filas = filas.filter((p) => `${p.nombre} ${p.keyId} ${p.sucursal} ${p.jefe} ${p.cargo}`.toLowerCase().includes(q));
    }
    if (ds.orden) {
      const [k, dir] = ds.orden;
      filas = [...filas].sort((a, b) => {
        const va = a[k] ?? -Infinity, vb = b[k] ?? -Infinity;
        return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * dir;
      });
    }
    const contexto = [
      sel.sucursal ? esc(sel.sucursal) : 'Todas las sucursales',
      sel.periodo ? periodoTexto(sel.periodo, sel.granularidad) : rangoTexto(dashboard),
      sel.keyId ? `Persona ${esc(sel.keyId)}` : '',
      sel.malla ? `Malla ${mallaTexto(sel.malla)}` : '',
    ].filter(Boolean).join(' · ');
    const MAX = 400;
    const total = filas.length;
    const vis = filas.slice(0, MAX);
    const r = res.resumen;
    capa.innerHTML = `
      <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-t">
        <header class="drawer-head">
          <div>
            <p class="drawer-ctx">${NOMBRE[dashboard]} · ${contexto}</p>
            <h2 id="drawer-t">${esc(res.titulo)}</h2>
            <p class="drawer-res"><b>${fmtMiles(r.personas)}</b> ${r.personas === 1 ? 'persona' : 'personas'}${res.detalle.length ? ` · <b>${fmtMiles(r.eventos)}</b> ${esc(res.evento.charAt(0).toLowerCase() + res.evento.slice(1))}` : ''}${r.minutos ? ` · <b>${fmtHoras(r.minutos / 60)} h</b>` : ''}</p>
          </div>
          <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">${icon('close')}</button>
        </header>
        <div class="drawer-tools">
          <label class="busqueda">${icon('search')}<input type="search" class="input" placeholder="Buscar por nombre, DNI, jefe o cargo" aria-label="Buscar persona" value="${esc(ds.q)}" data-dq /></label>
          ${sel.sucursal && !sel.keyId ? `<button type="button" class="btn-sec" data-filtrar>${icon('filtro')}<span>Filtrar el tablero por esta sucursal</span></button>` : ''}
          <button type="button" class="btn-sec" data-dcsv>${icon('download')}<span>CSV</span></button>
          <button type="button" class="btn" data-dxls>${icon('download')}<span>Descargar reporte Excel</span></button>
        </div>
        <div class="drawer-body">
          ${total ? `<table class="tabla tabla-drawer">
            <thead><tr>${cols.map(([k, l, t]) => `<th class="${t !== 'txt' && t !== 'persona' && t !== 'fechas' ? 'num' : ''}"><button type="button" class="th-orden" data-dorden="${k}">${esc(l)}${ds.orden && ds.orden[0] === k ? icon(ds.orden[1] === -1 ? 'down' : 'up', 'ico-xs') : ''}</button></th>`).join('')}</tr></thead>
            <tbody>${vis.map((p) => `<tr>${cols.map(([k, , t]) => celda(p, k, t)).join('')}</tr>`).join('')}</tbody>
          </table>${total > MAX ? `<p class="nota">Se muestran ${fmtMiles(MAX)} de ${fmtMiles(total)} personas; el Excel y el CSV las incluyen todas.</p>` : ''}`
          : '<p class="vacio">No hay trabajadores con este caso en el filtro.</p>'}
        </div>
        <footer class="drawer-pie">
          <p class="nota">El Excel trae <b>Trabajadores</b> (su información y las fechas de cada caso), <b>Días</b> (una fila por persona y día${res.detalle.length ? `: ${fmtMiles(res.detalle.length)} filas${res.truncado ? ', recortado a 20.000' : ''}` : ''}), <b>Todas las incidencias</b> de esas personas día por día y <b>Filtro</b>.</p>
        </footer>
      </aside>`;
    const drawer = capa.querySelector('.drawer');
    capa.querySelector('[data-cerrar]').addEventListener('click', cerrarDrawer);
    capa.onclick = (e) => { if (e.target === capa) cerrarDrawer(); };
    const q = capa.querySelector('[data-dq]');
    q.addEventListener('input', () => {
      ds.q = q.value;
      const pos = q.selectionStart;
      pintarDrawer();
      const nq = capa.querySelector('[data-dq]');
      nq.focus();
      nq.setSelectionRange(pos, pos);
    });
    capa.querySelectorAll('[data-dorden]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.dorden;
      ds.orden = ds.orden && ds.orden[0] === k ? [k, -ds.orden[1]] : [k, typeof (res.personas[0] || {})[k] === 'string' ? 1 : -1];
      pintarDrawer();
      capa.querySelector(`[data-dorden="${k}"]`).focus();
    }));
    const filtrar = capa.querySelector('[data-filtrar]');
    if (filtrar) filtrar.addEventListener('click', () => {
      estado[dashboard].sucursales = [sel.sucursal];
      cerrarDrawer();
      const cont = contenedor(dashboard);
      pintarFiltros(dashboard, cont);
      actualizar(dashboard, cont);
    });
    capa.querySelector('[data-dcsv]').addEventListener('click', () => descargarDrill('csv'));
    capa.querySelector('[data-dxls]').addEventListener('click', () => descargarDrill('excel'));
    // Mantener el foco dentro del panel.
    drawer.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = [...drawer.querySelectorAll('button, input, select, [tabindex="0"]')].filter((x) => !x.disabled);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    if (!drawer.contains(document.activeElement)) capa.querySelector('[data-cerrar]').focus();
  }

  function cerrarDrawer() {
    if (!drawerEstado) return;
    const capa = contenedor(drawerEstado.dashboard).querySelector('[data-drawer]');
    capa.hidden = true;
    capa.innerHTML = '';
    const ant = drawerEstado.anterior;
    drawerEstado = null;
    if (ant && ant.focus) ant.focus();
  }

  const COLS_PERSONA = [
    ['keyId', 'DNI / CE'], ['nombre', 'Nombre'], ['sucursal', 'Sucursal'], ['dashboard', 'Dashboard'], ['cargo', 'Cargo'], ['jefe', 'Jefe directo'],
    ['jornada', 'Jornada'], ['modeloDias', 'Modelo de días'], ['campanero', 'Campañero'], ['sindicalizado', 'Sindicalizado'], ['fiscalizacion', 'Fiscalización'],
    ['eventos', 'Casos de la selección'], ['minEvento', 'Minutos de la selección'],
    ['diasEsperados', 'Días esperados'], ['presentes', 'Días presentes'], ['pctAsistencia', '% asistencia'], ['faltas', 'Faltas injustificadas'],
    ['sinMarcacion', 'Días sin marcación'], ['marcIncompleta', 'Marcación incompleta'], ['noPlan', 'Días no planificados'],
    ['tardanzas', 'Tardanzas'], ['minTardanza', 'Min. tardanza'], ['salidas', 'Salidas anticipadas'], ['minSalida', 'Min. salida anticipada'],
    ['fugaH', 'Fuga (h)'], ['minJustificados', 'Min. justificados'], ['marcasManuales', 'Marcas manuales'], ['excesoRefrigerio', 'Días con exceso de refrigerio'],
    ['trabajoDescanso', 'Días trabajados en descanso'], ['feriadosTrabajados', 'Feriados trabajados'],
    ['hheeEjecH', 'HHEE ejecutadas (h)'], ['hheeAprobH', 'HHEE aprobadas (h)'], ['hheeCumplH', 'HHEE reconocidas (h)'], ['hheeNoRecH', 'HHEE no reconocidas (h)'], ['desviacionH', 'Brecha HHEE (h)'],
  ];
  const COLS_DIA = [
    ['fecha', 'Fecha'], ['dia', 'Día'], ['keyId', 'DNI / CE'], ['nombre', 'Nombre'], ['sucursal', 'Sucursal'], ['incidencia', 'Caso'], ['minutos', 'Minutos del caso'],
    ['estadoDia', 'Estado del día'], ['tipoTurno', 'Tipo de turno'],
    ['turno', 'Turno'], ['entrada', 'Primera entrada'], ['salida', 'Última salida'], ['marcas', 'Marcas (E1-S1-E2-S2)'],
    ['atrasoE1', 'Atraso E1 (min)'], ['adelantoS1', 'Adelanto S1 (min)'], ['atrasoE2', 'Atraso E2 (min)'], ['adelantoS2', 'Adelanto S2 (min)'],
    ['fugaMin', 'Fuga (min)'], ['faltantes', 'Marcas que faltan'], ['feriado', 'Feriado'], ['permiso', 'Permiso'], ['justificacion', 'Justificación registrada'],
  ];
  const COLS_DIA_TE = [
    ['fecha', 'Fecha'], ['keyId', 'DNI / CE'], ['nombre', 'Nombre'], ['sucursal', 'Sucursal'], ['incidencia', 'Caso'], ['jornada', 'Jornada'], ['feriado', 'Feriado'], ['turno', 'Turno'],
    ['ejecutadasH', 'Ejecutadas (h)'], ['aprobadasH', 'Aprobadas (h)'], ['cumplidasH', 'Reconocidas (h)'], ['noReconocidasH', 'No reconocidas (h)'], ['conAsistencia', 'Con fila de asistencia'],
  ];

  function descargarDrill(formato) {
    const ds = drawerEstado;
    if (!ds) return;
    const { dashboard, sel, res } = ds;
    const base = `Trabajadores_${slug(res.titulo)}${sel.sucursal ? '_' + slug(sel.sucursal) : ''}${sel.malla ? '_malla_' + slug(sel.malla.split('|')[0]) : ''}_${hoy()}`;
    return descargarReporte(dashboard, sel, res, base, formato);
  }

  /**
   * Reporte de trabajadores de una selección. Excel con:
   *  - Trabajadores: su información, los indicadores y las fechas del caso.
   *  - Días: <caso>: una fila por persona y día del caso (p. ej. cada falta).
   *  - Todas las incidencias: el registro día por día de todo lo demás que tuvo
   *    cada una de esas personas en el mismo alcance.
   *  - Filtro: lo que estaba aplicado.
   * El CSV lleva la hoja Trabajadores con las fechas.
   */
  async function descargarReporte(dashboard, sel, res, base, formato, hojasPrevias = []) {
    const reg = await callWorker('registro', {
      filtros: estado[dashboard], cfg: getCfg(), sel: { ...sel, metrica: undefined },
      keyIds: res.personas.map((p) => p.keyId),
    });
    const r2 = (v) => (typeof v === 'number' ? +v.toFixed(2) : v ?? '');
    const cols = colsPersona(res);
    const personas = res.personas.map((p) => Object.fromEntries(cols.map(([k]) => [k, k === 'incidenciasFechas' ? reg.fechas[p.keyId] || '' : r2(p[k])])));
    if (formato === 'csv') {
      exportarCSV(base, cols.map((c) => c[0]), personas, cols.map((c) => c[1]));
      return;
    }
    const colsDia = res.esTE ? COLS_DIA_TE : COLS_DIA;
    const f = estado[dashboard];
    const filtro = [
      { campo: 'Reporte', valor: res.titulo },
      { campo: 'Dashboard', valor: NOMBRE[dashboard] },
      { campo: 'Sucursal seleccionada', valor: sel.sucursal || 'Todas' },
      { campo: 'Período seleccionado', valor: sel.periodo ? periodoTexto(sel.periodo, sel.granularidad) : rangoTexto(dashboard) },
      { campo: 'Persona', valor: sel.keyId || '' },
      { campo: 'Malla horaria', valor: sel.malla ? mallaTexto(sel.malla) : 'Todas' },
      { campo: 'Rango del tablero', valor: rangoTexto(dashboard) },
      { campo: 'Filtro de sucursales', valor: f.sucursales.join(', ') || 'Todas' },
      { campo: 'Jefe', valor: f.jefes.join(', ') || 'Todos' },
      { campo: 'Cargo', valor: f.cargos.join(', ') || 'Todos' },
      { campo: 'Campañero / Sindicalizado / Jornada', valor: [f.campanero || 'Todos', f.sindicalizado || 'Todos', f.jornada || 'Todas'].join(' / ') },
      { campo: 'Personas', valor: res.resumen.personas },
      { campo: 'Casos', valor: res.resumen.eventos },
      { campo: 'Generado', valor: new Date().toLocaleString('es-PE') },
    ];
    const detalle = res.truncado ? [...res.detalle, { fecha: `Se muestran ${res.detalle.length} filas; acota el filtro para ver el resto.` }] : res.detalle;
    await exportarExcelHojas(base, [
      ...hojasPrevias,
      { nombre: 'Trabajadores', columnas: cols.map((c) => c[0]), titulos: cols.map((c) => c[1]), filas: personas },
      { nombre: res.detalle.length && !esTodos(res) ? 'Días del caso' : 'Registro por día', columnas: colsDia.map((c) => c[0]), titulos: colsDia.map((c) => c[1]), filas: detalle },
      hojaRegistro(reg, 'Todas las incidencias'),
      hojaResumenIncidencias(reg),
      { nombre: 'Filtro', columnas: ['campo', 'valor'], titulos: ['Campo', 'Valor'], filas: filtro },
    ]);
  }
  // Métricas que cuentan a todas las personas (su "detalle" son todos sus días).
  function esTodos(res) { return ['personas', 'fiscalizables', 'noFiscalizables', 'asistencia'].includes(res.sel.metrica); }
  function colsPersona(res) {
    const cols = [...COLS_PERSONA];
    const i = cols.findIndex((c) => c[0] === 'minEvento') + 1;
    if (!esTodos(res)) cols.splice(i, 0, ['fechas', `Fechas: ${res.titulo}`]);
    cols.push(['incidenciasFechas', 'Todas sus incidencias por fecha']);
    return cols;
  }

  // ---- Exportaciones de gráficos y de la matriz ----------------------------------
  // Descarga de un gráfico: sus datos por sucursal + el reporte de los
  // trabajadores detrás (con las fechas de cada caso).
  async function exportarGrafico(dashboard, key) {
    const g = GRAF[key];
    const data = ultData[dashboard];
    if (!g || !data) return;
    const arr = g.datos(data) || [];
    const hojaDatos = {
      nombre: 'Datos del gráfico', columnas: g.cols.map((c) => c[0]), titulos: g.cols.map((c) => c[1]),
      filas: arr.map((x) => Object.fromEntries(g.cols.map(([k]) => [k, typeof x[k] === 'number' ? +x[k].toFixed(2) : x[k]]))),
    };
    const sel = { metrica: g.metrica || g.metricaReporte };
    toastVista(dashboard, 'Preparando el Excel con los trabajadores y sus días…');
    const res = await callWorker('drill', { filtros: estado[dashboard], sel, cfg: getCfg() });
    await descargarReporte(dashboard, sel, res, `${slug(g.titulo)}_${slug(NOMBRE[dashboard])}_${hoy()}`, 'excel', [hojaDatos]);
  }
  function toastVista(dashboard, msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast visible ok';
    clearTimeout(toastVista.timer);
    toastVista.timer = setTimeout(() => (t.className = 'toast'), 2500);
  }
  async function exportarMatriz(dashboard, formato) {
    const data = ultData[dashboard];
    const cols = [
      ['sucursal', 'Sucursal'], ['personas', 'Personas'], ['fiscalizables', 'Fiscalizables'], ['pctAsistencia', '% asistencia'], ['sumPresente', 'Días presentes'],
      ['sumDiaEsperado', 'Días esperados'], ['pctMalla', '% malla'], ['diasNoPlan', 'Días no planificados'], ['trabajadoresNoPlan', 'Personas sin turno'],
      ['faltasInjust', 'Faltas'], ['diasSinMarcacion', 'Sin marcación'], ['tardanzasDias', 'Tardanzas'], ['pctTardanza', '% tardanza'],
      ['tardanzaH', 'Tardanzas (h)'], ['salidaAntH', 'Salidas anticipadas (h)'], ['fugaH', 'Fuga (h)'], ['fugaHporFisc', 'Fuga h / fiscalizable'],
      ['hheeEjecH', 'HHEE ejecutadas (h)'], ['hheeAutH', 'HHEE aprobadas (h)'], ['hheeReconH', 'HHEE reconocidas (h)'], ['pctHHEERecon', '% HHEE reconocidas'],
      ['desviacionHHEEH', 'Brecha HHEE (h)'], ['pctDesviacionHHEE', '% brecha HHEE'],
    ];
    const filas = data.porSucursal.map((s) => Object.fromEntries(cols.map(([k]) => [k, typeof s[k] === 'number' ? +s[k].toFixed(2) : s[k]])));
    const nombre = `Sucursales_${slug(NOMBRE[dashboard])}_${hoy()}`;
    if (formato === 'excel') {
      // Además del resumen por sucursal, el registro día por día de cada incidencia.
      toastVista(dashboard, 'Preparando el Excel con el registro de incidencias…');
      const reg = await callWorker('registro', { filtros: estado[dashboard], cfg: getCfg() });
      await exportarExcelHojas(nombre, [
        { nombre: 'Sucursales', columnas: cols.map((c) => c[0]), titulos: cols.map((c) => c[1]), filas },
        hojaResumenIncidencias(reg),
        hojaRegistro(reg),
      ]);
    }
    else exportarCSV(nombre, cols.map((c) => c[0]), filas, cols.map((c) => c[1]));
  }

  // ---- Insights ------------------------------------------------------------------
  function insightsAsistencia(data) {
    const k = data.kpis;
    const bajo90 = data.porSucursal.filter((s) => s.sumDiaEsperado > 0 && s.pctAsistencia < 90).length;
    const peor = data.graficos.asistencia[0];
    const out = [`La asistencia es de <b>${fmtPct(k.pctAsistencia)}</b>${bajo90 ? `; <b>${fmtMiles(bajo90)}</b> ${bajo90 === 1 ? 'sucursal está' : 'sucursales están'} por debajo del 90%` : ''}.`];
    if (peor) out.push(`La más baja es <b>${esc(peor.sucursal)}</b> con ${fmtPct(peor.valor)} (${fmtMiles(peor.presentes)} de ${fmtMiles(peor.esperados)} días).`);
    out.push(`La malla se cumple al <b>${fmtPct(k.pctMalla)}</b> (${k.semaforoMalla.toLowerCase()}): ${fmtMiles(k.diasNoPlan)} días trabajados sin turno, de ${fmtMiles(k.trabajadoresNoPlan)} personas.`);
    out.push(`Hay <b>${fmtMiles(k.faltasInjust)}</b> faltas injustificadas y <b>${fmtMiles(k.diasSinMarcacion)}</b> días con turno pero sin ninguna marca.`);
    return out;
  }
  function insightsMarcacion(data) {
    const k = data.kpis;
    const total = k.marcacionCompleta + k.marcacionIncompleta;
    return [
      `<b>${fmtPct(total ? (k.marcacionCompleta / total) * 100 : 0)}</b> de los días marcados tienen las marcas completas (${fmtMiles(k.marcacionCompleta)} de ${fmtMiles(total)}).`,
      `<b>${fmtMiles(k.marcasManuales)}</b> marcas fueron ingresadas a mano, no por el reloj.`,
      `<b>${fmtMiles(k.excesoRefrigerioDias)}</b> días superan la tolerancia de refrigerio y <b>${fmtMiles(k.trabajoEnDescanso)}</b> días se trabajó en descanso.`,
    ];
  }
  function insightsFuga(data) {
    const k = data.kpis;
    const tot = k.tardanzaH + k.salidaAntH;
    const pctT = tot ? (k.tardanzaH / tot) * 100 : 0;
    const punto = [...(data.puntos || [])].sort((a, b) => b.minTotales - a.minTotales)[0];
    const out = [
      `Se perdieron <b>${fmtHoras(k.fugaH)} h</b> (${fmtDec1(k.fugaHporFisc)} h por persona fiscalizada): <b>${fmtPct(pctT)}</b> por tardanzas y <b>${fmtPct(100 - pctT)}</b> por salidas anticipadas.`,
      `La tardanza es de <b>${fmtPct(k.pctTardanza)}</b> de los días presentes; ${fmtMiles(k.personasTardanza)} personas llegaron tarde al menos una vez.`,
    ];
    if (punto && punto.minTotales) out.push(`La marca que más minutos pierde es <b>${esc(punto.punto)}</b>: ${fmtMiles(punto.dias)} días, ${fmtDec1(punto.promedio)} min en promedio.`);
    return out;
  }
  function insightsControles(data) {
    const r = data.controles.resumen;
    const g = data.controles.graficos;
    const out = [];
    const peor = (arr) => (arr && arr[0] ? ` La sucursal con más casos es <b>${esc(arr[0].sucursal)}</b> (${fmtMiles(arr[0].casos)}).` : '');
    if (!data.nFilasTE) out.push('No hay archivo de Tiempo Extra cargado: los dos controles de HHEE no se pueden revisar.');
    else {
      out.push(r.hheeFeriado.casos
        ? `<b>${fmtMiles(r.hheeFeriado.casos)}</b> días feriados tienen HHEE aprobadas o compensadas (${fmtMiles(r.hheeFeriado.personas)} personas); no debería haber ninguno.${peor(g.hheeFeriado)}`
        : 'No hay HHEE aprobadas ni compensadas en feriados: el control se cumple.');
      out.push(r.hheePartTime.casos
        ? `Se aprobaron <b>${fmtHoras(r.hheePartTime.aprobH)} h</b> de HHEE a <b>${fmtMiles(r.hheePartTime.personas)}</b> personas part-time en ${fmtMiles(r.hheePartTime.casos)} días: confirmar que fueron por contingencia.`
        : 'No hay HHEE aprobadas a personas part-time.');
    }
    out.push(r.faltaSinLicencia.casos
      ? `<b>${fmtMiles(r.faltaSinLicencia.casos)}</b> días con turno no tuvieron ninguna marca ni licencia (${fmtMiles(r.faltaSinLicencia.personas)} personas); ${fmtMiles(r.faltaSinLicencia.sinMarca)} ni siquiera están registrados como inasistencia.${peor(g.faltaSinLicencia)}`
      : 'No hay faltas con turno y sin licencia.');
    const m = r.marcaFaltante;
    out.push(m.casos
      ? `<b>${fmtMiles(m.casos)}</b> días tienen una marca faltante: ${fmtMiles(m.entrada)} sin entrada, ${fmtMiles(m.salida)} sin salida y ${fmtMiles(m.refrigerio)} sin refrigerio.`
      : 'Todos los días marcados tienen sus marcas completas.');
    out.push(r.marcaSinPlan.casos
      ? `<b>${fmtMiles(r.marcaSinPlan.casos)}</b> días con marcas fuera de la planificación (${fmtMiles(r.marcaSinPlan.descanso)} en descanso, ${fmtMiles(r.marcaSinPlan.sinTurno)} sin turno): revisar si falta asignar el turno.`
      : 'No hay marcaciones en días de descanso ni sin turno.');
    return out;
  }

  function insightsHHEE(data) {
    const k = data.kpis;
    const noRec = k.hheeEjecH ? (k.hheeNoReconH / k.hheeEjecH) * 100 : 0;
    const peor = data.graficos.brecha[0];
    const out = [
      `Se ejecutaron <b>${fmtHoras(k.hheeEjecH)} h</b> contra <b>${fmtHoras(k.hheeAutH)} h</b> aprobadas: ${k.desviacionHHEEH < 0 ? 'se trabajó' : 'sobraron'} <b>${fmtHoras(Math.abs(k.desviacionHHEEH))} h</b> ${k.desviacionHHEEH < 0 ? 'más de lo aprobado' : 'aprobadas'} (${fmtPct(Math.abs(k.pctDesviacionHHEE))}).`,
      `Se reconoce <b>${fmtPct(k.pctHHEERecon)}</b> de lo ejecutado; <b>${fmtHoras(k.hheeNoReconH)} h</b> (${fmtPct(noRec)}) quedan sin reconocer.`,
    ];
    if (peor && peor.valor < 0) out.push(`La mayor sobre-ejecución está en <b>${esc(peor.sucursal)}</b>: ${fmtHoras(peor.valor)} h.`);
    if (data.nFilasTE) out.push(`Incluye todos los días del archivo de Tiempo Extra, también los que no tienen fila de asistencia.`);
    return out;
  }

  // ---- Utilidades de la vista -----------------------------------------------------
  function cid(dashboard, base) { return (dashboard === 'Tienda' ? 't_' : 'l_') + base; }
  function rangoTexto(dashboard) {
    const f = estado[dashboard];
    return `del ${fFecha(f.fechaDesde || opciones.fechaMin)} al ${fFecha(f.fechaHasta || opciones.fechaMax)}`;
  }

  return { setOpciones, render };
}

// --- Utilidades puras ----------------------------------------------------------
function fmtKpi(v, c) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (c.fmt === 'pct') return fmtPct(v);
  if (c.fmt === 'h') return fmtHoras(v) + ' h';
  if (c.fmt === 'dec') return fmtDec1(v) + (c.unidad || '');
  return fmtMiles(v) + (c.unidad || '');
}
function deltaTexto(c, cur, prev, corto = false) {
  if (prev === undefined || prev === null || !Number.isFinite(cur)) return '';
  const diff = cur - prev;
  if (Math.abs(diff) < 1e-9) return `<span class="delta neutro">sin cambio${corto ? '' : ' vs. período anterior'}</span>`;
  const txt = c.fmt === 'pct'
    ? `${diff > 0 ? '+' : '−'}${fmtDec1(Math.abs(diff))} pts`
    : prev !== 0 ? `${diff > 0 ? '+' : '−'}${fmtDec1(Math.abs((diff / Math.abs(prev)) * 100))}%` : `${diff > 0 ? '+' : '−'}${fmtMiles(Math.abs(diff))}`;
  const bueno = c.good === 'up' ? diff > 0 : c.good === 'down' ? diff < 0 : null;
  const cls = bueno === null ? 'neutro' : bueno ? 'bien' : 'mal';
  return `<span class="delta ${cls}">${icon(diff > 0 ? 'up' : 'down', 'ico-xs')}${txt}${corto ? '' : ' vs. período anterior'}</span>`;
}
function celda(p, k, t) {
  const v = p[k];
  if (t === 'persona') return `<td><b>${esc(p.nombre)}</b><small>${esc(p.keyId)}${p.cargo ? ' · ' + esc(p.cargo) : ''}</small></td>`;
  if (t === 'txt') return `<td>${esc(v)}</td>`;
  if (t === 'fechas') return `<td class="td-fechas">${esc(v)}</td>`;
  if (v === null || v === undefined) return '<td class="num">—</td>';
  if (t === 'pct') return `<td class="num">${fmtPct(v)}</td>`;
  if (t === 'h') return `<td class="num">${fmtHoras(v)}</td>`;
  return `<td class="num">${fmtMiles(v)}</td>`;
}
function tablaHTML(cols, filas, claveFila) {
  const fmt = (v, t) => (t === 'txt' ? esc(v) : t === 'pct' ? fmtPct(v) : t === 'h' ? fmtHoras(v) : fmtMiles(v));
  return `<div class="tabla-scroll"><table class="tabla">
    <thead><tr>${cols.map(([, l, t]) => `<th class="${t === 'txt' ? '' : 'num'}">${esc(l)}</th>`).join('')}</tr></thead>
    <tbody>${filas.map((f) => `<tr data-fila="${esc(f[claveFila])}" tabindex="0">${cols.map(([k, , t]) => `<td class="${t === 'txt' ? '' : 'num'}">${fmt(f[k], t)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function slug(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
}
function hoy() { return new Date().toISOString().slice(0, 10); }
function fFecha(s) { return s && s.length === 8 ? `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}` : '—'; }
function isoDate(s) { return s && s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : ''; }
function dateDe(s) { return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)); }
function ymd(d) { return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; }
function addDias(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function mesInicio(s) { return s.slice(0, 6) + '01'; }
function diasEntre(a, b) { return Math.round((dateDe(b) - dateDe(a)) / 86400000); }
function hhmm(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
// "09:00-18:00|60" -> "09:00–18:00, refrigerio 60 min"
function mallaTexto(id) {
  const [h, r] = String(id).split('|');
  return `${h.replace('-', '–')}, refrigerio ${r} min`;
}
function periodoTexto(clave, gran) {
  if (!clave) return '';
  if (gran === 'mes') return `mes ${clave}`;
  if (gran === 'semana') return `semana ${clave.slice(6)} de ${clave.slice(0, 4)}`;
  return `el ${fFecha(clave)}`;
}
