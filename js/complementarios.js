// =============================================================================
// complementarios.js
// Cortes por segmento con las 12 métricas, puntos de marcación, distribución
// por rango de atraso, categorías de permiso y feriados por calendario.
// Funciones puras (se ejecutan en el Web Worker).
// =============================================================================

import { DEFAULT_CONFIG } from './config.js';
import { calcKpis, filtrar } from './kpis.js';

const ORDEN_RANGOS = ['Sin atraso', '1-5', '6-15', '16-30', 'Más de 30'];

/** Restringe a los dashboards oficiales (Tienda + Logística). */
function soloDashboards(filas, dashboard) {
  if (dashboard) return filas.filter((f) => f.dashboard === dashboard);
  return filas.filter((f) => f.dashboard === 'Tienda' || f.dashboard === 'Logística');
}

/** Extrae las 12 métricas de un conjunto de filas. */
export function metricas12(filas, cfg = DEFAULT_CONFIG) {
  const k = calcKpis(filas, cfg);
  return {
    personas: k.personas,
    diasEsperados: k.sumDiaEsperado,
    presentes: k.sumPresente,
    pctAsistencia: k.pctAsistencia,
    tardanzas: k.tardanzasDias,
    pctTardanza: k.pctTardanza,
    faltas: k.faltasInjust,
    sinMarcacion: k.diasSinMarcacion,
    trabajoEnDescanso: k.trabajoEnDescanso,
    excesoRefrigerio: k.excesoRefrigerioDias,
    sinTurno: k.diasNoPlan,
    feriadoTrabajado: k.trabajoFeriado,
  };
}

/** Corte por un campo: una fila por valor distinto, con las 12 métricas. */
export function cortePorSegmento(filas, campo, cfg = DEFAULT_CONFIG) {
  const grupos = new Map();
  for (const f of filas) {
    const k = f[campo] === '' || f[campo] == null ? '(sin dato)' : f[campo];
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(f);
  }
  const out = [];
  for (const [clave, arr] of grupos) out.push({ clave, ...metricas12(arr, cfg) });
  return out.sort((a, b) => b.personas - a.personas);
}

/** Métricas de un punto de marcación (E1/S1/E2/S2). */
function punto(filas, campoMin, presentes) {
  let dias = 0;
  let total = 0;
  let max = 0;
  for (const f of filas) {
    const v = f[campoMin] || 0;
    if (v > 0) {
      dias++;
      total += v;
      if (v > max) max = v;
    }
  }
  return {
    dias,
    pctPresentes: presentes ? (dias / presentes) * 100 : 0,
    minTotales: total,
    promedio: dias ? total / dias : 0,
    maximo: max,
  };
}

/** Puntos de marcación: E1 atraso, S1 salida ant., E2 exceso retorno, S2 salida. */
export function puntosMarcacion(filas) {
  const presentes = filas.reduce((a, f) => a + f.presente, 0);
  return [
    { punto: 'E1 · Atraso entrada', ...punto(filas, 'atrasoE1', presentes) },
    { punto: 'S1 · Salida anticipada a refrigerio', ...punto(filas, 'adelantoS1', presentes) },
    { punto: 'E2 · Exceso de retorno de refrigerio', ...punto(filas, 'atrasoE2', presentes) },
    { punto: 'S2 · Salida anticipada final', ...punto(filas, 'adelantoS2', presentes) },
  ];
}

/** Distribución por rango de atraso de E1. */
export function distribucionRangoAtraso(filas) {
  const g = new Map();
  for (const f of filas) {
    const r = f.rangoAtrasoE1 || 'Sin atraso';
    if (!g.has(r)) g.set(r, { dias: 0, personas: new Set() });
    const o = g.get(r);
    o.dias++;
    o.personas.add(f.keyId);
  }
  return ORDEN_RANGOS.filter((r) => g.has(r)).map((r) => ({
    rango: r,
    dias: g.get(r).dias,
    personas: g.get(r).personas.size,
  }));
}

/** Categorías de permiso. */
export function categoriasPermiso(filas) {
  const g = new Map();
  for (const f of filas) {
    const c = f.categoriaPermiso || '(sin dato)';
    if (!g.has(c)) g.set(c, { dias: 0, personas: new Set() });
    const o = g.get(c);
    o.dias++;
    o.personas.add(f.keyId);
  }
  return [...g.entries()]
    .map(([categoria, o]) => ({ categoria, dias: o.dias, personas: o.personas.size }))
    .sort((a, b) => b.dias - a.dias);
}

/** Feriados trabajados por calendario de festivos. */
export function feriadosPorCalendario(filas) {
  const g = new Map();
  for (const f of filas) {
    const c = f.calendario || '(sin dato)';
    if (!g.has(c)) g.set(c, { diasFeriado: 0, trabajados: 0, personas: new Set() });
    const o = g.get(c);
    if (f.feriado === 'Sí') o.diasFeriado++;
    if (f.trabajoFeriado === 1) {
      o.trabajados++;
      o.personas.add(f.keyId);
    }
  }
  return [...g.entries()]
    .map(([calendario, o]) => ({
      calendario,
      diasFeriado: o.diasFeriado,
      feriadosTrabajados: o.trabajados,
      personas: o.personas.size,
    }))
    .sort((a, b) => b.feriadosTrabajados - a.feriadosTrabajados);
}

/** Arma todos los complementarios respetando los filtros. */
export function construirComplementarios(filas, filtros = {}, cfg = DEFAULT_CONFIG) {
  const base = soloDashboards(filtrar(filas, { ...filtros, dashboard: '' }), filtros.dashboard);
  return {
    nFilas: base.length,
    campanero: cortePorSegmento(base, 'campanero', cfg),
    sindicalizado: cortePorSegmento(base, 'sindicalizado', cfg),
    jornada: cortePorSegmento(base, 'jornada', cfg),
    modeloDias: cortePorSegmento(base, 'modeloDias', cfg),
    calendario: cortePorSegmento(base, 'calendario', cfg),
    jefes: cortePorSegmento(base, 'jefe', cfg).sort((a, b) => b.tardanzas - a.tardanzas).slice(0, 15),
    puntosMarcacion: puntosMarcacion(base),
    rangoAtraso: distribucionRangoAtraso(base),
    permisos: categoriasPermiso(base),
    feriados: feriadosPorCalendario(base),
  };
}
