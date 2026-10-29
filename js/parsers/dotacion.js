// =============================================================================
// parsers/dotacion.js
// Parser de la Dotación (foto actual del personal; 1 fila por persona).
// PRIVACIDAD: sólo se leen las columnas listadas en la especificación. NUNCA
// se leen ni guardan cuentas bancarias, CTS, montos, correos, celulares,
// fecha de nacimiento, estado civil ni discapacidad.
// =============================================================================

import {
  normHeader,
  normText,
  normalizeKeyId,
  parseFechaGenerica,
  toNum,
  encontrarFilaEncabezado,
  indiceColumna,
} from './common.js';
import { DEFAULT_CONFIG } from '../config.js';

// Encabezados origen -> campo interno. Se mapea SIEMPRE por nombre.
const MAPA = {
  tipoDoc: 'Tipo de documento',
  keyId: 'Nº de documento',
  nombre: 'Nombres + Primer apellido',
  cargo: 'Nombre del cargo',
  sucursal: 'Nombre de Ubicación',
  grupoUbic: 'Grupo de ubicación',
  fechaCese: 'Fecha de terminación',
  tipoContrato: 'Tipo de contrato',
  areaSindicato: 'Área escala remuneración (Sindicato)',
  exigeHuella: 'Exije huella',
  calendario: 'Calendario de festivos',
  horario: 'Horario de trabajo',
  horasContrato: 'Horas semanales contractuales',
  jefe: 'Jefe Directo',
  fechaPuesto: 'Fecha de entrada en el puesto',
};

/** ¿Estos encabezados corresponden a Dotación? */
export function esDotacion(headers) {
  const set = new Set(headers.map(normHeader));
  const has = (h) => {
    const n = normHeader(h);
    return [...set].some((c) => c.includes(n) || n.includes(c));
  };
  return has('Nº de documento') && has('Grupo de ubicación');
}

/**
 * Deriva los campos del horario de trabajo.
 * @param {string} horario  ej "FALABELLA - FULL TIME TIENDA 48 HORAS 5X2"
 * @param {number} horasContrato
 * @param {string} jornada
 */
export function derivarHorario(horario, horasContrato, jornada) {
  const h = horario || '';
  const hu = h.toUpperCase();

  // modalidadHorario
  let modalidadHorario = '';
  if (hu.includes('FULL TIME')) modalidadHorario = 'Full Time';
  else if (hu.includes('PART TIME')) modalidadHorario = 'Part Time';
  else if (hu.includes('PRACTICANTE PRE')) modalidadHorario = 'Practicante Pre';
  else if (hu.includes('PRACTICANTE PROFESIONAL')) modalidadHorario = 'Practicante Profesional';

  // modeloDias: patrón "\d X \d" sin espacios (5X2, 4X3, 6X1, 3X4, 2X5)
  const mModelo = hu.replace(/\s+/g, '').match(/(\d)X(\d)/);
  const modeloDias = mModelo ? `${mModelo[1]}X${mModelo[2]}` : 'Sin modelo';
  const diasLaborablesSemana = mModelo ? parseInt(mModelo[1], 10) : null;

  // ambito según palabras clave
  let ambito = '';
  if (hu.includes('TIENDA NOCTURNO') || hu.includes('NOCTURNO')) ambito = 'Tienda Nocturno';
  else if (hu.includes('TIENDA')) ambito = 'Tienda';
  else if (hu.includes('CORPORACION') || hu.includes('CORPORACIÓN')) ambito = 'Corporación';
  else if (hu.includes('HOME DELIVERY')) ambito = 'Home Delivery';
  else if (hu.includes('FALABELLA.COM') || hu.includes('.COM')) ambito = 'Falabella.com';

  // horasHorario: número antes de "HORAS"
  const mHoras = hu.match(/(\d+(?:[.,]\d+)?)\s*HORAS/);
  const horasHorario = mHoras ? toNum(mHoras[1]) : null;

  // validacionHoras: horasHorario vs horasContrato
  let validacionHoras;
  if (horasHorario === null) validacionHoras = 'Sin horas en horario';
  else if (horasContrato !== null && horasHorario === horasContrato) validacionHoras = 'OK';
  else validacionHoras = 'Revisar';

  // validacionModalidad: modalidadHorario vs jornada
  let validacionModalidad = 'OK';
  if (modalidadHorario && jornada && jornada !== 'Revisar') {
    const ok =
      (modalidadHorario === 'Full Time' && jornada === 'Full Time') ||
      (modalidadHorario === 'Part Time' && jornada === 'Part Time') ||
      (modalidadHorario.startsWith('Practicante') && jornada.startsWith('Practicante'));
    validacionModalidad = ok ? 'OK' : 'Revisar';
  } else if (!modalidadHorario) {
    validacionModalidad = 'Sin modalidad';
  }

  return {
    modalidadHorario,
    modeloDias,
    diasLaborablesSemana,
    ambito,
    horasHorario,
    validacionHoras,
    validacionModalidad,
  };
}

/** Deriva la jornada a partir de las horas contractuales. */
export function derivarJornada(horasContrato, cfg = DEFAULT_CONFIG) {
  if (horasContrato === null || horasContrato === undefined) return cfg.jornadaPorDefecto;
  const found = cfg.mapeoJornada.find((m) => m.horas === horasContrato);
  return found ? found.jornada : cfg.jornadaPorDefecto;
}

/** Deriva el dashboard a partir del grupo de ubicación. */
export function derivarDashboard(grupoUbic, cfg = DEFAULT_CONFIG) {
  const g = normText(grupoUbic);
  for (const regla of cfg.mapeoDashboard) {
    if (g.includes(normText(regla.contiene))) return regla.dashboard;
  }
  return cfg.dashboardPorDefecto;
}

/** Deriva el estado del empleado a partir de la fecha de cese. */
export function derivarEstado(fechaCese, hoy = new Date()) {
  if (!fechaCese) return 'Activo';
  const h0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const c0 = new Date(fechaCese.getFullYear(), fechaCese.getMonth(), fechaCese.getDate());
  if (c0.getTime() <= h0.getTime()) return 'Cesado';
  return 'Cese programado';
}

/**
 * Parsea la Dotación desde un array-de-arrays (SheetJS header:1).
 * @param {Array<Array>} aoa
 * @param {object} cfg
 * @returns {{personas: Array, filaEncabezado: number}}
 */
export function parseDotacion(aoa, cfg = DEFAULT_CONFIG, hoy = new Date()) {
  const fe = encontrarFilaEncabezado(aoa, ['Nº de documento', 'Grupo de ubicación']);
  const headerRow = fe >= 0 ? aoa[fe] : aoa[0] || [];
  // Índice de cada columna por nombre.
  const idx = {};
  for (const [campo, encabezado] of Object.entries(MAPA)) {
    idx[campo] = indiceColumna(headerRow, encabezado);
  }
  const get = (fila, campo) => {
    const i = idx[campo];
    return i >= 0 && i < fila.length ? fila[i] : '';
  };

  const personas = [];
  const start = fe >= 0 ? fe + 1 : 1;
  for (let r = start; r < aoa.length; r++) {
    const fila = aoa[r] || [];
    // Fila vacía
    if (fila.every((c) => c === null || c === undefined || String(c).trim() === '')) continue;

    const tipoDoc = get(fila, 'tipoDoc');
    const keyId = normalizeKeyId(get(fila, 'keyId'), tipoDoc);
    if (!keyId) continue; // sin llave no sirve

    const horasContratoRaw = get(fila, 'horasContrato');
    const horasContrato = horasContratoRaw === '' ? null : toNum(horasContratoRaw);
    const jornada = derivarJornada(horasContrato, cfg);
    const horario = String(get(fila, 'horario') || '');
    const horarioFields = derivarHorario(horario, horasContrato, jornada);
    const fechaCese = parseFechaGenerica(get(fila, 'fechaCese'));
    const fechaPuesto = parseFechaGenerica(get(fila, 'fechaPuesto'));
    const grupoUbic = String(get(fila, 'grupoUbic') || '');
    const areaSindicato = String(get(fila, 'areaSindicato') || '');
    const tipoContrato = String(get(fila, 'tipoContrato') || '');
    const exigeHuellaRaw = normText(get(fila, 'exigeHuella'));

    // Fiscalización
    let fiscalizacion = 'Sin dato';
    if (exigeHuellaRaw === 'si' || exigeHuellaRaw === 'sí' || exigeHuellaRaw === 's')
      fiscalizacion = 'Fiscalizado';
    else if (exigeHuellaRaw === 'no' || exigeHuellaRaw === 'n') fiscalizacion = 'No fiscalizado';

    // Sindicalizado
    const sindicalizado = cfg.sindicatos.some((s) =>
      normText(areaSindicato).includes(normText(s))
    )
      ? 'Sí'
      : 'No';

    // Campañero
    const campanero = normText(tipoContrato).includes(normText(cfg.textoCampanero)) ? 'Sí' : 'No';

    personas.push({
      tipoDoc: normText(tipoDoc).includes('dni') ? 'DNI' : 'CE',
      keyId,
      nombre: String(get(fila, 'nombre') || '').trim(),
      cargo: String(get(fila, 'cargo') || '').trim(),
      sucursal: String(get(fila, 'sucursal') || '').trim(),
      grupoUbic,
      dashboard: derivarDashboard(grupoUbic, cfg),
      fechaCese,
      estado: derivarEstado(fechaCese, hoy),
      tipoContrato,
      campanero,
      areaSindicato,
      sindicalizado,
      fiscalizacion,
      calendario: String(get(fila, 'calendario') || '').trim(),
      horario,
      horasContrato,
      jornada,
      jefe: String(get(fila, 'jefe') || '').trim(),
      fechaPuesto,
      ...horarioFields,
    });
  }

  return { personas, filaEncabezado: fe };
}
