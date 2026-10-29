// =============================================================================
// Prueba de integración end-to-end del flujo de datos (sin DOM/Worker):
// parsers -> modelo -> KPIs -> dashboard.
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDotacion } from '../js/parsers/dotacion.js';
import { parseAsistencia } from '../js/parsers/asistencia.js';
import { parseTiempoExtra } from '../js/parsers/tiempoExtra.js';
import { construirModelo } from '../js/model.js';
import { construirDashboard } from '../js/kpis.js';

const dotHeaders = [
  'Tipo de documento', 'Nº de documento', 'Nombres + Primer apellido', 'Nombre del cargo',
  'Nombre de Ubicación', 'Grupo de ubicación', 'Fecha de terminación', 'Tipo de contrato',
  'Área escala remuneración (Sindicato)', 'Exije huella', 'Calendario de festivos',
  'Horario de trabajo', 'Horas semanales contractuales', 'Jefe Directo', 'Fecha de entrada en el puesto',
];
const dotRows = [
  dotHeaders,
  ['DNI', '12345678', 'Ana Torres', 'Vendedor', 'Tienda Lima', 'Sucursales y Tiendas', '', 'Indefinido', 'SUTRASAF', 'Sí', 'PERU', 'FULL TIME TIENDA 48 HORAS 5X2', '48', 'Jefe A', ''],
  ['DNI', '222', 'Beto Ruiz', 'Cajero', 'Tienda Lima', 'Sucursales y Tiendas', '', 'Indefinido', '', 'No', 'PERU', 'FULL TIME TIENDA 48 HORAS 5X2', '48', 'Jefe A', ''],
  ['DNI', '333', 'Caro Díaz', 'Operario', 'CD Norte', 'Centro de Distribución o Bodega', '', 'Indefinido', '', 'Sí', 'PERU', 'FULL TIME 48 HORAS 6X1', '48', 'Jefe B', ''],
];

const asisHeaders = [
  'Apellidos', 'Nombre', 'Identificador', 'Grupo', 'Fecha', 'Permiso', 'Turno',
  'Entró', 'Tipo', 'Atraso', 'Justificado', 'Salió', 'Tipo', 'Adelanto', 'Justificado',
  'Entró', 'Tipo', 'Atraso', 'Justificado', 'Salió', 'Tipo', 'Adelanto', 'Justificado',
  'HEA', 'HEC', 'HNT', 'HT', 'Cargo',
];
function asisRow(id, fecha, turno, e1, atraso, s1, e2, s2, permiso = 'Ninguno') {
  return [
    'Ap', 'No', id, 'G', fecha, permiso, turno,
    e1, '', atraso, '', s1, '', '', '',
    e2, '', '', '', s2, '', '', '',
    '', '', '', '', 'VEND - Vendedor',
  ];
}
const asisRows = [
  asisHeaders,
  // Ana: 2 días, uno con tardanza
  asisRow('12345678', 'Mar 01-09-2026', '09:00 - 18:00(60 mins)', '09:00', '', '13:00', '14:00', '18:00'),
  asisRow('12345678', 'Mié 02-09-2026', '09:00 - 18:00(60 mins)', '09:08', '00:08', '13:00', '14:00', '18:00'),
  // Beto: 1 falta injustificada
  asisRow('00000222', 'Mar 01-09-2026', '09:00 - 18:00(60 mins)', '', '', '', '', '', 'Inasistencia injustificada'),
  // Caro (Logística): asistió
  asisRow('00000333', 'Mar 01-09-2026', '08:00 - 17:00(60 mins)', '08:00', '', '12:00', '13:00', '17:00'),
];

const teHeaders = [
  'Fecha', 'Apellidos', 'Nombre', 'Identificador', 'Grupo', 'Turno', 'Entrada',
  'TE', 'HEA', 'HEC', 'Salió', 'TE', 'HEA', 'HEC', 'TE Cubre HNT', 'Finales',
];
const teRows = [
  teHeaders,
  ['1/09/2026', 'Ap', 'No', '12345678', 'G', 'Turno', '08:00', '01:00', '00:30', '00:30', '19:00', '01:00', '00:30', '00:30', '', '01:30'],
  ['', '', '', '', '', '', 'Totales', '02:00', '', '', '', '', '', '', '', '03:00'],
];

test('pipeline completo produce un dashboard coherente', () => {
  const { personas } = parseDotacion(dotRows);
  assert.equal(personas.length, 3);

  const { registros: asis } = parseAsistencia(asisRows);
  for (const r of asis) r._lote = 1;
  assert.equal(asis.length, 4);

  const { registros: te, descartadasTotales } = parseTiempoExtra(teRows);
  for (const r of te) r._lote = 1;
  assert.equal(te.length, 1);
  assert.equal(descartadasTotales, 1);

  const modelo = construirModelo({ personas, asistencia: asis, tiempoExtra: te });
  assert.equal(modelo.filas.length, 4);

  // Dashboard Tienda
  const dTienda = construirDashboard(modelo.filas, { dashboard: 'Tienda', granularidad: 'dia' });
  assert.equal(dTienda.kpis.personas, 2); // Ana + Beto
  assert.equal(dTienda.kpis.faltasInjust, 1); // Beto
  assert.equal(dTienda.kpis.tardanzasDias, 1); // Ana el día 2
  assert.equal(dTienda.kpis.fiscalizables, 1); // sólo Ana (Beto No)
  // HHEE: ejecutadas 120 min = 2h, reconocidas 90 min = 1.5h
  assert.equal(+dTienda.kpis.hheeEjecH.toFixed(2), 2);
  assert.equal(+dTienda.kpis.hheeReconH.toFixed(2), 1.5);

  // Dashboard Logística
  const dLog = construirDashboard(modelo.filas, { dashboard: 'Logística', granularidad: 'dia' });
  assert.equal(dLog.kpis.personas, 1); // Caro
  assert.equal(+dLog.kpis.pctAsistencia.toFixed(1), 100);
});
