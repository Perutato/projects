// =============================================================================
// Pruebas del histórico de cortes (Fase 4).
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compararCortes, evolucionCortes } from '../js/historico.js';

const inc = (k, s = 'Suc 1', j = 'J1', t = 'Falta injustificada') => ({ k, s, j, d: 'Tienda', t });

test('compararCortes: nuevas, pendientes y regularizadas', () => {
  const anterior = { fecha: '2026-09-01', incidencias: [inc('a'), inc('b'), inc('c')] };
  const actual = { fecha: '2026-09-08', incidencias: [inc('b'), inc('c'), inc('d')] };
  const cmp = compararCortes(actual, anterior);
  assert.equal(cmp.resumen.actuales, 3);
  assert.equal(cmp.resumen.nuevas, 1); // d
  assert.equal(cmp.resumen.pendientes, 2); // b, c
  assert.equal(cmp.resumen.regularizadas, 1); // a
  assert.equal(+cmp.resumen.pctRegularizacion.toFixed(1), 33.3); // 1/3
});

test('compararCortes sin anterior: todo nuevo, 0% regularización', () => {
  const actual = { fecha: '2026-09-01', incidencias: [inc('a'), inc('b')] };
  const cmp = compararCortes(actual, null);
  assert.equal(cmp.resumen.nuevas, 2);
  assert.equal(cmp.resumen.regularizadas, 0);
  assert.equal(cmp.resumen.pctRegularizacion, 0);
});

test('compararCortes agrega por sucursal y por jefe', () => {
  const anterior = { incidencias: [inc('a', 'A', 'J1'), inc('b', 'B', 'J2')] };
  const actual = { incidencias: [inc('a', 'A', 'J1'), inc('c', 'A', 'J1')] };
  const cmp = compararCortes(actual, anterior);
  const sucA = cmp.porSucursal.find((x) => x.clave === 'A');
  assert.equal(sucA.pendientes, 1); // a
  assert.equal(sucA.nuevas, 1); // c
  const sucB = cmp.porSucursal.find((x) => x.clave === 'B');
  assert.equal(sucB.regularizadas, 1); // b regularizada
});

test('evolucionCortes produce una serie por corte', () => {
  const cortes = [
    { fecha: '2026-09-01', incidencias: [inc('a'), inc('b')] },
    { fecha: '2026-09-08', incidencias: [inc('b')] },
  ];
  const s = evolucionCortes(cortes);
  assert.equal(s.length, 2);
  assert.equal(s[0].nuevas, 2);
  assert.equal(s[1].regularizadas, 1); // a regularizada
  assert.equal(s[1].actuales, 1);
});
