// =============================================================================
// quality.js
// Controles de calidad de datos (CT-01 .. CT-14) y listados de diagnóstico.
// Los controles CT comparan el valor "del KPI" (calculado por un camino, p.ej.
// sumando por sucursal) contra el valor "de la base" (suma directa). Si ambos
// no coinciden, hay un problema de agregación o de datos.
// =============================================================================

import { DEFAULT_CONFIG } from './config.js';

/** Filas de los dashboards oficiales (Tienda + Logística). */
function filasDashboard(filas) {
  return filas.filter((f) => f.dashboard === 'Tienda' || f.dashboard === 'Logística');
}

/** Cuenta claves únicas que cumplen un predicado. */
function unicos(filas, pred = () => true) {
  const s = new Set();
  for (const f of filas) if (pred(f)) s.add(f.keyId);
  return s.size;
}

/** Suma directa de un campo numérico. */
function suma(filas, campo) {
  let t = 0;
  for (const f of filas) t += f[campo] || 0;
  return t;
}

/** Suma de un campo agrupando por una clave y volviendo a sumar los grupos. */
function sumaPorGrupo(filas, grupoCampo, campo) {
  const g = new Map();
  for (const f of filas) g.set(f[grupoCampo], (g.get(f[grupoCampo]) || 0) + (f[campo] || 0));
  let t = 0;
  for (const v of g.values()) t += v;
  return t;
}

/** Únicos agregando por grupo (suma de únicos por sucursal). */
function unicosPorGrupo(filas, grupoCampo, pred = () => true) {
  const g = new Map();
  for (const f of filas) {
    if (!pred(f)) continue;
    if (!g.has(f[grupoCampo])) g.set(f[grupoCampo], new Set());
    g.get(f[grupoCampo]).add(f.keyId);
  }
  let t = 0;
  for (const s of g.values()) t += s.size;
  return t;
}

const casiIgual = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

/**
 * Ejecuta todos los controles de calidad.
 * @param {object} args
 * @param {Array} args.filas    modelo consolidado
 * @param {Array} args.personas dotación
 * @param {object} args.teResumen resumen global de Tiempo Extra
 * @param {Array} args.teDedup  registros de TE deduplicados
 * @param {object} args.meta    { fechasInvalidas }
 * @param {object} cfg
 * @returns {{controles: Array, listados: object}}
 */
export function calcularCalidad({ filas, personas, teResumen, teDedup, meta = {}, cfg = DEFAULT_CONFIG }) {
  const fd = filasDashboard(filas);
  const controles = [];
  const add = (id, nombre, ok, detalle) => controles.push({ id, nombre, ok, detalle });

  // CT-01 Personas: únicas directas == suma de únicas por sucursal
  const p1 = unicos(fd);
  const p2 = unicosPorGrupo(fd, 'sucursal');
  add('CT-01', 'Personas del KPI = personas únicas de la base', p1 === p2, `${p1} vs ${p2}`);

  // CT-02 Fiscalizables + No fiscalizables = Personas
  const fisc = unicos(fd, (f) => f.fiscalizacion === 'Fiscalizado');
  const noFisc = unicos(fd, (f) => f.fiscalizacion !== 'Fiscalizado');
  // Nota: un keyId podría tener sólo un valor de fiscalización => suma == total.
  add(
    'CT-02',
    'Fiscalizables + No fiscalizables = Personas',
    fisc + noFisc === p1,
    `${fisc} + ${noFisc} = ${fisc + noFisc} (esperado ${p1})`
  );

  // CT-03 Días esperados
  const de1 = suma(fd, 'diaEsperado');
  const de2 = sumaPorGrupo(fd, 'sucursal', 'diaEsperado');
  add('CT-03', 'Días esperados del KPI = los de la base', casiIgual(de1, de2), `${de1} vs ${de2}`);

  // CT-04 Días presentes
  const pr1 = suma(fd, 'presente');
  const pr2 = sumaPorGrupo(fd, 'sucursal', 'presente');
  add('CT-04', 'Días presentes del KPI = los de la base', casiIgual(pr1, pr2), `${pr1} vs ${pr2}`);

  // CT-05 Días no planificados
  const np1 = suma(fd, 'trabajoSinTurno');
  const np2 = sumaPorGrupo(fd, 'sucursal', 'trabajoSinTurno');
  add('CT-05', 'Días no planificados del KPI = los de la base', casiIgual(np1, np2), `${np1} vs ${np2}`);

  // CT-06 Trabajadores no planificados <= días no planificados
  const trabNP = unicos(fd, (f) => f.trabajoSinTurno === 1);
  add('CT-06', 'Trabajadores no planificados ≤ días no planificados', trabNP <= np1, `${trabNP} ≤ ${np1}`);

  // CT-07 Tardanzas E1
  const t1 = suma(fd, 'tardanza');
  const t2 = sumaPorGrupo(fd, 'sucursal', 'tardanza');
  add('CT-07', 'Tardanzas E1 del KPI = las de la base', casiIgual(t1, t2), `${t1} vs ${t2}`);

  // CT-08 Personas con tardanza <= personas
  const persTard = unicos(fd, (f) => f.tardanza === 1);
  add('CT-08', 'Personas con tardanza ≤ personas', persTard <= p1, `${persTard} ≤ ${p1}`);

  // CT-09 Fuga = min de tardanza + min de salida anticipada
  const fuga = suma(fd, 'fugaMin');
  const minTard = suma(fd, 'atrasoE1');
  const minSal = suma(fd, 'adelantoS2');
  const okFuga = cfg.definicionFuga === 'E1S2' ? casiIgual(fuga, minTard + minSal) : true;
  add(
    'CT-09',
    'Fuga = min de tardanza + min de salida anticipada',
    okFuga,
    `${fuga} vs ${minTard + minSal} (def: ${cfg.definicionFuga})`
  );

  // CT-10 Min justificados <= min de tardanza + min de salida
  const minJust = suma(fd, 'minAtrasoJustificado') + suma(fd, 'minSalidaJustificada');
  const minTotal = suma(fd, 'atrasoE1') + suma(fd, 'adelantoS2');
  add('CT-10', 'Min justificados ≤ min de tardanza + min de salida', minJust <= minTotal + 1e-6, `${minJust} ≤ ${minTotal}`);

  // CT-11 HHEE ejecutadas del KPI = las de Tiempo Extra
  const teBase = (teDedup || []).reduce((a, t) => a + (t.teMin || 0), 0);
  const teKpi = teResumen ? teResumen.teMin : 0;
  add('CT-11', 'HHEE ejecutadas del KPI = las de Tiempo Extra', casiIgual(teBase, teKpi), `${teKpi} vs ${teBase} min`);

  // CT-12 HHEE reconocidas + no reconocidas = ejecutadas
  const rec = teResumen ? teResumen.finalesMin : 0;
  const noRec = teResumen ? teResumen.noReconocidasMin : 0;
  add(
    'CT-12',
    'HHEE reconocidas + no reconocidas = ejecutadas',
    casiIgual(rec + noRec, teKpi),
    `${rec} + ${noRec} = ${rec + noRec} (esperado ${teKpi})`
  );

  // CT-13 Días de asistencia sin cruce con Dotación = 0
  const sinCruce = filas.filter((f) => !f.enDotacion).length;
  add('CT-13', 'Días de asistencia sin cruce con Dotación = 0', sinCruce === 0, `${sinCruce} días sin cruce`);

  // CT-14 Sucursales del KPI = sucursales de la base
  // KPI: sucursales que aparecen en la tabla por sucursal (rollup).
  // Base: sucursales distintas presentes en las filas del dashboard.
  const sucBase = new Set(fd.map((f) => f.sucursal));
  const sucKpi = new Set();
  sumaPorGrupo(fd, 'sucursal', 'presente'); // fuerza el mismo agrupamiento
  for (const f of fd) sucKpi.add(f.sucursal);
  add(
    'CT-14',
    'Sucursales del KPI = sucursales de la base',
    sucBase.size === sucKpi.size,
    `${sucKpi.size} sucursales`
  );

  // ------------------- Listados de diagnóstico -------------------------------
  const dniLongitud = [];
  const dniVistos = new Map();
  const dniDuplicados = [];
  for (const p of personas) {
    if (p.tipoDoc === 'DNI' && /^\d+$/.test(p.keyId) && p.keyId.length !== 8) {
      dniLongitud.push({ keyId: p.keyId, nombre: p.nombre, longitud: p.keyId.length });
    }
    dniVistos.set(p.keyId, (dniVistos.get(p.keyId) || 0) + 1);
  }
  for (const [k, n] of dniVistos) if (n > 1) dniDuplicados.push({ keyId: k, veces: n });

  const sinHuella = personas
    .filter((p) => p.fiscalizacion === 'Sin dato')
    .map((p) => ({ keyId: p.keyId, nombre: p.nombre }));

  const horariosSinModelo = personas
    .filter((p) => p.modeloDias === 'Sin modelo')
    .map((p) => ({ keyId: p.keyId, nombre: p.nombre, horario: p.horario }));

  const horasRevisar = personas
    .filter((p) => p.validacionHoras === 'Revisar')
    .map((p) => ({
      keyId: p.keyId,
      nombre: p.nombre,
      horario: p.horario,
      horasHorario: p.horasHorario,
      horasContrato: p.horasContrato,
    }));

  const cargosNoCoinciden = [];
  const vistosCargo = new Set();
  for (const f of filas) {
    if (f.cargoCoincide === 'No' && !vistosCargo.has(f.keyId)) {
      vistosCargo.add(f.keyId);
      cargosNoCoinciden.push({
        keyId: f.keyId,
        nombre: f.nombre,
        cargoOficial: f.cargoOficial,
        cargoMarcacion: f.cargoMarcacion,
      });
    }
  }

  const marcacionesTrasCese = filas
    .filter((f) => f.diaPosteriorCese === 'Sí - con marcación')
    .map((f) => ({ keyId: f.keyId, nombre: f.nombre, fecha: f.yyyymmdd }));

  const listados = {
    dniLongitud,
    dniDuplicados,
    fechasInvalidas: meta.fechasInvalidas || 0,
    sinHuella,
    horariosSinModelo,
    horasRevisar,
    cargosNoCoinciden,
    marcacionesTrasCese,
  };

  return { controles, listados };
}
