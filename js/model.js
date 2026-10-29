// =============================================================================
// model.js
// Construye el modelo de datos consolidado:
//  - Deduplica asistencia y tiempo extra por keyDia (gana el más reciente).
//  - Cruza Asistencia <- Dotación por keyId.
//  - Cruza Tiempo Extra <- Dotación por keyId y <-> Asistencia por keyDia.
//  - Calcula los indicadores derivados por persona-día.
// =============================================================================

import { DEFAULT_CONFIG } from './config.js';
import { normText, semanaISO, mesClave } from './parsers/common.js';

/**
 * Deduplica registros por keyDia conservando el del lote más reciente.
 * Cada registro debe traer `_lote` (número incremental; mayor = más reciente).
 * @param {Array} registros
 * @returns {Array}
 */
export function dedupPorKeyDia(registros) {
  const porKey = new Map();
  for (const reg of registros) {
    const prev = porKey.get(reg.keyDia);
    if (!prev || (reg._lote || 0) >= (prev._lote || 0)) {
      porKey.set(reg.keyDia, reg);
    }
  }
  return [...porKey.values()];
}

/**
 * Construye el modelo consolidado.
 * @param {object} args
 * @param {Array} args.personas   dotación parseada
 * @param {Array} args.asistencia registros de asistencia (con _lote)
 * @param {Array} args.tiempoExtra registros de TE (con _lote)
 * @param {object} args.cfg
 * @returns {{filas: Array, dotacionMap: Map, teResumen: object}}
 */
export function construirModelo({ personas, asistencia, tiempoExtra, cfg = DEFAULT_CONFIG }) {
  // Índice de dotación por keyId.
  const dotacionMap = new Map();
  for (const p of personas) dotacionMap.set(p.keyId, p);

  // Dedup
  const asisDedup = dedupPorKeyDia(asistencia);
  const teDedup = dedupPorKeyDia(tiempoExtra);

  // Índice de TE por keyDia (para poder cruzar con asistencia del día).
  const tePorKeyDia = new Map();
  for (const te of teDedup) tePorKeyDia.set(te.keyDia, te);

  const filas = [];
  for (const a of asisDedup) {
    const dot = dotacionMap.get(a.keyId) || null;

    // Atributos de dotación (o marcadores de "No está en Dotación").
    const sucursal = dot ? dot.sucursal : 'No está en Dotación';
    const grupoUbic = dot ? dot.grupoUbic : '';
    const dashboard = dot ? dot.dashboard : 'No está en Dotación';
    const campanero = dot ? dot.campanero : '';
    const fiscalizacion = dot ? dot.fiscalizacion : 'Sin dato';
    const jornada = dot ? dot.jornada : '';
    const calendario = dot ? dot.calendario : '';
    const estado = dot ? dot.estado : '';
    const horario = dot ? dot.horario : '';
    const modeloDias = dot ? dot.modeloDias : '';
    const diasLaborablesSemana = dot ? dot.diasLaborablesSemana : null;
    const ambito = dot ? dot.ambito : '';
    const tipoContrato = dot ? dot.tipoContrato : '';
    const sindicalizado = dot ? dot.sindicalizado : '';
    const jefe = dot ? dot.jefe : '';
    const cargoOficial = dot ? dot.cargo : '';
    const fechaCese = dot ? dot.fechaCese : null;
    const fechaPuesto = dot ? dot.fechaPuesto : null;

    // --- Columnas de control --------------------------------------------------
    const cargoCoincide = dot
      ? normText(cargoOficial) === normText(a.cargoMarcacion)
        ? 'Sí'
        : 'No'
      : '';

    // diaPosteriorCese
    let diaPosteriorCese = 'No';
    if (fechaCese && a.fecha > fechaCese) {
      diaPosteriorCese = a.nMarcaciones > 0 ? 'Sí - con marcación' : 'Sí - sin marcación';
    }
    // diaAntesPuesto
    const diaAntesPuesto = fechaPuesto && a.fecha < fechaPuesto ? 'Sí' : 'No';

    // --- Indicadores derivados por persona-día --------------------------------
    const estadoDia = a.estadoDia;

    let diaEsperado =
      estadoDia === 'Asistió' ||
      estadoDia === 'Falta injustificada' ||
      estadoDia === 'Sin marcación' ||
      estadoDia === 'Marcación incompleta'
        ? 1
        : 0;
    // Exclusión de días fuera del período de empleo (parámetro).
    if (cfg.excluirDiasAntesPuesto && diaAntesPuesto === 'Sí') diaEsperado = 0;
    if (cfg.excluirDiasPosterioresCese && diaPosteriorCese !== 'No') diaEsperado = 0;

    const presente = estadoDia === 'Asistió' || estadoDia === 'Marcación incompleta' ? 1 : 0;

    const trabajo =
      a.nMarcaciones > 0 && diaAntesPuesto === 'No' && diaPosteriorCese.startsWith('No') ? 1 : 0;

    const trabajoSinTurno =
      trabajo === 1 &&
      !['Turno programado', 'Descanso', 'Presencial', 'Horario Libre'].includes(a.tipoTurno)
        ? 1
        : 0;

    const tardanza = a.atrasoE1 > 0 && diaAntesPuesto === 'No' ? 1 : 0;

    const minAtrasoJustificado = a.justE1Texto ? a.atrasoE1 : 0;
    const minSalidaJustificada = a.justS2Texto ? a.adelantoS2 : 0;

    const fugaMin =
      cfg.definicionFuga === '4marcas'
        ? a.atrasoE1 + a.adelantoS1 + a.atrasoE2 + a.adelantoS2
        : a.atrasoE1 + a.adelantoS2;

    const trabajoFeriado = a.feriado === 'Sí' && trabajo === 1 ? 1 : 0;

    // Tiempo
    const sem = a.fecha ? semanaISO(a.fecha) : '';
    const mes = a.fecha ? mesClave(a.fecha) : '';
    const anio = a.fecha ? a.fecha.getFullYear() : null;

    // Cruce con TE del día (opcional).
    const te = tePorKeyDia.get(a.keyDia) || null;

    filas.push({
      // llaves e identidad
      keyId: a.keyId,
      keyDia: a.keyDia,
      nombre: a.nombre,
      // dotación (vigente hoy)
      sucursal,
      grupoUbic,
      dashboard,
      campanero,
      fiscalizacion,
      jornada,
      calendario,
      estado,
      horario,
      modeloDias,
      diasLaborablesSemana,
      ambito,
      tipoContrato,
      sindicalizado,
      jefe,
      cargoOficial,
      enDotacion: !!dot,
      // control
      cargoCoincide,
      diaPosteriorCese,
      diaAntesPuesto,
      // asistencia (campos base)
      fecha: a.fecha,
      yyyymmdd: a.yyyymmdd,
      diaSemana: a.diaSemana,
      feriado: a.feriado,
      semana: sem,
      mes,
      anio,
      categoriaPermiso: a.categoriaPermiso,
      tipoTurno: a.tipoTurno,
      estadoDia,
      tipoMarcacion: a.tipoMarcacion,
      nMarcaciones: a.nMarcaciones,
      marcasManuales: a.marcasManuales,
      atrasoE1: a.atrasoE1,
      adelantoS1: a.adelantoS1,
      atrasoE2: a.atrasoE2,
      adelantoS2: a.adelantoS2,
      atrasoTotal: a.atrasoTotal,
      salidaAnticipadaTotal: a.salidaAnticipadaTotal,
      rangoAtrasoE1: a.rangoAtrasoE1,
      justificacionRegistrada: a.justificacionRegistrada,
      refrigerioRealMin: a.refrigerioRealMin,
      excesoRefrigerioMin: a.excesoRefrigerioMin,
      incidenciaHorario: a.incidenciaHorario,
      heaMin: a.heaMin,
      hecMin: a.hecMin,
      hntMin: a.hntMin,
      htMin: a.htMin,
      cargoMarcacion: a.cargoMarcacion,
      // indicadores derivados
      diaEsperado,
      presente,
      trabajo,
      trabajoSinTurno,
      tardanza,
      minAtrasoJustificado,
      minSalidaJustificada,
      fugaMin,
      trabajoFeriado,
      // tiempo extra del día (si existe)
      teMin: te ? te.teMin : 0,
      teHeaMin: te ? te.heaMin : 0,
      teFinalesMin: te ? te.finalesMin : 0,
      teNoReconocidasMin: te ? te.noReconocidasMin : 0,
    });
  }

  // Resumen global de TE (todo, aunque no cruce con un día de asistencia).
  const teResumen = teDedup.reduce(
    (acc, t) => {
      acc.teMin += t.teMin;
      acc.heaMin += t.heaMin;
      acc.finalesMin += t.finalesMin;
      acc.noReconocidasMin += t.noReconocidasMin;
      return acc;
    },
    { teMin: 0, heaMin: 0, finalesMin: 0, noReconocidasMin: 0 }
  );

  return { filas, dotacionMap, teDedup, teResumen };
}
