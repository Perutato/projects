// =============================================================================
// charts.js
// Construcción de gráficos con Apache ECharts. ECharts se carga como global
// (window.echarts) desde CDN en index.html. Cada gráfico se asocia a un id de
// contenedor y se reutiliza/redimensiona.
// =============================================================================

/* global echarts */

const instancias = new Map();

/** Obtiene (o crea) la instancia de ECharts para un contenedor. */
function obtener(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  let inst = instancias.get(id);
  if (!inst || inst.isDisposed()) {
    inst = echarts.init(el, null, { renderer: 'canvas' });
    instancias.set(id, inst);
  }
  return inst;
}

/** Redimensiona todos los gráficos (al cambiar de tamaño la ventana/vista). */
export function resizeTodos() {
  for (const inst of instancias.values()) if (!inst.isDisposed()) inst.resize();
}

/** Elimina todas las instancias (al cambiar de dashboard). */
export function limpiarGraficos() {
  for (const inst of instancias.values()) if (!inst.isDisposed()) inst.dispose();
  instancias.clear();
}

const FUENTE = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';
const grid = { left: 8, right: 16, top: 34, bottom: 8, containLabel: true };
const ejeTxt = { color: '#5a6b7b', fontSize: 11, fontFamily: FUENTE };
const SPLIT = { lineStyle: { color: '#eef2f7' } };
const EJE_LINE = { lineStyle: { color: '#dbe2ea' } };

// Título y tooltip corporativos reutilizables.
const tit = (t) => ({ text: t, left: 0, top: 2, textStyle: { fontSize: 13, fontWeight: 600, color: '#1f2933', fontFamily: FUENTE } });
const TOOLTIP = {
  backgroundColor: '#0f2436', borderWidth: 0, textStyle: { color: '#fff', fontSize: 12, fontFamily: FUENTE },
  padding: [8, 12], extraCssText: 'border-radius:8px;box-shadow:0 6px 20px rgba(16,24,40,.25);',
};

function recortar(s, n = 22) {
  return s && s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Barras horizontales (usado por % asistencia, fuga, etc.). */
export function barrasHorizontales(id, titulo, datos, color, sufijo = '', decimales = 1) {
  const inst = obtener(id);
  if (!inst) return;
  const cats = datos.map((d) => recortar(d.sucursal)).reverse();
  const vals = datos.map((d) => +d.valor.toFixed(decimales)).reverse();
  inst.setOption({
    title: tit(titulo),
    grid: { ...grid, right: 44 },
    tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => v + sufijo },
    xAxis: { type: 'value', axisLabel: { ...ejeTxt, formatter: '{value}' + sufijo }, splitLine: SPLIT, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'category', data: cats, axisLabel: ejeTxt, axisLine: EJE_LINE, axisTick: { show: false } },
    series: [{
      type: 'bar', data: vals, itemStyle: { color, borderRadius: [0, 3, 3, 0] }, barMaxWidth: 18,
      label: { show: true, position: 'right', color: '#5a6b7b', fontSize: 10.5, fontFamily: FUENTE, formatter: (p) => p.value + sufijo },
    }],
  }, true);
}

/** Doble serie: días no planificados + trabajadores afectados. */
export function dobleSerie(id, titulo, datos, color) {
  const inst = obtener(id);
  if (!inst) return;
  const cats = datos.map((d) => recortar(d.sucursal));
  inst.setOption({
    title: tit(titulo),
    grid: { ...grid, bottom: 60 },
    tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { bottom: 0, textStyle: ejeTxt },
    xAxis: { type: 'category', data: cats, axisLabel: { ...ejeTxt, rotate: 35 } },
    yAxis: { type: 'value', axisLabel: ejeTxt, splitLine: { lineStyle: { color: '#eef2f7' } } },
    series: [
      { name: 'Días no planificados', type: 'bar', data: datos.map((d) => d.dias), itemStyle: { color } },
      { name: 'Trabajadores afectados', type: 'bar', data: datos.map((d) => d.trabajadores), itemStyle: { color: '#b7791f' } },
    ],
  }, true);
}

/** Tendencia temporal (líneas múltiples). */
export function tendencia(id, titulo, serie, color) {
  const inst = obtener(id);
  if (!inst) return;
  const cats = serie.map((s) => s.periodo);
  inst.setOption({
    title: tit(titulo),
    grid: { ...grid, bottom: 60, right: 40 },
    tooltip: { ...TOOLTIP, trigger: 'axis' },
    legend: { bottom: 0, textStyle: ejeTxt },
    xAxis: { type: 'category', data: cats, axisLabel: { ...ejeTxt, rotate: cats.length > 12 ? 40 : 0 } },
    yAxis: [
      { type: 'value', axisLabel: ejeTxt, splitLine: SPLIT, axisLine: { show: false }, axisTick: { show: false } },
    ],
    series: [
      { name: 'Tardanzas (días)', type: 'line', smooth: true, data: serie.map((s) => s.tardanzas), itemStyle: { color } },
      { name: 'Fuga (h)', type: 'line', smooth: true, data: serie.map((s) => +s.fugaH.toFixed(1)), itemStyle: { color: '#c0392b' } },
      { name: 'Días no planificados', type: 'line', smooth: true, data: serie.map((s) => s.diasNoPlan), itemStyle: { color: '#b7791f' } },
      { name: 'HHEE (h)', type: 'line', smooth: true, data: serie.map((s) => +s.hheeH.toFixed(1)), itemStyle: { color: '#6a51a3' } },
    ],
  }, true);
}

/** Anillo de calidad de marcación. */
export function anillo(id, titulo, data) {
  const inst = obtener(id);
  if (!inst) return;
  const items = [
    { name: 'Completa', value: data.completa, itemStyle: { color: '#1e8e4e' } },
    { name: 'Incompleta', value: data.incompleta, itemStyle: { color: '#b7791f' } },
    { name: 'Sin marcación', value: data.sinMarcacion, itemStyle: { color: '#8795a1' } },
    { name: 'Falta injustificada', value: data.faltaInjust, itemStyle: { color: '#c0392b' } },
  ];
  inst.setOption({
    title: tit(titulo),
    tooltip: { ...TOOLTIP, trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, textStyle: ejeTxt },
    series: [{
      type: 'pie', radius: ['45%', '70%'], center: ['50%', '50%'], avoidLabelOverlap: true,
      label: { show: false }, data: items,
    }],
  }, true);
}

/** HHEE ejecutadas vs reconocidas por sucursal. */
export function hheeComparado(id, titulo, datos, color) {
  const inst = obtener(id);
  if (!inst) return;
  const cats = datos.map((d) => recortar(d.sucursal));
  inst.setOption({
    title: tit(titulo),
    grid: { ...grid, bottom: 60 },
    tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => (+v).toFixed(1) + ' h' },
    legend: { bottom: 0, textStyle: ejeTxt },
    xAxis: { type: 'category', data: cats, axisLabel: { ...ejeTxt, rotate: 35 } },
    yAxis: { type: 'value', axisLabel: { ...ejeTxt, formatter: '{value} h' }, splitLine: { lineStyle: { color: '#eef2f7' } } },
    series: [
      { name: 'Ejecutadas', type: 'bar', data: datos.map((d) => +d.ejecutadas.toFixed(1)), itemStyle: { color: '#8795a1' } },
      { name: 'Reconocidas', type: 'bar', data: datos.map((d) => +d.reconocidas.toFixed(1)), itemStyle: { color } },
    ],
  }, true);
}

/** Evolución de incidencias por corte (barras + línea de % regularización). */
export function evolucionCortes(id, titulo, serie, color) {
  const inst = obtener(id);
  if (!inst) return;
  const cats = serie.map((s) => s.fecha);
  inst.setOption({
    title: tit(titulo),
    grid: { ...grid, bottom: 60, right: 50 },
    tooltip: { ...TOOLTIP, trigger: 'axis' },
    legend: { bottom: 0, textStyle: ejeTxt },
    xAxis: { type: 'category', data: cats, axisLabel: { ...ejeTxt, rotate: cats.length > 8 ? 35 : 0 } },
    yAxis: [
      { type: 'value', axisLabel: ejeTxt, splitLine: SPLIT, axisLine: { show: false }, axisTick: { show: false } },
      { type: 'value', name: '% Reg.', max: 100, position: 'right', axisLabel: { ...ejeTxt, formatter: '{value}%' }, splitLine: { show: false } },
    ],
    series: [
      { name: 'Actuales', type: 'bar', data: serie.map((s) => s.actuales), itemStyle: { color } },
      { name: 'Nuevas', type: 'bar', data: serie.map((s) => s.nuevas), itemStyle: { color: '#c0392b' } },
      { name: 'Regularizadas', type: 'bar', data: serie.map((s) => s.regularizadas), itemStyle: { color: '#1e8e4e' } },
      { name: '% Regularización', type: 'line', yAxisIndex: 1, smooth: true, data: serie.map((s) => +s.pctRegularizacion.toFixed(1)), itemStyle: { color: '#6a51a3' } },
    ],
  }, true);
}

/** % cumplimiento de malla por sucursal con línea de meta. */
export function mallaPorSucursal(id, titulo, datos, color, meta = 95) {
  const inst = obtener(id);
  if (!inst) return;
  const cats = datos.map((d) => recortar(d.sucursal));
  inst.setOption({
    title: tit(titulo),
    grid: { ...grid, bottom: 60 },
    tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => (+v).toFixed(1) + '%' },
    xAxis: { type: 'category', data: cats, axisLabel: { ...ejeTxt, rotate: 35 } },
    yAxis: { type: 'value', max: 100, axisLabel: { ...ejeTxt, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#eef2f7' } } },
    series: [{
      type: 'bar',
      data: datos.map((d) => ({
        value: +d.valor.toFixed(1),
        itemStyle: { color: d.valor >= meta ? '#1e8e4e' : d.valor >= 90 ? '#b7791f' : '#c0392b' },
      })),
      barMaxWidth: 26,
      markLine: {
        symbol: 'none',
        data: [{ yAxis: meta, name: 'Meta' }],
        lineStyle: { color, type: 'dashed' },
        label: { formatter: 'Meta ' + meta + '%', color },
      },
    }],
  }, true);
}

// --- Nuevos tipos de gráficos (estilo ejecutivo) ----------------------------

/** Barras horizontales con etiqueta de valor + badge (p.ej. trabajadores). */
export function barrasConBadge(id, titulo, datos, color, sufijo = '', etiquetaBadge = 'pers.') {
  const inst = obtener(id);
  if (!inst) return;
  const arr = [...datos].reverse();
  const cats = arr.map((d) => recortar(d.sucursal));
  inst.setOption({
    title: tit(titulo),
    grid: { ...grid, right: 70 },
    tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', axisLabel: { ...ejeTxt, formatter: '{value}' + sufijo }, splitLine: SPLIT, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'category', data: cats, axisLabel: ejeTxt, axisLine: EJE_LINE, axisTick: { show: false } },
    series: [{
      type: 'bar', data: arr.map((d) => d.valor), itemStyle: { color, borderRadius: [0, 3, 3, 0] }, barMaxWidth: 18,
      label: {
        show: true, position: 'right', color: '#5a6b7b', fontSize: 10.5, fontFamily: FUENTE,
        formatter: (p) => `${p.value}${sufijo}` + (arr[p.dataIndex].badge != null ? `  ·  ${arr[p.dataIndex].badge} ${etiquetaBadge}` : ''),
      },
    }],
  }, true);
}

/** Barras horizontales apiladas de dos series (ej. tardanzas vs salidas). */
export function barrasApiladas(id, titulo, datos, nombreA, nombreB, colorA, colorB, sufijo = '') {
  const inst = obtener(id);
  if (!inst) return;
  const arr = [...datos].reverse();
  const cats = arr.map((d) => recortar(d.sucursal));
  const et = { show: true, color: '#fff', fontSize: 9.5, fontFamily: FUENTE, formatter: (p) => (p.value > 0 ? (+p.value).toFixed(1) + sufijo : '') };
  inst.setOption({
    title: tit(titulo),
    grid: { ...grid, bottom: 34, right: 20 },
    tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => (+v).toFixed(1) + sufijo },
    legend: { bottom: 0, textStyle: ejeTxt, itemWidth: 12, itemHeight: 12 },
    xAxis: { type: 'value', axisLabel: { ...ejeTxt, formatter: '{value}' + sufijo }, splitLine: SPLIT, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'category', data: cats, axisLabel: ejeTxt, axisLine: EJE_LINE, axisTick: { show: false } },
    series: [
      { name: nombreA, type: 'bar', stack: 't', data: arr.map((d) => +d.a.toFixed(1)), itemStyle: { color: colorA }, barMaxWidth: 18, label: et },
      { name: nombreB, type: 'bar', stack: 't', data: arr.map((d) => +d.b.toFixed(1)), itemStyle: { color: colorB, borderRadius: [0, 3, 3, 0] }, barMaxWidth: 18, label: et },
    ],
  }, true);
}

/** Barras horizontales agrupadas de 3 series (ejecutadas/aprobadas/cumplidas). */
export function barrasAgrupadas3(id, titulo, datos, colores, sufijo = ' h') {
  const inst = obtener(id);
  if (!inst) return;
  const arr = [...datos].reverse();
  const cats = arr.map((d) => recortar(d.sucursal));
  const serie = (nombre, key, color) => ({
    name: nombre, type: 'bar', data: arr.map((d) => +d[key].toFixed(1)), itemStyle: { color, borderRadius: [0, 2, 2, 0] }, barMaxWidth: 9,
    label: { show: true, position: 'right', color: '#5a6b7b', fontSize: 9, fontFamily: FUENTE, formatter: (p) => (+p.value).toFixed(0) },
  });
  inst.setOption({
    title: tit(titulo),
    grid: { ...grid, bottom: 34, right: 44 },
    tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => (+v).toFixed(1) + sufijo },
    legend: { bottom: 0, textStyle: ejeTxt, itemWidth: 12, itemHeight: 12 },
    xAxis: { type: 'value', axisLabel: { ...ejeTxt, formatter: '{value}' + sufijo }, splitLine: SPLIT, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'category', data: cats, axisLabel: ejeTxt, axisLine: EJE_LINE, axisTick: { show: false } },
    series: [serie('Ejecutadas', 'ejecutadas', colores[0]), serie('Aprobadas', 'aprobadas', colores[1]), serie('Cumplidas', 'cumplidas', colores[2])],
  }, true);
}

/** Barras horizontales divergentes (negativo rojo a la izquierda, positivo azul). */
export function barrasDivergentes(id, titulo, datos, sufijo = ' h') {
  const inst = obtener(id);
  if (!inst) return;
  const arr = [...datos].reverse();
  const cats = arr.map((d) => recortar(d.sucursal));
  inst.setOption({
    title: tit(titulo),
    grid: { ...grid, left: 8, right: 60 },
    tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => (+v).toFixed(1) + sufijo },
    xAxis: { type: 'value', axisLabel: { ...ejeTxt, formatter: '{value}' + sufijo }, splitLine: SPLIT, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'category', data: cats, axisLabel: ejeTxt, axisLine: EJE_LINE, axisTick: { show: false }, position: 'right' },
    series: [{
      type: 'bar', data: arr.map((d) => ({ value: +d.valor.toFixed(1), itemStyle: { color: d.valor < 0 ? '#c0392b' : '#2f80c0', borderRadius: d.valor < 0 ? [3, 0, 0, 3] : [0, 3, 3, 0] } })),
      barMaxWidth: 16,
      label: { show: true, position: 'left', color: '#5a6b7b', fontSize: 10, fontFamily: FUENTE, formatter: (p) => (+p.value).toFixed(0) + sufijo },
    }],
  }, true);
}
