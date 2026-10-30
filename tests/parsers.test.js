// =============================================================================
// Pruebas unitarias de los parsers (Node --test).
// Cubren los casos exigidos por la especificación:
//  - fecha "Mar 01-09-2026"
//  - turno "10:54 - 22:00(90 mins)"
//  - DNI con relleno de ceros
//  - filas "Totales"
// y además la validación de horas conocida y estadoDia/tipoMarcacion.
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeKeyId,
  hhmmToMin,
  parseFechaAsistencia,
  parseFechaTE,
} from '../js/parsers/common.js';
import {
  parseTurno,
  clasificarPermiso,
  calcularTipoMarcacion,
  calcularEstadoDia,
  rangoAtraso,
  parseAsistencia,
} from '../js/parsers/asistencia.js';
import { parseTiempoExtra } from '../js/parsers/tiempoExtra.js';
import { parseDotacion, derivarHorario } from '../js/parsers/dotacion.js';

// ---- normalizeKeyId ---------------------------------------------------------
test('DNI numérico se rellena con ceros a 8 dígitos', () => {
  assert.equal(normalizeKeyId('12345', 'DNI'), '00012345');
  assert.equal(normalizeKeyId(' 123 456 78 ', 'DNI'), '12345678');
  assert.equal(normalizeKeyId('12345678', 'DNI'), '12345678');
});

test('DNI largo no se trunca y CE se deja tal cual', () => {
  assert.equal(normalizeKeyId('123456789', 'DNI'), '123456789');
  assert.equal(normalizeKeyId('AB1234', 'Carné de extranjería'), 'AB1234');
  assert.equal(normalizeKeyId('00912', 'CE'), '00912'); // CE no numérico-DNI => tal cual
});

// ---- hhmmToMin --------------------------------------------------------------
test('hh:mm a minutos', () => {
  assert.equal(hhmmToMin('01:30'), 90);
  assert.equal(hhmmToMin('00:00'), 0);
  assert.equal(hhmmToMin(''), 0);
  assert.equal(hhmmToMin('10:54'), 654);
});

// ---- Fecha de asistencia ----------------------------------------------------
test('fecha "Mar 01-09-2026" se parsea correctamente', () => {
  const r = parseFechaAsistencia('Mar 01-09-2026');
  assert.equal(r.ok, true);
  assert.equal(r.yyyymmdd, '20260901');
  assert.equal(r.diaSemana, 'Mar');
  assert.equal(r.feriado, false);
  assert.equal(r.date.getFullYear(), 2026);
  assert.equal(r.date.getMonth(), 8); // septiembre (0-based)
  assert.equal(r.date.getDate(), 1);
});

test('feriado "(F)" se detecta', () => {
  const r = parseFechaAsistencia('Lun 28-07-2026 (F)');
  assert.equal(r.feriado, true);
  assert.equal(r.yyyymmdd, '20260728');
});

test('fecha TE "1/09/2026" (día sin cero) se parsea', () => {
  const r = parseFechaTE('1/09/2026');
  assert.equal(r.ok, true);
  assert.equal(r.yyyymmdd, '20260901');
});

// ---- Turno ------------------------------------------------------------------
test('turno "10:54 - 22:00(90 mins)" se descompone', () => {
  const t = parseTurno('10:54 - 22:00(90 mins)');
  assert.equal(t.tipoTurno, 'Turno programado');
  assert.equal(t.inicioTurno, '10:54');
  assert.equal(t.finTurno, '22:00');
  assert.equal(t.refrigerioProgMin, 90);
  // (22:00 - 10:54) = 666 min; menos 90 de refrigerio = 576
  assert.equal(t.horasProgramadasMin, 576);
});

test('turno de texto (Descanso) no es programado', () => {
  assert.equal(parseTurno('Descanso').tipoTurno, 'Descanso');
  assert.equal(parseTurno('No Planificado').tipoTurno, 'No Planificado');
});

test('turno que cruza medianoche', () => {
  const t = parseTurno('22:00 - 06:00(60 mins)');
  // (06:00 + 1440 - 22:00) = 480; menos 60 = 420
  assert.equal(t.horasProgramadasMin, 420);
});

// ---- Permiso ----------------------------------------------------------------
test('clasificación de permiso respeta el orden', () => {
  assert.equal(clasificarPermiso('Ninguno').categoria, 'Sin permiso');
  assert.equal(clasificarPermiso('Inasistencia injustificada').categoria, 'Inasistencia injustificada');
  assert.equal(clasificarPermiso('Vacaciones programadas').categoria, 'Vacaciones');
  assert.equal(clasificarPermiso('Subsidio por enfermedad').categoria, 'Descanso médico / Subsidio');
  assert.equal(clasificarPermiso('Suspensión disciplinaria').categoria, 'Suspensión');
  assert.equal(clasificarPermiso('Permiso parcial salud').categoria, 'Permiso parcial');
  assert.equal(clasificarPermiso('Otro permiso raro').categoria, 'Licencias y permisos');
});

test('codigoPermiso PE_FA y Banco', () => {
  assert.equal(clasificarPermiso('PE_FA123 algo').codigoPermiso, 'PE_FA123');
  assert.equal(clasificarPermiso('Banco de Horas comp').codigoPermiso, 'BH-COMP');
});

// ---- Tipo de marcación ------------------------------------------------------
test('tipoMarcacion: completa, sin marcas y refrigerio', () => {
  assert.equal(calcularTipoMarcacion('08:00', '12:00', '13:00', '17:00', 60), 'Completa (4/4)');
  assert.equal(calcularTipoMarcacion('', '', '', '', 60), 'Sin marcas');
  assert.equal(calcularTipoMarcacion('08:00', '', '', '17:00', 0), 'Completa (sin refrigerio programado)');
  assert.equal(calcularTipoMarcacion('08:00', '', '', '17:00', 60), 'Sin marcación de refrigerio');
  assert.equal(calcularTipoMarcacion('08:00', '12:00', '', '17:00', 60), 'Refrigerio incompleto');
  assert.equal(calcularTipoMarcacion('', '', '', '17:00', 60), 'Falta entrada');
  assert.equal(calcularTipoMarcacion('08:00', '', '', '', 60), 'Falta salida final');
});

// ---- estadoDia --------------------------------------------------------------
test('estadoDia respeta el orden de evaluación', () => {
  assert.equal(calcularEstadoDia('Inasistencia injustificada', 'Turno programado', 0, '', ''), 'Falta injustificada');
  assert.equal(calcularEstadoDia('Vacaciones', 'Turno programado', 0, '', ''), 'Ausencia justificada');
  assert.equal(calcularEstadoDia('Sin permiso', 'Descanso', 2, '08:00', '17:00'), 'Trabajó en descanso');
  assert.equal(calcularEstadoDia('Sin permiso', 'Descanso', 0, '', ''), 'Descanso');
  assert.equal(calcularEstadoDia('Sin permiso', 'Turno programado', 4, '08:00', '17:00'), 'Asistió');
  assert.equal(calcularEstadoDia('Sin permiso', 'Turno programado', 1, '08:00', ''), 'Marcación incompleta');
  assert.equal(calcularEstadoDia('Sin permiso', 'Turno programado', 0, '', ''), 'Sin marcación');
  assert.equal(calcularEstadoDia('Sin permiso', 'Presencial', 0, '', ''), 'Sin turno planificado');
});

test('rangoAtraso', () => {
  assert.equal(rangoAtraso(0), 'Sin atraso');
  assert.equal(rangoAtraso(3), '1-5');
  assert.equal(rangoAtraso(10), '6-15');
  assert.equal(rangoAtraso(25), '16-30');
  assert.equal(rangoAtraso(45), 'Más de 30');
});

// ---- parseAsistencia (integración de una fila) ------------------------------
test('parseAsistencia mapea el bloque por posición', () => {
  const headers = [
    'Apellidos', 'Nombre', 'Identificador', 'Grupo', 'Fecha', 'Permiso', 'Turno',
    'Entró', 'Tipo', 'Atraso', 'Justificado',
    'Salió', 'Tipo', 'Adelanto', 'Justificado',
    'Entró', 'Tipo', 'Atraso', 'Justificado',
    'Salió', 'Tipo', 'Adelanto', 'Justificado',
    'HEA', 'HEC', 'HNT', 'HT', 'Cargo',
  ];
  const fila = [
    'Pérez López', 'Juan', '12345678', 'Tienda X', 'Mar 01-09-2026', 'Ninguno', '10:54 - 22:00(90 mins)',
    '10:55', '', '00:01', '',
    '14:00', '', '', '',
    '14:45', '', '', '',
    '22:00', 'M', '', '',
    '', '', '', '', 'VEND - Vendedor',
  ];
  const { registros } = parseAsistencia([headers, fila]);
  assert.equal(registros.length, 1);
  const r = registros[0];
  assert.equal(r.keyId, '12345678');
  assert.equal(r.keyDia, '12345678|20260901');
  assert.equal(r.nombre, 'Juan Pérez López');
  assert.equal(r.nMarcaciones, 4);
  assert.equal(r.tipoMarcacion, 'Completa (4/4)');
  assert.equal(r.estadoDia, 'Asistió');
  assert.equal(r.atrasoE1, 1);
  assert.equal(r.refrigerioRealMin, 45); // 14:45 - 14:00
  assert.equal(r.excesoRefrigerioMin, 0); // 45 < 90 programado
  assert.equal(r.marcasManuales, 1); // S2 Tipo = "M"
  assert.equal(r.codigoCargo, 'VEND');
  assert.equal(r.cargoMarcacion, 'Vendedor');
});

// ---- parseTiempoExtra (descarta Totales) ------------------------------------
test('parseTiempoExtra descarta filas "Totales"', () => {
  const headers = [
    'Fecha', 'Apellidos', 'Nombre', 'Identificador', 'Grupo', 'Turno', 'Entrada',
    'TE', 'HEA', 'HEC', 'Salió', 'TE', 'HEA', 'HEC', 'TE Cubre HNT', 'Finales',
  ];
  const filaValida = [
    '1/09/2026', 'Pérez', 'Juan', '12345678', 'Tienda', 'Turno', '08:00',
    '01:00', '00:30', '00:30', '20:00', '01:00', '00:30', '00:30', '', '01:30',
  ];
  const filaTotales = [
    '', '', '', '', '', '', 'Totales',
    '02:00', '01:00', '01:00', '', '', '', '', '', '03:00',
  ];
  const { registros, descartadasTotales } = parseTiempoExtra([headers, filaValida, filaTotales]);
  assert.equal(registros.length, 1);
  assert.equal(descartadasTotales, 1);
  const r = registros[0];
  assert.equal(r.keyDia, '12345678|20260901');
  assert.equal(r.teMin, 120); // 60 + 60
  assert.equal(r.finalesMin, 90); // Finales 01:30
  assert.equal(r.noReconocidasMin, 30); // 120 - 90
});

// ---- Dotación: validación de horas conocida ---------------------------------
test('derivarHorario marca "Revisar" para CORPORACION 45 HORAS vs contrato 48', () => {
  const d = derivarHorario('FALABELLA - FULL TIME CORPORACION 45 HORAS 5X2', 48, 'Full Time');
  assert.equal(d.modalidadHorario, 'Full Time');
  assert.equal(d.modeloDias, '5X2');
  assert.equal(d.diasLaborablesSemana, 5);
  assert.equal(d.ambito, 'Corporación');
  assert.equal(d.horasHorario, 45);
  assert.equal(d.validacionHoras, 'Revisar');
});

test('parseDotacion deriva dashboard, campañero, sindicato y fiscalización', () => {
  const headers = [
    'Tipo de documento', 'Nº de documento', 'Nombres + Primer apellido', 'Nombre del cargo',
    'Nombre de Ubicación', 'Grupo de ubicación', 'Fecha de terminación', 'Tipo de contrato',
    'Área escala remuneración (Sindicato)', 'Exije huella', 'Calendario de festivos',
    'Horario de trabajo', 'Horas semanales contractuales', 'Jefe Directo', 'Fecha de entrada en el puesto',
  ];
  const fila = [
    'DNI', '123', 'Juan Pérez', 'Vendedor', 'Tienda Lima', 'Sucursales y Tiendas', '',
    'Contrato de trabajo de temporada', 'SUTRASAF', 'Sí', 'PERU',
    'FALABELLA - FULL TIME TIENDA 48 HORAS 5X2', '48', 'Jefe X', '',
  ];
  const { personas } = parseDotacion([headers, fila]);
  assert.equal(personas.length, 1);
  const p = personas[0];
  assert.equal(p.keyId, '00000123'); // relleno a 8
  assert.equal(p.dashboard, 'Tienda');
  assert.equal(p.campanero, 'Sí');
  assert.equal(p.sindicalizado, 'Sí');
  assert.equal(p.fiscalizacion, 'Fiscalizado');
  assert.equal(p.jornada, 'Full Time');
  assert.equal(p.ambito, 'Tienda');
  assert.equal(p.validacionHoras, 'OK'); // 48 vs 48
});

test('fechas imposibles (31-02) se rechazan en vez de rodar a marzo', () => {
  assert.equal(parseFechaAsistencia('Mar 31-02-2026').ok, false);
  assert.equal(parseFechaTE('31/02/2026').ok, false);
  assert.equal(parseFechaAsistencia('Sáb 29-02-2028').ok, true); // 2028 es bisiesto
});
