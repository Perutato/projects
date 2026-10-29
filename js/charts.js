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

const grid = { left: 8, right: 16, top: 30, bottom: 8, containLabel: true };
const ejeTxt = { color: '#5a6b7b', fontSize: 11 };

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
    title: { text: titulo, left: 0, top: 0, textStyle: { fontSize: 13, color: '#1f2933' } },
    grid,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => v + sufijo },
    xAxis: { type: 'value', axisLabel: { ...ejeTxt, formatter: '{value}' + sufijo }, splitLine: { lineStyle: { color: '#eef2f7' } } },
    yAxis: { type: 'category', data: cats, axisLabel: ejeTxt },
    series: [{ type: 'bar', data: vals, itemStyle: { color, borderRadius: [0, 3, 3, 0] }, barMaxWidth: 18 }],
  }, true);
}

/** Doble serie: días no planificados + trabajadores afectados. */
export function dobleSerie(id, titulo, datos, color) {
  const inst = obtener(id);
  if (!inst) return;
  const cats = datos.map((d) => recortar(d.sucursal));
  inst.setOption({
    title: { text: titulo, left: 0, top: 0, textStyle: { fontSize: 13, color: '#1f2933' } },
    grid: { ...grid, bottom: 60 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
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
    title: { text: titulo, left: 0, top: 0, textStyle: { fontSize: 13, color: '#1f2933' } },
    grid: { ...grid, bottom: 60, right: 40 },
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0, textStyle: ejeTxt },
    xAxis: { type: 'category', data: cats, axisLabel: { ...ejeTxt, rotate: cats.length > 12 ? 40 : 0 } },
    yAxis: [
      { type: 'value', name: 'Días / Horas', axisLabel: ejeTxt, splitLine: { lineStyle: { color: '#eef2f7' } } },
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
    title: { text: titulo, left: 0, top: 0, textStyle: { fontSize: 13, color: '#1f2933' } },
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
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
    title: { text: titulo, left: 0, top: 0, textStyle: { fontSize: 13, color: '#1f2933' } },
    grid: { ...grid, bottom: 60 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => (+v).toFixed(1) + ' h' },
    legend: { bottom: 0, textStyle: ejeTxt },
    xAxis: { type: 'category', data: cats, axisLabel: { ...ejeTxt, rotate: 35 } },
    yAxis: { type: 'value', axisLabel: { ...ejeTxt, formatter: '{value} h' }, splitLine: { lineStyle: { color: '#eef2f7' } } },
    series: [
      { name: 'Ejecutadas', type: 'bar', data: datos.map((d) => +d.ejecutadas.toFixed(1)), itemStyle: { color: '#8795a1' } },
      { name: 'Reconocidas', type: 'bar', data: datos.map((d) => +d.reconocidas.toFixed(1)), itemStyle: { color } },
    ],
  }, true);
}

/** % cumplimiento de malla por sucursal con línea de meta. */
export function mallaPorSucursal(id, titulo, datos, color, meta = 95) {
  const inst = obtener(id);
  if (!inst) return;
  const cats = datos.map((d) => recortar(d.sucursal));
  inst.setOption({
    title: { text: titulo, left: 0, top: 0, textStyle: { fontSize: 13, color: '#1f2933' } },
    grid: { ...grid, bottom: 60 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => (+v).toFixed(1) + '%' },
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
