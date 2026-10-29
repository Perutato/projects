// =============================================================================
// historico.js
// Comparación de cortes. Una "incidencia" es keyDia + tipo, con tipo en
// {Falta injustificada, Sin marcación, Marcación incompleta, Trabajó sin turno}
// (solo Tienda y Logística). Al comparar el corte actual con el anterior:
//   - Nueva: no estaba en el corte anterior.
//   - Pendiente: sigue apareciendo.
//   - Regularizada: estaba en el anterior y ya no aparece.
// Funciones puras.
// =============================================================================

/**
 * Compara dos cortes (cada uno con `incidencias`: [{k,s,j,d,t}]).
 * @param {object} actual   corte actual
 * @param {object|null} anterior corte anterior (o null)
 */
export function compararCortes(actual, anterior) {
  const prev = new Map();
  if (anterior) for (const i of anterior.incidencias) prev.set(i.k, i);
  const cur = new Map();
  for (const i of actual.incidencias) cur.set(i.k, i);

  const nuevas = [];
  const pendientes = [];
  for (const [k, i] of cur) {
    if (prev.has(k)) pendientes.push(i);
    else nuevas.push(i);
  }
  const regularizadas = [];
  if (anterior) for (const [k, i] of prev) if (!cur.has(k)) regularizadas.push(i);

  const nAnt = anterior ? anterior.incidencias.length : 0;
  const resumen = {
    actuales: cur.size,
    nuevas: nuevas.length,
    pendientes: pendientes.length,
    regularizadas: regularizadas.length,
    pctRegularizacion: nAnt ? (regularizadas.length / nAnt) * 100 : 0,
  };

  const agg = (campoClave) => {
    const m = new Map();
    const sumar = (arr, prop) => {
      for (const i of arr) {
        const clave = i[campoClave] || '(sin dato)';
        if (!m.has(clave)) m.set(clave, { clave, nuevas: 0, pendientes: 0, regularizadas: 0 });
        m.get(clave)[prop]++;
      }
    };
    sumar(nuevas, 'nuevas');
    sumar(pendientes, 'pendientes');
    sumar(regularizadas, 'regularizadas');
    return [...m.values()].sort(
      (a, b) => b.nuevas + b.pendientes + b.regularizadas - (a.nuevas + a.pendientes + a.regularizadas)
    );
  };

  return { resumen, porSucursal: agg('s'), porJefe: agg('j') };
}

/**
 * Serie de evolución: por cada corte, su resumen frente al corte anterior.
 * @param {Array} cortes  ordenados por fecha ascendente
 */
export function evolucionCortes(cortes) {
  const serie = [];
  for (let i = 0; i < cortes.length; i++) {
    const cmp = compararCortes(cortes[i], i > 0 ? cortes[i - 1] : null);
    serie.push({
      fecha: new Date(cortes[i].fecha).toLocaleDateString('es-PE'),
      actuales: cmp.resumen.actuales,
      nuevas: cmp.resumen.nuevas,
      regularizadas: cmp.resumen.regularizadas,
      pctRegularizacion: cmp.resumen.pctRegularizacion,
    });
  }
  return serie;
}
