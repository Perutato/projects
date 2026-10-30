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
  const out = [];
  for (const [k, arr] of agrupar(filas, (f) => f[campo] || '(sin dato)')) out.push({ clave: k, kpis: calcKpis(arr, cfg) });
  return out;
}

function agrupar(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

/** Clave de período de una fila según la granularidad ('dia'|'semana'|'mes'). */
export function clavePeriodo(f, granularidad) {
  return granularidad === 'mes' ? f.mes : granularidad === 'semana' ? f.semana : f.yyyymmdd;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
/** Etiqueta legible de un período. */
export function formatearPeriodo(k, gran) {
  if (!k) return '?';
  if (gran === 'mes' && /^\d{4}-\d{2}$/.test(k)) return `${MESES[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
  if (gran === 'semana' && /^\d{4}-W\d{2}$/.test(k)) return `Sem ${+k.slice(6)} · ${k.slice(0, 4)}`;
  if (k.length === 8) return `${k.slice(6, 8)}/${k.slice(4, 6)}`;
  return k;
}

/** KPIs de horas extra calculados sobre filas de Tiempo Extra. */
export function calcHHEE(teRows) {
  let te = 0, hea = 0, fin = 0, noRec = 0;
  const per = new Set();
  for (const t of teRows) {
    te += t.teMin || 0;
    hea += t.heaMin || 0;
    fin += t.finalesMin || 0;
    noRec += t.noReconocidasMin || 0;
    if ((t.teMin || 0) > 0) per.add(t.keyId);
  }
  return {
    hheeEjecH: te / 60,
    hheeAutH: hea / 60,
    hheeReconH: fin / 60,
    hheeNoReconH: noRec / 60,
    pctHHEERecon: te ? (fin / te) * 100 : 0,
    desviacionHHEEH: (hea - te) / 60,
    pctDesviacionHHEE: te ? ((hea - te) / te) * 100 : 0,
    personasHHEE: per.size,
  };
}

/** Sustituye las HHEE de un bloque de KPIs por las calculadas desde TE. */
function conHHEE(k, teRows) {
  return teRows ? { ...k, ...calcHHEE(teRows) } : k;
}

/** Serie temporal según granularidad. Si hay filas de TE, las HHEE salen de ellas. */
export function serieTemporal(filas, granularidad, cfg = DEFAULT_CONFIG, teRows = null) {
  const g = agrupar(filas, (f) => clavePeriodo(f, granularidad) || '?');
  const gt = teRows ? agrupar(teRows, (t) => clavePeriodo(t, granularidad) || '?') : null;
  const claves = new Set([...g.keys(), ...(gt ? gt.keys() : [])]);
  return [...claves].filter((k) => k !== '?').sort().map((k) => {
    const kp = calcKpis(g.get(k) || [], cfg);
    const hh = gt ? calcHHEE(gt.get(k) || []) : null;
    return {
      clave: k,
      periodo: formatearPeriodo(k, granularidad),
      tardanzas: kp.tardanzasDias,
      fugaH: kp.fugaH,
      diasNoPlan: kp.diasNoPlan,
      hheeH: hh ? hh.hheeEjecH : kp.hheeEjecH,
      pctAsistencia: kp.pctAsistencia,
      faltas: kp.faltasInjust,
      sinMarcacion: kp.diasSinMarcacion,
      pctTardanza: kp.pctTardanza,
    };
  });
}

// ---------------------------------------------------------------------------
// Anatomía de la jornada: las cuatro marcas del reloj (E1 · S1 · E2 · S2)
// ---------------------------------------------------------------------------
const CAMPOS_PUNTO = [
  ['E1', 'atrasoE1', 'Atraso de ingreso'],
  ['S1', 'adelantoS1', 'Salida anticipada a refrigerio'],
  ['E2', 'atrasoE2', 'Exceso de retorno de refrigerio'],
  ['S2', 'adelantoS2', 'Salida anticipada final'],
];

/** Estadísticas de cada punto de marcación sobre un conjunto de filas. */
export function puntosDe(rows) {
  const pres = rows.reduce((a, f) => a + (f.presente || 0), 0);
  return CAMPOS_PUNTO.map(([id, campo, nombre]) => {
    let dias = 0, total = 0, max = 0;
    const per = new Set();
    for (const f of rows) {
      const v = f[campo] || 0;
      if (v > 0) { dias++; total += v; if (v > max) max = v; per.add(f.keyId); }
    }
    return {
      id, nombre, punto: `${id} · ${nombre}`,
      dias, personas: per.size,
      pctPresentes: pres ? (dias / pres) * 100 : 0,
      minTotales: total, promedio: dias ? total / dias : 0, maximo: max,
    };
  });
}

function mediana(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function aMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  return m ? +m[1] * 60 + +m[2] : null;
}

/** Turno típico (mediana de inicio, fin y refrigerio de los turnos programados). */
export function turnoTipico(rows) {
  const ini = [], fin = [], ref = [];
  for (const f of rows) {
    if (f.tipoTurno !== 'Turno programado') continue;
    const a = aMin(f.inicioTurno), b = aMin(f.finTurno);
    if (a == null || b == null) continue;
    ini.push(a);
    fin.push(b <= a ? b + 1440 : b);
    ref.push(f.refrigerioProgMin || 0);
  }
  if (!ini.length) return null;
  return { inicio: mediana(ini), fin: mediana(fin), refrigerio: mediana(ref), n: ini.length };
}

function hhmmDe(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Clave de la malla horaria de un día: inicio–fin del turno programado y
 * minutos de refrigerio ("09:00-18:00|60"). Vacía si el día no tiene turno.
 */
export function claveMalla(f) {
  if (f.tipoTurno !== 'Turno programado') return '';
  const a = aMin(f.inicioTurno), b = aMin(f.finTurno);
  if (a == null || b == null) return '';
  return `${hhmmDe(a)}-${hhmmDe(b)}|${f.refrigerioProgMin || 0}`;
}

/**
 * Mallas horarias: los horarios que se repiten en un conjunto de filas, del
 * más frecuente al menos, cada uno con sus cuatro marcas del reloj.
 */
export function mallasDe(rows) {
  const grupos = new Map();
  for (const f of rows) {
    const k = claveMalla(f);
    if (!k) continue;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(f);
  }
  const total = [...grupos.values()].reduce((s, g) => s + g.length, 0);
  return [...grupos.entries()].map(([id, g]) => {
    const inicio = aMin(g[0].inicioTurno);
    const finRaw = aMin(g[0].finTurno);
    const fin = finRaw <= inicio ? finRaw + 1440 : finRaw;
    const refrigerio = g[0].refrigerioProgMin || 0;
    const presentes = g.reduce((s, f) => s + (f.presente || 0), 0);
    const tard = g.reduce((s, f) => s + (f.tardanza || 0), 0);
    return {
      id, inicio, fin, refrigerio,
      etiqueta: `${hhmmDe(inicio)}–${hhmmDe(fin)}`,
      horas: (fin - inicio - refrigerio) / 60,
      dias: g.length,
      personas: new Set(g.map((f) => f.keyId)).size,
      pctDias: total ? (g.length / total) * 100 : 0,
      fugaMin: g.reduce((s, f) => s + (f.fugaMin || 0), 0),
      pctTardanza: presentes ? (tard / presentes) * 100 : 0,
      puntos: puntosDe(g),
    };
  }).sort((x, y) => y.dias - x.dias || x.inicio - y.inicio);
}

function anatomiaDe(rows) {
  return { turno: turnoTipico(rows), puntos: puntosDe(rows), mallas: mallasDe(rows) };
}

// ---------------------------------------------------------------------------
// Malla: mapa de calor sucursal × período
// ---------------------------------------------------------------------------
function mallaCalor(base, granularidad, sucursales) {
  const idxS = new Map(sucursales.map((s, i) => [s, i]));
  const claves = [...new Set(base.map((f) => clavePeriodo(f, granularidad)).filter(Boolean))].sort();
  const idxP = new Map(claves.map((k, j) => [k, j]));
  const cel = new Map();
  for (const f of base) {
    const i = idxS.get(f.sucursal);
    const j = idxP.get(clavePeriodo(f, granularidad));
    if (i == null || j == null) continue;
    const key = i * 100000 + j;
    let c = cel.get(key);
    if (!c) { c = { i, j, esp: 0, pres: 0, incid: 0, tard: 0, fugaMin: 0, noPlan: 0 }; cel.set(key, c); }
    c.esp += f.diaEsperado;
    c.pres += f.presente;
    c.tard += f.tardanza;
    c.fugaMin += f.fugaMin;
    c.noPlan += f.trabajoSinTurno;
    if (f.estadoDia === 'Falta injustificada' || f.estadoDia === 'Sin marcación' || f.estadoDia === 'Marcación incompleta') c.incid++;
  }
  return {
    periodos: claves.map((k) => ({ clave: k, label: formatearPeriodo(k, granularidad) })),
    sucursales,
    celdas: [...cel.values()],
  };
}

// ---------------------------------------------------------------------------
// Armado completo del dashboard (se llama desde el worker)
// ---------------------------------------------------------------------------
/**
 * @param {Array} filas     filas persona-día de asistencia
 * @param {object} filtros
 * @param {object} cfg
 * @param {Array|null} teFilas filas de Tiempo Extra enriquecidas; si se pasan, las
 *   HHEE salen de ellas (incluye días sin fila de asistencia).
 */
export function construirDashboard(filas, filtros, cfg = DEFAULT_CONFIG, teFilas = null) {
  const gran = filtros.granularidad || 'dia';
  const base = filtrar(filas, filtros);
  const teBase = teFilas ? filtrar(teFilas, filtros) : null;
  const kpis = conHHEE(calcKpis(base, cfg), teBase);

  // Comparación con período anterior (requiere un rango de fechas).
  let kpisPrev = null;
  let rangoPrevio = null;
  if (filtros.comparar) {
    const prev = periodoAnterior(filtros.fechaDesde, filtros.fechaHasta);
    if (prev) {
      rangoPrevio = prev;
      kpisPrev = conHHEE(
        calcKpis(filtrar(filas, { ...filtros, ...prev }), cfg),
        teFilas ? filtrar(teFilas, { ...filtros, ...prev }) : null
      );
    }
  }

  // Por sucursal (asistencia + HHEE desde TE; incluye sucursales solo con TE).
  const teSuc = teBase ? agrupar(teBase, (t) => t.sucursal) : null;
  const mapa = new Map();
  for (const g of kpisPorGrupo(base, 'sucursal', cfg)) {
    mapa.set(g.clave, { sucursal: g.clave, ...conHHEE(g.kpis, teSuc ? teSuc.get(g.clave) || [] : null) });
  }
  if (teSuc) {
    for (const [suc, rows] of teSuc) {
      if (mapa.has(suc)) continue;
      const k = conHHEE(calcKpis([], cfg), rows);
      k.personas = new Set(rows.map((r) => r.keyId)).size;
      mapa.set(suc, { sucursal: suc, ...k });
    }
  }
  const porSuc = [...mapa.values()].filter((s) => s.personas > 0).sort((a, b) => b.personas - a.personas);

  const desc = (campo) => [...porSuc].sort((a, b) => b[campo] - a[campo]);
  const conHH = porSuc.filter((s) => s.hheeEjecH > 0 || s.hheeAutH > 0);

  const graficos = {
    asistencia: porSuc.filter((s) => s.sumDiaEsperado > 0).sort((a, b) => a.pctAsistencia - b.pctAsistencia)
      .map((s) => ({ sucursal: s.sucursal, valor: s.pctAsistencia, personas: s.personas, presentes: s.sumPresente, esperados: s.sumDiaEsperado })),
    noPlan: desc('diasNoPlan').filter((s) => s.diasNoPlan > 0)
      .map((s) => ({ sucursal: s.sucursal, valor: s.diasNoPlan, badge: s.trabajadoresNoPlan })),
    malla: porSuc.filter((s) => s.sumTrabajo > 0).sort((a, b) => a.pctMalla - b.pctMalla)
      .map((s) => ({ sucursal: s.sucursal, valor: s.pctMalla })),
    justificaciones: desc('diasJustificacion').filter((s) => s.diasJustificacion > 0)
      .map((s) => ({ sucursal: s.sucursal, valor: s.diasJustificacion })),
    justHoras: porSuc.filter((s) => s.minAtrasoJustH + s.minSalidaJustH > 0)
      .sort((a, b) => b.minAtrasoJustH + b.minSalidaJustH - (a.minAtrasoJustH + a.minSalidaJustH))
      .map((s) => ({ sucursal: s.sucursal, a: s.minAtrasoJustH, b: s.minSalidaJustH })),
    tardanzas: desc('tardanzasDias').filter((s) => s.tardanzasDias > 0)
      .map((s) => ({ sucursal: s.sucursal, valor: s.tardanzasDias, badge: s.personasTardanza, pct: s.pctTardanza })),
    fuga: desc('fugaH').filter((s) => s.fugaH > 0)
      .map((s) => ({ sucursal: s.sucursal, a: s.tardanzaH, b: s.salidaAntH })),
    hhee: [...conHH].sort((a, b) => b.hheeEjecH - a.hheeEjecH)
      .map((s) => ({ sucursal: s.sucursal, ejecutadas: s.hheeEjecH, aprobadas: s.hheeAutH, cumplidas: s.hheeReconH })),
    brecha: [...conHH].sort((a, b) => a.desviacionHHEEH - b.desviacionHHEEH)
      .map((s) => ({ sucursal: s.sucursal, valor: s.desviacionHHEEH })),
    marcacion: {
      completa: kpis.marcacionCompleta,
      incompleta: kpis.marcacionIncompleta,
      sinMarcacion: kpis.diasSinMarcacion,
      faltaInjust: kpis.faltasInjust,
    },
    tendencia: serieTemporal(base, gran, cfg, teBase),
    malla_calor: mallaCalor(base, gran, porSuc.map((s) => s.sucursal)),
  };

  // Anatomía de la jornada (global y por sucursal).
  const anatomia = { global: anatomiaDe(base), porSucursal: {} };
  for (const [suc, rows] of agrupar(base, (f) => f.sucursal)) anatomia.porSucursal[suc] = anatomiaDe(rows);

  // Top 10 colaboradores por fuga de tiempo.
  const porPersona = new Map();
  for (const f of base) {
    let p = porPersona.get(f.keyId);
    if (!p) {
      p = { keyId: f.keyId, nombre: f.nombre, sucursal: f.sucursal, jefe: f.jefe, cargo: f.cargoOficial, tardanzas: 0, minTardanza: 0, minSalida: 0, fugaMin: 0 };
      porPersona.set(f.keyId, p);
    }
    p.tardanzas += f.tardanza;
    p.minTardanza += f.atrasoE1;
    p.minSalida += f.adelantoS2;
    p.fugaMin += f.fugaMin;
  }
  const topColaboradores = [...porPersona.values()].filter((p) => p.fugaMin > 0)
    .sort((a, b) => b.fugaMin - a.fugaMin).slice(0, 10)
    .map((p) => ({ ...p, fugaH: p.fugaMin / 60, tardanzaH: p.minTardanza / 60, salidaH: p.minSalida / 60 }));

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
    rangoPrevio,
    porSucursal: porSuc,
    graficos,
    anatomia,
    diagnostico,
    topColaboradores,
    puntos: puntosDe(base),
    nFilas: base.length,
    nFilasTE: teBase ? teBase.length : 0,
  };
}

// ---------------------------------------------------------------------------
// Drill-down: trabajadores detrás de un gráfico, una barra o un KPI
// ---------------------------------------------------------------------------
const esCompleta = (f) => typeof f.tipoMarcacion === 'string' && f.tipoMarcacion.startsWith('Completa');

/** Catálogo de métricas del drill-down: qué fila cuenta como evento. */
export const METRICAS_DRILL = {
  personas: { titulo: 'Personas en el filtro', pred: () => true, todos: true },
  fiscalizables: { titulo: 'Personas fiscalizadas', pred: (f) => f.fiscalizacion === 'Fiscalizado', todos: true },
  noFiscalizables: { titulo: 'Personas no fiscalizadas', pred: (f) => f.fiscalizacion !== 'Fiscalizado', todos: true },
  asistencia: { titulo: 'Asistencia', pred: (f) => f.diaEsperado === 1, orden: 'pctAsistencia', asc: true, evento: 'Días esperados' },
  incidencias: {
    titulo: 'Incidencias de asistencia',
    pred: (f) => f.estadoDia === 'Falta injustificada' || f.estadoDia === 'Sin marcación' || f.estadoDia === 'Marcación incompleta',
    evento: 'Días con incidencia',
  },
  faltas: { titulo: 'Faltas injustificadas', pred: (f) => f.estadoDia === 'Falta injustificada', evento: 'Faltas' },
  sinMarcacion: { titulo: 'Días sin marcación', pred: (f) => f.estadoDia === 'Sin marcación', evento: 'Días sin marcación' },
  marcIncompleta: { titulo: 'Marcación incompleta', pred: (f) => f.nMarcaciones > 0 && !esCompleta(f), evento: 'Días incompletos' },
  marcCompleta: { titulo: 'Marcación completa', pred: (f) => esCompleta(f), evento: 'Días completos' },
  noPlan: { titulo: 'Días no planificados', pred: (f) => f.trabajoSinTurno === 1, evento: 'Días sin turno' },
  tardanzas: { titulo: 'Tardanzas (E1)', pred: (f) => f.tardanza === 1, min: (f) => f.atrasoE1, evento: 'Tardanzas' },
  salidas: { titulo: 'Salidas anticipadas (S2)', pred: (f) => f.adelantoS2 > 0, min: (f) => f.adelantoS2, evento: 'Salidas anticipadas' },
  fuga: { titulo: 'Fuga de tiempo', pred: (f) => f.fugaMin > 0, min: (f) => f.fugaMin, evento: 'Días con fuga' },
  justificaciones: { titulo: 'Justificaciones', pred: (f) => f.justificacionRegistrada === 'Sí', evento: 'Días justificados' },
  justAtraso: { titulo: 'Atrasos justificados', pred: (f) => f.minAtrasoJustificado > 0, min: (f) => f.minAtrasoJustificado, evento: 'Atrasos justificados' },
  justSalida: { titulo: 'Salidas justificadas', pred: (f) => f.minSalidaJustificada > 0, min: (f) => f.minSalidaJustificada, evento: 'Salidas justificadas' },
  E1: { titulo: 'E1 · Atraso de ingreso', pred: (f) => f.atrasoE1 > 0, min: (f) => f.atrasoE1, evento: 'Días' },
  S1: { titulo: 'S1 · Salida anticipada a refrigerio', pred: (f) => f.adelantoS1 > 0, min: (f) => f.adelantoS1, evento: 'Días' },
  E2: { titulo: 'E2 · Exceso de retorno de refrigerio', pred: (f) => f.atrasoE2 > 0, min: (f) => f.atrasoE2, evento: 'Días' },
  S2: { titulo: 'S2 · Salida anticipada final', pred: (f) => f.adelantoS2 > 0, min: (f) => f.adelantoS2, evento: 'Días' },
  manuales: { titulo: 'Marcas manuales', pred: (f) => f.marcasManuales > 0, evento: 'Días con marca manual' },
  exceso: { titulo: 'Exceso de refrigerio', pred: (f, cfg) => f.excesoRefrigerioMin !== null && f.excesoRefrigerioMin > cfg.toleranciaRefrigerioMin, min: (f) => f.excesoRefrigerioMin, evento: 'Días con exceso' },
  descanso: { titulo: 'Trabajó en descanso', pred: (f) => f.estadoDia === 'Trabajó en descanso', evento: 'Días' },
  feriado: { titulo: 'Trabajó en feriado', pred: (f) => f.trabajoFeriado === 1, evento: 'Feriados trabajados' },
  hhee: { titulo: 'Horas extra ejecutadas', te: true, pred: (t) => t.teMin > 0, min: (t) => t.teMin, evento: 'Días con HHEE' },
  hheeNoRec: { titulo: 'Horas extra no reconocidas', te: true, pred: (t) => t.noReconocidasMin > 0, min: (t) => t.noReconocidasMin, evento: 'Días con HHEE no reconocidas' },
  desviacion: { titulo: 'Brecha de horas extra', te: true, pred: (t) => t.teMin !== t.heaMin, min: (t) => t.teMin - t.heaMin, evento: 'Días con brecha' },
};

const LIMITE_DETALLE = 20000;

function fFecha(s) {
  return s && s.length === 8 ? `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}` : '';
}

/**
 * Lista de trabajadores (con su información) detrás de una selección.
 * @param {object} sel { metrica, sucursal?, periodo?, granularidad?, keyId?, malla? }
 * @returns {{titulo, personas, detalle, truncado, resumen}}
 */
export function construirDrill(filas, teFilas, filtros, sel, cfg = DEFAULT_CONFIG) {
  const m = METRICAS_DRILL[sel.metrica] || METRICAS_DRILL.personas;
  const gran = sel.granularidad || filtros.granularidad || 'dia';
  const enAlcance = (r) =>
    (!sel.sucursal || r.sucursal === sel.sucursal) &&
    (!sel.periodo || clavePeriodo(r, gran) === sel.periodo) &&
    (!sel.keyId || r.keyId === sel.keyId) &&
    (!sel.malla || claveMalla(r) === sel.malla);
  const base = filtrar(filas, filtros).filter(enAlcance);
  const teBase = (teFilas ? filtrar(teFilas, filtros) : []).filter(enAlcance);

  const fuente = m.te ? teBase : base;
  const eventos = fuente.filter((r) => m.pred(r, cfg));
  const porKey = new Map();
  for (const r of eventos) {
    const o = porKey.get(r.keyId) || { n: 0, min: 0 };
    o.n++;
    o.min += m.min ? m.min(r) || 0 : 0;
    porKey.set(r.keyId, o);
  }

  const nuevo = (r) => ({
    keyId: r.keyId, nombre: r.nombre, cargo: r.cargoOficial, jefe: r.jefe, sucursal: r.sucursal,
    dashboard: r.dashboard, jornada: r.jornada, campanero: r.campanero, sindicalizado: r.sindicalizado,
    fiscalizacion: r.fiscalizacion, modeloDias: r.modeloDias,
    diasEsperados: 0, presentes: 0, faltas: 0, sinMarcacion: 0, marcIncompleta: 0, noPlan: 0,
    tardanzas: 0, minTardanza: 0, salidas: 0, minSalida: 0, fugaMin: 0, minJustificados: 0,
    marcasManuales: 0, excesoRefrigerio: 0, trabajoDescanso: 0, feriadosTrabajados: 0,
    teMin: 0, heaMin: 0, finalesMin: 0, noRecMin: 0,
  });
  const per = new Map();
  const tol = cfg.toleranciaRefrigerioMin;
  for (const f of base) {
    if (!porKey.has(f.keyId)) continue;
    let p = per.get(f.keyId);
    if (!p) { p = nuevo(f); per.set(f.keyId, p); }
    p.diasEsperados += f.diaEsperado;
    p.presentes += f.presente;
    if (f.estadoDia === 'Falta injustificada') p.faltas++;
    if (f.estadoDia === 'Sin marcación') p.sinMarcacion++;
    if (f.nMarcaciones > 0 && !esCompleta(f)) p.marcIncompleta++;
    p.noPlan += f.trabajoSinTurno;
    p.tardanzas += f.tardanza;
    p.minTardanza += f.atrasoE1;
    if (f.adelantoS2 > 0) p.salidas++;
    p.minSalida += f.adelantoS2;
    p.fugaMin += f.fugaMin;
    p.minJustificados += f.minAtrasoJustificado + f.minSalidaJustificada;
    p.marcasManuales += f.marcasManuales;
    if (f.excesoRefrigerioMin !== null && f.excesoRefrigerioMin > tol) p.excesoRefrigerio++;
    if (f.estadoDia === 'Trabajó en descanso') p.trabajoDescanso++;
    p.feriadosTrabajados += f.trabajoFeriado;
  }
  for (const t of teBase) {
    if (!porKey.has(t.keyId)) continue;
    let p = per.get(t.keyId);
    if (!p) { p = nuevo(t); per.set(t.keyId, p); }
    p.teMin += t.teMin;
    p.heaMin += t.heaMin;
    p.finalesMin += t.finalesMin;
    p.noRecMin += t.noReconocidasMin;
  }

  const personas = [...per.values()].map((p) => {
    const ev = porKey.get(p.keyId);
    return {
      ...p,
      eventos: ev.n,
      minEvento: ev.min,
      pctAsistencia: p.diasEsperados ? (p.presentes / p.diasEsperados) * 100 : null,
      fugaH: p.fugaMin / 60,
      hheeEjecH: p.teMin / 60,
      hheeAprobH: p.heaMin / 60,
      hheeCumplH: p.finalesMin / 60,
      hheeNoRecH: p.noRecMin / 60,
      desviacionH: (p.heaMin - p.teMin) / 60,
    };
  });
  if (m.orden) {
    personas.sort((a, b) => ((a[m.orden] ?? 0) - (b[m.orden] ?? 0)) * (m.asc ? 1 : -1));
  } else {
    personas.sort((a, b) => b.eventos - a.eventos || Math.abs(b.minEvento) - Math.abs(a.minEvento) || a.nombre.localeCompare(b.nombre));
  }

  // Detalle por día (los eventos; en las métricas de personas, todos sus días), ordenado por fecha.
  const detalle = eventos
    .slice()
    .sort((a, b) => (a.yyyymmdd < b.yyyymmdd ? -1 : a.yyyymmdd > b.yyyymmdd ? 1 : a.nombre.localeCompare(b.nombre)))
    .slice(0, LIMITE_DETALLE)
    .map((r) => m.te
      ? {
          fecha: fFecha(r.yyyymmdd), keyId: r.keyId, nombre: r.nombre, sucursal: r.sucursal, turno: r.turno,
          ejecutadasH: +(r.teMin / 60).toFixed(2), aprobadasH: +(r.heaMin / 60).toFixed(2),
          cumplidasH: +(r.finalesMin / 60).toFixed(2), noReconocidasH: +(r.noReconocidasMin / 60).toFixed(2),
          conAsistencia: r.conAsistencia ? 'Sí' : 'No',
        }
      : {
          fecha: fFecha(r.yyyymmdd), dia: r.diaSemana, keyId: r.keyId, nombre: r.nombre, sucursal: r.sucursal,
          estadoDia: r.estadoDia, tipoTurno: r.tipoTurno,
          turno: r.inicioTurno ? `${r.inicioTurno}–${r.finTurno}` : '',
          entrada: r.primeraEntrada, salida: r.ultimaSalida, marcas: r.patronMarcacion,
          atrasoE1: r.atrasoE1, adelantoS1: r.adelantoS1, atrasoE2: r.atrasoE2, adelantoS2: r.adelantoS2,
          fugaMin: r.fugaMin, permiso: r.permiso, justificacion: r.justificacionRegistrada,
        });

  return {
    titulo: m.titulo,
    evento: m.evento || 'Días',
    esTE: !!m.te,
    sel,
    personas,
    detalle,
    truncado: eventos.length > LIMITE_DETALLE,
    resumen: {
      personas: personas.length,
      eventos: eventos.length,
      minutos: eventos.reduce((a, r) => a + (m.min ? m.min(r) || 0 : 0), 0),
    },
  };
}
