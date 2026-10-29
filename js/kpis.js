// =============================================================================
// kpis.js
// Motor de KPIs y armado de dashboards. Funciones puras que operan sobre el
// arreglo de filas persona-día del modelo; se ejecutan dentro del Web Worker.
// =============================================================================

import { DEFAULT_CONFIG } from './config.js';
import { toYyyymmdd } from './parsers/common.js';

// ---------------------------------------------------------------------------
// Cálculo del bloque de KPIs para un conjunto de filas.
// ---------------------------------------------------------------------------
/**
 * @param {Array} filas  filas persona-día ya filtradas
 * @param {object} cfg
 * @returns {object} todos los KPIs de la sección 5
 */
export function calcKpis(filas, cfg = DEFAULT_CONFIG) {
  const tol = cfg.toleranciaRefrigerioMin;
  const personasSet = new Set();
  const fiscSet = new Set();
  const trabNoPlanSet = new Set();
  const persTardSet = new Set();

  let sumPresente = 0,
    sumDiaEsperado = 0,
    diasNoPlan = 0,
    sumTrabajo = 0,
    tardanzasDias = 0,
    minTardanza = 0,
    salidasAntDias = 0,
    minSalidaAnt = 0,
    fugaMin = 0,
    diasJustificacion = 0,
    minJustificados = 0,
    marcasManuales = 0,
    marcacionCompleta = 0,
    marcacionIncompleta = 0,
    faltasInjust = 0,
    diasSinMarcacion = 0,
    trabajoEnDescanso = 0,
    excesoRefrigerioDias = 0,
    trabajoFeriado = 0,
    teMin = 0,
    teHeaMin = 0,
    teFinalesMin = 0,
    teNoReconocidasMin = 0,
    minAtrasoJust = 0,
    minSalidaJust = 0;

  for (const f of filas) {
    personasSet.add(f.keyId);
    if (f.fiscalizacion === 'Fiscalizado') fiscSet.add(f.keyId);
    sumPresente += f.presente;
    sumDiaEsperado += f.diaEsperado;
    diasNoPlan += f.trabajoSinTurno;
    if (f.trabajoSinTurno === 1) trabNoPlanSet.add(f.keyId);
    sumTrabajo += f.trabajo;
    tardanzasDias += f.tardanza;
    minTardanza += f.atrasoE1;
    if (f.tardanza === 1) persTardSet.add(f.keyId);
    if (f.adelantoS2 > 0) salidasAntDias++;
    minSalidaAnt += f.adelantoS2;
    fugaMin += f.fugaMin;
    if (f.justificacionRegistrada === 'Sí') diasJustificacion++;
    minAtrasoJust += f.minAtrasoJustificado;
    minSalidaJust += f.minSalidaJustificada;
    minJustificados += f.minAtrasoJustificado + f.minSalidaJustificada;
    marcasManuales += f.marcasManuales;
    const completa = typeof f.tipoMarcacion === 'string' && f.tipoMarcacion.startsWith('Completa');
    if (completa) marcacionCompleta++;
    else if (f.nMarcaciones > 0) marcacionIncompleta++;
    if (f.estadoDia === 'Falta injustificada') faltasInjust++;
    if (f.estadoDia === 'Sin marcación') diasSinMarcacion++;
    if (f.estadoDia === 'Trabajó en descanso') trabajoEnDescanso++;
    if (f.excesoRefrigerioMin !== null && f.excesoRefrigerioMin > tol) excesoRefrigerioDias++;
    trabajoFeriado += f.trabajoFeriado;
    teMin += f.teMin || 0;
    teHeaMin += f.teHeaMin || 0;
    teFinalesMin += f.teFinalesMin || 0;
    teNoReconocidasMin += f.teNoReconocidasMin || 0;
  }

  const personas = personasSet.size;
  const fiscalizables = fiscSet.size;
  const pctAsistencia = sumDiaEsperado ? (sumPresente / sumDiaEsperado) * 100 : 0;
  const pctMalla = sumTrabajo ? (1 - diasNoPlan / sumTrabajo) * 100 : 0;
  const pctTardanza = sumPresente ? (tardanzasDias / sumPresente) * 100 : 0;
  const fugaH = fugaMin / 60;

  return {
    personas,
    fiscalizables,
    noFiscalizables: personas - fiscalizables,
    sumPresente,
    sumDiaEsperado,
    pctAsistencia,
    diasNoPlan,
    trabajadoresNoPlan: trabNoPlanSet.size,
    sumTrabajo,
    pctMalla,
    semaforoMalla: clasificarMalla(pctMalla, cfg),
    tardanzasDias,
    minTardanza,
    personasTardanza: persTardSet.size,
    pctTardanza,
    salidasAntDias,
    minSalidaAnt,
    fugaH,
    fugaHporFisc: fiscalizables ? fugaH / fiscalizables : 0,
    diasJustificacion,
    minJustificados,
    marcasManuales,
    marcacionCompleta,
    marcacionIncompleta,
    faltasInjust,
    diasSinMarcacion,
    trabajoEnDescanso,
    excesoRefrigerioDias,
    trabajoFeriado,
    hheeEjecH: teMin / 60,
    hheeAutH: teHeaMin / 60,
    hheeReconH: teFinalesMin / 60,
    hheeNoReconH: teNoReconocidasMin / 60,
    pctHHEERecon: teMin ? (teFinalesMin / teMin) * 100 : 0,
    // Desviación de HHEE = Aprobadas (HEA) − Ejecutadas (negativo = sobre-ejecución).
    desviacionHHEEH: (teHeaMin - teMin) / 60,
    pctDesviacionHHEE: teMin ? ((teHeaMin - teMin) / teMin) * 100 : 0,
    // Horas para gráficos de barras apiladas.
    tardanzaH: minTardanza / 60,
    salidaAntH: minSalidaAnt / 60,
    minAtrasoJustH: minAtrasoJust / 60,
    minSalidaJustH: minSalidaJust / 60,
  };
}

/** Clasifica el % de cumplimiento de malla en el semáforo. */
export function clasificarMalla(pct, cfg = DEFAULT_CONFIG) {
  const { cumpleMin, riesgoMin } = cfg.semaforoMalla;
  if (pct >= cumpleMin) return 'Cumple';
  if (pct >= riesgoMin) return 'En riesgo';
  return 'No cumple';
}

// ---------------------------------------------------------------------------
// Filtrado
// ---------------------------------------------------------------------------
/**
 * Aplica los filtros globales a las filas.
 * @param {Array} filas
 * @param {object} filtros
 */
export function filtrar(filas, filtros = {}) {
  const inSet = (arr) => (arr && arr.length ? new Set(arr) : null);
  const sucS = inSet(filtros.sucursales);
  const jefeS = inSet(filtros.jefes);
  const cargoS = inSet(filtros.cargos);
  const desde = filtros.fechaDesde || null; // yyyymmdd
  const hasta = filtros.fechaHasta || null;

  return filas.filter((f) => {
    if (filtros.dashboard && f.dashboard !== filtros.dashboard) return false;
    if (desde && f.yyyymmdd < desde) return false;
    if (hasta && f.yyyymmdd > hasta) return false;
    if (sucS && !sucS.has(f.sucursal)) return false;
    if (jefeS && !jefeS.has(f.jefe)) return false;
    if (cargoS && !cargoS.has(f.cargoOficial)) return false;
    if (filtros.campanero && f.campanero !== filtros.campanero) return false;
    if (filtros.sindicalizado && f.sindicalizado !== filtros.sindicalizado) return false;
    if (filtros.jornada && f.jornada !== filtros.jornada) return false;
    if (filtros.modeloDias && f.modeloDias !== filtros.modeloDias) return false;
    if (filtros.fiscalizacion && f.fiscalizacion !== filtros.fiscalizacion) return false;
    if (filtros.calendario && f.calendario !== filtros.calendario) return false;
    return true;
  });
}

/** Calcula el período anterior equivalente (misma duración, justo antes). */
export function periodoAnterior(desde, hasta) {
  if (!desde || !hasta) return null;
  const d = fromYyyymmdd(desde);
  const h = fromYyyymmdd(hasta);
  if (!d || !h) return null;
  const dias = Math.round((h - d) / 86400000) + 1;
  const prevHasta = new Date(d.getTime() - 86400000);
  const prevDesde = new Date(prevHasta.getTime() - (dias - 1) * 86400000);
  return { fechaDesde: toYyyymmdd(prevDesde), fechaHasta: toYyyymmdd(prevHasta) };
}

function fromYyyymmdd(s) {
  if (!s || s.length !== 8) return null;
  return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
}

// ---------------------------------------------------------------------------
// Agrupaciones (por sucursal / por tiempo)
// ---------------------------------------------------------------------------
/** Agrupa filas por un campo y calcula KPIs por grupo. */
export function kpisPorGrupo(filas, campo, cfg = DEFAULT_CONFIG) {
  const grupos = new Map();
  for (const f of filas) {
    const k = f[campo] || '(sin dato)';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(f);
  }
  const out = [];
  for (const [k, arr] of grupos) out.push({ clave: k, kpis: calcKpis(arr, cfg) });
  return out;
}

/** Serie temporal según granularidad ('dia'|'semana'|'mes'). */
export function serieTemporal(filas, granularidad, cfg = DEFAULT_CONFIG) {
  const keyOf = (f) =>
    granularidad === 'mes' ? f.mes : granularidad === 'semana' ? f.semana : f.yyyymmdd;
  const buckets = new Map();
  for (const f of filas) {
    const k = keyOf(f) || '?';
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(f);
  }
  const keys = [...buckets.keys()].sort();
  return keys.map((k) => {
    const kp = calcKpis(buckets.get(k), cfg);
    return {
      periodo: formatearPeriodo(k, granularidad),
      tardanzas: kp.tardanzasDias,
      fugaH: kp.fugaH,
      diasNoPlan: kp.diasNoPlan,
      hheeH: kp.hheeEjecH,
      pctAsistencia: kp.pctAsistencia,
    };
  });
}

function formatearPeriodo(k, gran) {
  if (gran === 'dia' && k.length === 8) return `${k.slice(6, 8)}/${k.slice(4, 6)}`;
  return k;
}

// ---------------------------------------------------------------------------
// Armado completo del dashboard (se llama desde el worker)
// ---------------------------------------------------------------------------
export function construirDashboard(filas, filtros, cfg = DEFAULT_CONFIG) {
  const base = filtrar(filas, filtros);
  const kpis = calcKpis(base, cfg);

  // Comparación con período anterior
  let kpisPrev = null;
  if (filtros.comparar) {
    const prev = periodoAnterior(filtros.fechaDesde, filtros.fechaHasta);
    if (prev) {
      const filasPrev = filtrar(filas, { ...filtros, ...prev });
      kpisPrev = calcKpis(filasPrev, cfg);
    }
  }

  // Por sucursal (para tabla y gráficos)
  const porSuc = kpisPorGrupo(base, 'sucursal', cfg)
    .map((g) => ({ sucursal: g.clave, ...g.kpis }))
    .filter((s) => s.personas > 0);

  // Top 5 diagnósticos
  const conEsperado = porSuc.filter((s) => s.sumDiaEsperado > 0);
  const top5PeorAsistencia = [...conEsperado].sort((a, b) => a.pctAsistencia - b.pctAsistencia).slice(0, 5);
  const top5Tardanzas = [...porSuc].sort((a, b) => b.tardanzasDias - a.tardanzasDias).slice(0, 5);
  const top5NoPlan = [...porSuc].sort((a, b) => b.diasNoPlan - a.diasNoPlan).slice(0, 5);

  // Datos para gráficos
  const porPersonas = [...porSuc].sort((a, b) => b.personas - a.personas);
  const top15 = porPersonas.slice(0, 15);

  const graficos = {
    gr01: top15.map((s) => ({ sucursal: s.sucursal, valor: s.pctAsistencia })),
    // Planificación: días no planificados + trabajadores afectados (badge).
    gr02: [...porSuc].sort((a, b) => b.diasNoPlan - a.diasNoPlan).filter((s) => s.diasNoPlan > 0).slice(0, 12)
      .map((s) => ({ sucursal: s.sucursal, valor: s.diasNoPlan, badge: s.trabajadoresNoPlan })),
    // Justificaciones por sucursal (días con justificación).
    gr03: [...porSuc].sort((a, b) => b.diasJustificacion - a.diasJustificacion).slice(0, 12)
      .map((s) => ({ sucursal: s.sucursal, valor: s.diasJustificacion })),
    // Control de accesos: horas justificadas (atrasos vs salidas) apiladas.
    gr04: [...porSuc].sort((a, b) => b.minAtrasoJustH + b.minSalidaJustH - (a.minAtrasoJustH + a.minSalidaJustH)).slice(0, 12)
      .map((s) => ({ sucursal: s.sucursal, a: s.minAtrasoJustH, b: s.minSalidaJustH })),
    // Disciplina operativa: fuga tardanzas vs salidas anticipadas (apiladas).
    gr05: [...porSuc].sort((a, b) => b.fugaH - a.fugaH).slice(0, 12)
      .map((s) => ({ sucursal: s.sucursal, a: s.tardanzaH, b: s.salidaAntH })),
    gr06: {
      completa: kpis.marcacionCompleta,
      incompleta: kpis.marcacionIncompleta,
      sinMarcacion: kpis.diasSinMarcacion,
      faltaInjust: kpis.faltasInjust,
    },
    // HHEE: ejecutadas vs aprobadas vs cumplidas (reconocidas).
    gr07: [...porSuc].sort((a, b) => b.hheeEjecH - a.hheeEjecH).slice(0, 12)
      .map((s) => ({ sucursal: s.sucursal, ejecutadas: s.hheeEjecH, aprobadas: s.hheeAutH, cumplidas: s.hheeReconH })),
    // Auditoría HHEE: brecha (aprobadas − ejecutadas), divergente.
    gr08: [...porSuc].filter((s) => s.hheeEjecH > 0 || s.hheeAutH > 0).sort((a, b) => a.desviacionHHEEH - b.desviacionHHEEH).slice(0, 14)
      .map((s) => ({ sucursal: s.sucursal, valor: s.desviacionHHEEH })),
    // Malla por sucursal.
    gr09: top15.map((s) => ({ sucursal: s.sucursal, valor: s.pctMalla })),
    // Tendencia temporal.
    tendencia: serieTemporal(base, filtros.granularidad || 'dia', cfg),
  };

  // Diagnóstico ejecutivo: tres prioridades del período.
  const peorNoPlan = [...porSuc].filter((s) => s.diasNoPlan > 0).sort((a, b) => b.diasNoPlan - a.diasNoPlan)[0] || null;
  const peorFuga = [...porSuc].filter((s) => s.fugaH > 0).sort((a, b) => b.fugaH - a.fugaH)[0] || null;
  const peorDesv = [...porSuc].filter((s) => s.desviacionHHEEH < 0).sort((a, b) => a.desviacionHHEEH - b.desviacionHHEEH)[0] || null;
  const diagnostico = {
    planificacion: peorNoPlan && { sucursal: peorNoPlan.sucursal, dias: peorNoPlan.diasNoPlan, trabajadores: peorNoPlan.trabajadoresNoPlan },
    fuga: peorFuga && { sucursal: peorFuga.sucursal, horas: peorFuga.fugaH, trabajadores: peorFuga.personasTardanza },
    hhee: peorDesv && { sucursal: peorDesv.sucursal, desviacion: peorDesv.desviacionHHEEH },
  };

  return {
    kpis,
    kpisPrev,
    porSucursal: porSuc,
    top5: { peorAsistencia: top5PeorAsistencia, tardanzas: top5Tardanzas, noPlan: top5NoPlan },
    graficos,
    diagnostico,
    nFilas: base.length,
  };
}
