// =============================================================================
// parsers/asistencia.js
// Parser de Gestión de Asistencia (1 fila por persona y día).
// Ojo: hay encabezados repetidos (Entró, Tipo, Atraso, Justificado, Salió,
// Adelanto). Por eso las columnas del bloque de marcación se mapean por
// POSICIÓN relativa a un ancla ("Identificador"), no por nombre.
// =============================================================================

import {
  normHeader,
  normText,
  normalizeKeyId,
  hhmmToMin,
  tieneTexto,
  toNum,
  parseFechaAsistencia,
  encontrarFilaEncabezado,
  indiceColumna,
} from './common.js';

/** ¿Estos encabezados corresponden a Asistencia? */
export function esAsistencia(headers) {
  const set = headers.map(normHeader);
  const has = (h) => {
    const n = normHeader(h);
    return set.some((c) => c.includes(n) || n.includes(c));
  };
  return has('Identificador') && has('Permiso') && has('Turno');
}

/**
 * Clasifica el permiso en categoría (se evalúa EN ESTE ORDEN).
 * @returns {{categoria: string, codigoPermiso: string}}
 */
export function clasificarPermiso(permiso) {
  const p = permiso === null || permiso === undefined ? '' : String(permiso).trim();
  const pn = normText(p);
  let categoria;
  if (pn === 'ninguno') categoria = 'Sin permiso';
  else if (pn.includes('inasistencia')) categoria = 'Inasistencia injustificada';
  else if (pn.includes('vacaciones')) categoria = 'Vacaciones';
  else if (pn.includes('descanso') || pn.includes('subsidio'))
    categoria = 'Descanso médico / Subsidio';
  else if (pn.includes('suspensi')) categoria = 'Suspensión';
  else if (pn.includes('medio dia')) categoria = 'Medio día libre';
  else if (pn.includes('banco de horas')) categoria = 'Banco de horas';
  else if (pn.includes('parcial')) categoria = 'Permiso parcial';
  else categoria = 'Licencias y permisos';

  // codigoPermiso
  let codigoPermiso = '';
  if (p.startsWith('PE_FA')) codigoPermiso = p.slice(0, 8);
  else if (p.startsWith('Banco')) codigoPermiso = 'BH-COMP';

  return { categoria, codigoPermiso };
}

/**
 * Parsea el texto del turno.
 * @returns {{tipoTurno, inicioTurno, finTurno, refrigerioProgMin, horasProgramadasMin}}
 */
export function parseTurno(turno) {
  const t = turno === null || turno === undefined ? '' : String(turno).trim();
  const res = {
    tipoTurno: t,
    inicioTurno: '',
    finTurno: '',
    refrigerioProgMin: 0,
    horasProgramadasMin: null,
  };
  if (!t.includes(' - ')) {
    // No es turno programado: el tipo es el texto tal cual (Descanso, etc.)
    return res;
  }
  res.tipoTurno = 'Turno programado';
  // "10:54 - 22:00(90 mins)"
  const m = t.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})(?:\s*\((\d+)\s*mins?\))?/i);
  if (m) {
    res.inicioTurno = m[1];
    res.finTurno = m[2];
    res.refrigerioProgMin = m[3] ? parseInt(m[3], 10) : 0;
    let dur = hhmmToMin(m[2]) - hhmmToMin(m[1]);
    if (dur < 0) dur += 1440; // cruza medianoche
    res.horasProgramadasMin = dur - res.refrigerioProgMin;
  }
  return res;
}

/** Clasifica el atraso de E1 en rangos. */
export function rangoAtraso(min) {
  if (!min || min <= 0) return 'Sin atraso';
  if (min <= 5) return '1-5';
  if (min <= 15) return '6-15';
  if (min <= 30) return '16-30';
  return 'Más de 30';
}

/**
 * Calcula el tipo de marcación a partir de las 4 marcas y el refrigerio.
 */
export function calcularTipoMarcacion(e1, s1, e2, s2, refrigerioProgMin) {
  const hasE1 = tieneTexto(e1);
  const hasS1 = tieneTexto(s1);
  const hasE2 = tieneTexto(e2);
  const hasS2 = tieneTexto(s2);
  const n = [hasE1, hasS1, hasE2, hasS2].filter(Boolean).length;

  if (n === 0) return 'Sin marcas';
  if (n === 4) return 'Completa (4/4)';

  // Caso E1 y S2 presentes pero falta algo de refrigerio
  if (hasE1 && hasS2 && !hasS1 && !hasE2) {
    return refrigerioProgMin === 0
      ? 'Completa (sin refrigerio programado)'
      : 'Sin marcación de refrigerio';
  }
  if (hasE1 && hasS2 && (hasS1 ^ hasE2)) {
    // sólo una de las dos marcas de refrigerio
    return 'Refrigerio incompleto';
  }
  // Sin E1
  if (!hasE1) {
    return hasS2 ? 'Falta entrada' : 'Falta entrada y salida';
  }
  // Con E1 y sin S2
  if (hasE1 && !hasS2) {
    return 'Falta salida final';
  }
  return 'Marcación incompleta';
}

/**
 * Determina el estado del día (se evalúa EN ESTE ORDEN).
 */
export function calcularEstadoDia(categoria, tipoTurno, nMarcaciones, primeraEntrada, ultimaSalida) {
  if (categoria === 'Inasistencia injustificada') return 'Falta injustificada';
  if (
    categoria === 'Vacaciones' ||
    categoria === 'Descanso médico / Subsidio' ||
    categoria === 'Licencias y permisos' ||
    categoria === 'Suspensión'
  )
    return 'Ausencia justificada';
  if (tipoTurno === 'Descanso') return nMarcaciones > 0 ? 'Trabajó en descanso' : 'Descanso';
  if (tieneTexto(primeraEntrada) && tieneTexto(ultimaSalida)) return 'Asistió';
  if (nMarcaciones > 0) return 'Marcación incompleta';
  if (tipoTurno === 'Turno programado') return 'Sin marcación';
  return 'Sin turno planificado';
}

/**
 * Parsea la Asistencia desde un array-de-arrays.
 * @returns {{registros: Array, fechasInvalidas: number, ejemplosFechas: Array, filaEncabezado: number}}
 */
export function parseAsistencia(aoa) {
  const fe = encontrarFilaEncabezado(aoa, ['Identificador', 'Permiso', 'Turno']);
  const headerRow = fe >= 0 ? aoa[fe] : aoa[0] || [];

  // Ancla: la columna "Identificador" es la posición C (índice relativo 2).
  // El resto del bloque se mapea por posición relativa a esa ancla, para
  // tolerar una posible columna índice a la izquierda.
  let base = indiceColumna(headerRow, 'Identificador') - 2;
  if (base < 0) {
    // fallback: intenta anclar en "Apellidos" (posición A).
    const a = indiceColumna(headerRow, 'Apellidos');
    base = a >= 0 ? a : 0;
  }
  const C = (offset) => base + offset; // columna por offset absoluto A=0..AB=27

  const registros = [];
  let fechasInvalidas = 0;
  const ejemplosFechas = []; // primeras filas con fecha ilegible (para Calidad)
  const start = fe >= 0 ? fe + 1 : 1;

  for (let r = start; r < aoa.length; r++) {
    const fila = aoa[r] || [];
    const g = (off) => {
      const i = C(off);
      return i >= 0 && i < fila.length ? fila[i] : '';
    };
    if (fila.every((c) => c === null || c === undefined || String(c).trim() === '')) continue;

    const apellidos = String(g(0) || '').trim(); // A
    const nombreCol = String(g(1) || '').trim(); // B
    const identificador = g(2); // C
    const grupo = String(g(3) || '').trim(); // D
    const fechaRaw = g(4); // E
    const permiso = g(5); // F
    const turnoRaw = g(6); // G

    // E1..S2
    const e1 = g(7); // H
    const tipoE1 = g(8); // I
    const atrasoE1Raw = g(9); // J
    const justE1 = g(10); // K
    const s1 = g(11); // L
    const tipoS1 = g(12); // M
    const adelantoS1Raw = g(13); // N
    const justS1 = g(14); // O
    const e2 = g(15); // P
    const tipoE2 = g(16); // Q
    const atrasoE2Raw = g(17); // R
    const justE2 = g(18); // S
    const s2 = g(19); // T
    const tipoS2 = g(20); // U
    const adelantoS2Raw = g(21); // V
    const justS2 = g(22); // W

    const heaRaw = g(23); // X
    const hecRaw = g(24); // Y
    const hntRaw = g(25); // Z
    const htRaw = g(26); // AA
    const cargoRaw = String(g(27) || ''); // AB  "CÓDIGO - Nombre"

    // keyId
    const keyId = normalizeKeyId(identificador, 'DNI');
    if (!keyId) continue;

    // Fecha
    const f = parseFechaAsistencia(fechaRaw);
    if (!f.ok) {
      fechasInvalidas++;
      if (ejemplosFechas.length < 50) ejemplosFechas.push({ fila: r + 1, keyId, valor: String(fechaRaw ?? '') });
      continue; // sin fecha válida no se puede ubicar en el tiempo
    }
    const keyDia = keyId + '|' + f.yyyymmdd;

    // Permiso
    const { categoria: categoriaPermiso, codigoPermiso } = clasificarPermiso(permiso);

    // Turno
    const turno = parseTurno(turnoRaw);

    // Marcas
    const primeraEntrada = tieneTexto(e1) ? e1 : tieneTexto(e2) ? e2 : '';
    // ultimaSalida = S2 o, si no hay, S1 (sólo si no existe E2)
    let ultimaSalida = '';
    if (tieneTexto(s2)) ultimaSalida = s2;
    else if (tieneTexto(s1) && !tieneTexto(e2)) ultimaSalida = s1;

    const nMarcaciones = [e1, s1, e2, s2].filter(tieneTexto).length;

    // Marcas manuales (Tipo == "M")
    const esM = (v) => normText(v) === 'm';
    const marcasManuales = [tipoE1, tipoS1, tipoE2, tipoS2].filter(esM).length;

    // Minutos de atraso/adelanto
    const atrasoE1 = hhmmToMin(atrasoE1Raw);
    const adelantoS1 = hhmmToMin(adelantoS1Raw);
    const atrasoE2 = hhmmToMin(atrasoE2Raw);
    const adelantoS2 = hhmmToMin(adelantoS2Raw);
    const atrasoTotal = atrasoE1 + atrasoE2;
    const salidaAnticipadaTotal = adelantoS1 + adelantoS2;

    const justificacionRegistrada =
      tieneTexto(justE1) || tieneTexto(justS1) || tieneTexto(justE2) || tieneTexto(justS2)
        ? 'Sí'
        : 'No';

    // Patrón de marcación
    const patronMarcacion = [
      tieneTexto(e1) ? 'E1' : '__',
      tieneTexto(s1) ? 'S1' : '__',
      tieneTexto(e2) ? 'E2' : '__',
      tieneTexto(s2) ? 'S2' : '__',
    ].join('-');

    const tipoMarcacion = calcularTipoMarcacion(e1, s1, e2, s2, turno.refrigerioProgMin);

    // Refrigerio real / exceso (NULL si no hay marcas de refrigerio)
    let refrigerioRealMin = null;
    let excesoRefrigerioMin = null;
    if (tieneTexto(s1) && tieneTexto(e2)) {
      let real = hhmmToMin(e2) - hhmmToMin(s1);
      if (real < 0) real += 1440;
      refrigerioRealMin = real;
      excesoRefrigerioMin = Math.max(0, real - turno.refrigerioProgMin);
    }

    const incidenciaHorario =
      atrasoE1 > 0 || adelantoS1 > 0 || atrasoE2 > 0 || adelantoS2 > 0 ? 'Sí' : 'No';

    // Horas (a minutos)
    const heaMin = hhmmToMin(heaRaw);
    const hecMin = hhmmToMin(hecRaw);
    const hntMin = hhmmToMin(hntRaw);
    const htMin = hhmmToMin(htRaw);

    // Cargo de marcación
    const partesCargo = cargoRaw.split(' - ');
    const codigoCargo = partesCargo.length > 1 ? partesCargo[0].trim() : '';
    const cargoMarcacion = partesCargo.length > 1 ? partesCargo.slice(1).join(' - ').trim() : cargoRaw.trim();

    const estadoDia = calcularEstadoDia(
      categoriaPermiso,
      turno.tipoTurno,
      nMarcaciones,
      primeraEntrada,
      ultimaSalida
    );

    registros.push({
      keyId,
      keyDia,
      nombre: (nombreCol + ' ' + apellidos).trim(),
      grupoArea: grupo,
      fecha: f.date,
      yyyymmdd: f.yyyymmdd,
      diaSemana: f.diaSemana,
      feriado: f.feriado ? 'Sí' : 'No',
      permiso: String(permiso || '').trim(),
      categoriaPermiso,
      codigoPermiso,
      // turno
      tipoTurno: turno.tipoTurno,
      inicioTurno: turno.inicioTurno,
      finTurno: turno.finTurno,
      refrigerioProgMin: turno.refrigerioProgMin,
      horasProgramadasMin: turno.horasProgramadasMin,
      // marcas
      primeraEntrada: String(primeraEntrada || '').trim(),
      ultimaSalida: String(ultimaSalida || '').trim(),
      nMarcaciones,
      marcasManuales,
      marcacionManual: marcasManuales > 0 ? 'Sí' : 'No',
      // minutos
      atrasoE1,
      adelantoS1,
      atrasoE2,
      adelantoS2,
      atrasoTotal,
      salidaAnticipadaTotal,
      justificacionRegistrada,
      justE1Texto: tieneTexto(justE1),
      justS2Texto: tieneTexto(justS2),
      patronMarcacion,
      tipoMarcacion,
      refrigerioRealMin,
      excesoRefrigerioMin,
      rangoAtrasoE1: rangoAtraso(atrasoE1),
      incidenciaHorario,
      // horas
      heaMin,
      hecMin,
      hntMin,
      htMin,
      // cargo
      codigoCargo,
      cargoMarcacion,
      estadoDia,
    });
  }

  return { registros, fechasInvalidas, ejemplosFechas, filaEncabezado: fe };
}
