// =============================================================================
// charts.js
// Gráficos con Apache ECharts (global window.echarts) y piezas en SVG/HTML.
// Reglas (skill dataviz): una sola escala por gráfico, una tonalidad por serie
// única, paleta categórica validada para series múltiples, barras finas con
// extremo redondeado, cuadrícula recesiva, el valor manda en el tooltip y cada
// marca es clicable (drill-down a los trabajadores).
// =============================================================================

/* global echarts */
import { fmtMiles, fmtDec1, fmtPct } from './config.js';

// ---- Tokens de gráfico (espejo de las variables CSS) -----------------------
export const T = {
  fuente: 'Bahnschrift, Barlow, "Segoe UI", system-ui, -apple-system, sans-serif',
  surface: '#fcfcfb',
  ink: '#14181b',
  ink2: '#4f5559',
  muted: '#868b8f',
  grid: '#e4e5e0',
  axis: '#c5c7c0',
  // Categórica validada (slots 1-3, todos los pares) — sigue a la entidad.
  s1: '#2a78d6', // entrada / ejecutadas
  s2: '#eb6834', // salida / aprobadas
  s3: '#1baf7a', // cumplidas
  // Divergente (azul ↔ rojo, gris en el medio).
  pos: '#2a78d6',
  neg: '#e34948',
  // Secuencial (azul, de casi nada a mucho).
  rampa: ['#eef0ec', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
  // Estado (siempre con etiqueta).
  ok: '#0ca30c',
  warn: '#fab219',
  serio: '#ec835a',
  critico: '#d03b3b',
};

const instancias = new Map();

function obtener(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  let inst = instancias.get(id);
  if (inst && !inst.isDisposed() && inst.getDom() !== el) { inst.dispose(); inst = null; }
  if (!inst || inst.isDisposed()) {
    inst = echarts.init(el, null, { renderer: 'canvas' });
    instancias.set(id, inst);
  }
  return inst;
}

/** Redimensiona todos los gráficos vivos. */
export function resizeTodos() {
  for (const inst of instancias.values()) if (!inst.isDisposed()) inst.resize();
}

/** Elimina todas las instancias (al cambiar de vista). */
export function limpiarGraficos() {
  for (const inst of instancias.values()) if (!inst.isDisposed()) inst.dispose();
  instancias.clear();
}

/** Alto de un gráfico de barras horizontales según el número de categorías. */
export function altoBarras(n, porBarra = 28) {
  return Math.max(150, n * porBarra + 56);
}

// ---- Utilidades ------------------------------------------------------------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function recortar(s, n = 24) {
  return s && s.length > n ? s.slice(0, n - 1) + '…' : s;
}
const ejeTxt = { color: T.muted, fontSize: 11, fontFamily: T.fuente };
const SPLIT = { lineStyle: { color: T.grid, width: 1 } };
const BASE = { lineStyle: { color: T.axis, width: 1 } };

/** Tooltip: el valor primero (fuerte), luego la etiqueta; clave de línea por serie. */
function tooltipHTML(titulo, filas, pista = 'Clic para ver los trabajadores') {
  return `<div class="tt"><div class="tt-t">${esc(titulo)}</div>${filas
    .map((r) => `<div class="tt-r"><span class="tt-k" style="background:${r.color}"></span><b>${esc(r.valor)}</b><span>${esc(r.nombre)}</span></div>`)
    .join('')}${pista ? `<div class="tt-h">${esc(pista)}</div>` : ''}</div>`;
}
const TOOLTIP = {
  backgroundColor: '#14181b', borderWidth: 0, padding: [9, 12],
  textStyle: { color: '#fff', fontSize: 12, fontFamily: T.fuente },
  extraCssText: 'border-radius:4px;box-shadow:0 8px 24px rgba(20,24,27,.22);',
  confine: true,
};
// Etiqueta de eje: enteros sin decimales, fracciones con uno (evita "0 h, 0 h, 1 h").
function ejeNum(v) { return Number.isInteger(v) ? fmtMiles(v) : fmtDec1(v); }
function fmtValor(v, sufijo, dec) {
  if (sufijo === '%') return fmtPct(v);
  const n = dec ? fmtDec1(v) : fmtMiles(v);
  return n + (sufijo || '');
}

function base(id, opciones, onClick, altura) {
  const el = document.getElementById(id);
  if (!el) return null;
  if (altura) el.style.height = altura + 'px';
  const inst = obtener(id);
  if (!inst) return null;
  inst.setOption({ textStyle: { fontFamily: T.fuente }, animationDuration: 350, ...opciones }, true);
  inst.resize();
  inst.off('click');
  if (onClick) inst.on('click', onClick);
  return inst;
}

// ---- Barras horizontales (una serie) ----------------------------------------
/**
 * @param {object} o { datos:[{sucursal,valor,badge?}], color, sufijo, decimales,
 *   etiquetaBadge, meta, onClick(sucursal), nombreSerie }
 */
export function barras(id, o) {
  const arr = [...o.datos].reverse();
  const cats = arr.map((d) => d.sucursal);
  const opciones = {
    grid: { left: 8, right: o.badge ? 92 : 52, top: o.meta != null ? 24 : 8, bottom: 24, containLabel: true },
    tooltip: {
      ...TOOLTIP, trigger: 'item',
      formatter: (p) => {
        const d = arr[p.dataIndex];
        const filas = [{ color: o.color, valor: fmtValor(d.valor, o.sufijo, o.decimales), nombre: o.nombreSerie || '' }];
        if (d.badge != null) filas.push({ color: T.muted, valor: fmtMiles(d.badge), nombre: o.etiquetaBadge || 'personas' });
        return tooltipHTML(d.sucursal, filas);
      },
    },
    xAxis: {
      type: 'value', max: o.sufijo === '%' ? 100 : null,
      axisLabel: { ...ejeTxt, formatter: (v) => (o.sufijo === '%' ? v + '%' : ejeNum(v)) },
      splitLine: SPLIT, axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: {
      type: 'category', data: cats, axisLine: BASE, axisTick: { show: false },
      axisLabel: { ...ejeTxt, color: T.ink2, formatter: (v) => recortar(v) },
    },
    series: [{
      type: 'bar', data: arr.map((d) => d.valor), barMaxWidth: 18, barCategoryGap: '34%',
      itemStyle: { color: o.color, borderRadius: [0, 4, 4, 0] },
      emphasis: { itemStyle: { color: o.colorHover || o.color, opacity: 0.85 } },
      label: {
        show: true, position: 'right', color: T.ink2, fontSize: 11, fontFamily: T.fuente,
        formatter: (p) => {
          const d = arr[p.dataIndex];
          return fmtValor(d.valor, o.sufijo, o.decimales) + (d.badge != null ? `  ·  ${fmtMiles(d.badge)} ${o.etiquetaBadge || 'pers.'}` : '');
        },
      },
      markLine: o.meta != null ? {
        symbol: 'none', silent: true,
        lineStyle: { color: T.ink, width: 1, type: 'solid' },
        label: { formatter: `Meta ${o.meta}%`, color: T.ink, fontSize: 11, fontFamily: T.fuente, position: 'end', rotate: 0, distance: 4 },
        data: [{ xAxis: o.meta }],
      } : undefined,
    }],
  };
  return base(id, opciones, o.onClick ? (p) => o.onClick(arr[p.dataIndex].sucursal) : null, altoBarras(arr.length));
}

// ---- Barras apiladas (dos series) --------------------------------------------
/** o: { datos:[{sucursal,a,b}], series:[{key:'a',nombre,color},{key:'b',...}], sufijo, onClick(sucursal, key) } */
export function apiladas(id, o) {
  const arr = [...o.datos].reverse();
  const cats = arr.map((d) => d.sucursal);
  const opciones = {
    grid: { left: 8, right: 56, top: 34, bottom: 24, containLabel: true },
    legend: { top: 0, left: 0, icon: 'rect', itemWidth: 10, itemHeight: 10, textStyle: { ...ejeTxt, color: T.ink2 } },
    tooltip: {
      ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(20,24,27,.04)' } },
      formatter: (ps) => {
        const d = arr[ps[0].dataIndex];
        const total = o.series.reduce((s, x) => s + d[x.key], 0);
        return tooltipHTML(d.sucursal, [
          ...o.series.map((x) => ({ color: x.color, valor: fmtValor(d[x.key], o.sufijo, true), nombre: x.nombre })),
          { color: 'transparent', valor: fmtValor(total, o.sufijo, true), nombre: 'Total' },
        ], 'Clic en un tramo para ver los trabajadores');
      },
    },
    xAxis: {
      type: 'value', axisLabel: { ...ejeTxt, formatter: (v) => ejeNum(v) + (o.sufijo || '') },
      splitLine: SPLIT, axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: {
      type: 'category', data: cats, axisLine: BASE, axisTick: { show: false },
      axisLabel: { ...ejeTxt, color: T.ink2, formatter: (v) => recortar(v) },
    },
    series: o.series.map((x, i) => ({
      name: x.nombre, type: 'bar', stack: 't', barMaxWidth: 18, barCategoryGap: '34%',
      data: arr.map((d) => +d[x.key].toFixed(2)),
      // El borde del color de la superficie hace de "hueco" de 2px entre tramos.
      itemStyle: { color: x.color, borderColor: T.surface, borderWidth: 1, borderRadius: i === o.series.length - 1 ? [0, 4, 4, 0] : 0 },
      emphasis: { focus: 'series' },
      label: i === o.series.length - 1 ? {
        show: true, position: 'right', color: T.ink2, fontSize: 11, fontFamily: T.fuente,
        formatter: (p) => fmtValor(o.series.reduce((s, k) => s + arr[p.dataIndex][k.key], 0), o.sufijo, true),
      } : { show: false },
    })),
  };
  return base(id, opciones, o.onClick ? (p) => o.onClick(arr[p.dataIndex].sucursal, o.series[p.seriesIndex].key) : null, altoBarras(arr.length) + 26);
}

// ---- Barras agrupadas (tres series, misma unidad) ----------------------------
export function agrupadas(id, o) {
  const arr = [...o.datos].reverse();
  const cats = arr.map((d) => d.sucursal);
  const opciones = {
    grid: { left: 8, right: 48, top: 34, bottom: 24, containLabel: true },
    legend: { top: 0, left: 0, icon: 'rect', itemWidth: 10, itemHeight: 10, textStyle: { ...ejeTxt, color: T.ink2 } },
    tooltip: {
      ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(20,24,27,.04)' } },
      formatter: (ps) => {
        const d = arr[ps[0].dataIndex];
        return tooltipHTML(d.sucursal, o.series.map((x) => ({ color: x.color, valor: fmtValor(d[x.key], o.sufijo, true), nombre: x.nombre })));
      },
    },
    xAxis: {
      type: 'value', axisLabel: { ...ejeTxt, formatter: (v) => ejeNum(v) + (o.sufijo || '') },
      splitLine: SPLIT, axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: {
      type: 'category', data: cats, axisLine: BASE, axisTick: { show: false },
      axisLabel: { ...ejeTxt, color: T.ink2, formatter: (v) => recortar(v) },
    },
    series: o.series.map((x) => ({
      name: x.nombre, type: 'bar', barMaxWidth: 7, barGap: '30%', barCategoryGap: '30%',
      data: arr.map((d) => +d[x.key].toFixed(2)),
      itemStyle: { color: x.color, borderRadius: [0, 3, 3, 0] },
      emphasis: { focus: 'series' },
    })),
  };
  return base(id, opciones, o.onClick ? (p) => o.onClick(arr[p.dataIndex].sucursal, o.series[p.seriesIndex].key) : null, altoBarras(arr.length, 36) + 26);
}

// ---- Barras divergentes (brecha) --------------------------------------------
export function divergentes(id, o) {
  const arr = [...o.datos].reverse();
  const cats = arr.map((d) => d.sucursal);
  const opciones = {
    grid: { left: 8, right: 16, top: 8, bottom: 24, containLabel: true },
    tooltip: {
      ...TOOLTIP, trigger: 'item',
      formatter: (p) => {
        const d = arr[p.dataIndex];
        return tooltipHTML(d.sucursal, [{
          color: d.valor < 0 ? T.neg : T.pos,
          valor: fmtValor(d.valor, o.sufijo, true),
          nombre: d.valor < 0 ? 'sobre-ejecución (se trabajó más de lo aprobado)' : 'sub-ejecución (sobró aprobado)',
        }]);
      },
    },
    xAxis: {
      type: 'value', axisLabel: { ...ejeTxt, formatter: (v) => ejeNum(v) + (o.sufijo || '') },
      // Holgura a ambos lados para que la etiqueta de valor no pise el nombre.
      boundaryGap: ['22%', '22%'],
      splitLine: SPLIT, axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: {
      type: 'category', data: cats, axisTick: { show: false },
      axisLine: { show: true, onZero: true, lineStyle: { color: T.ink2, width: 1 } },
      axisLabel: { ...ejeTxt, color: T.ink2, formatter: (v) => recortar(v) },
    },
    series: [{
      type: 'bar', barMaxWidth: 16,
      data: arr.map((d) => ({
        value: +d.valor.toFixed(2),
        itemStyle: { color: d.valor < 0 ? T.neg : T.pos, borderRadius: d.valor < 0 ? [4, 0, 0, 4] : [0, 4, 4, 0] },
      })),
      label: {
        show: true, color: T.ink2, fontSize: 11, fontFamily: T.fuente,
        position: 'outside',
        formatter: (p) => fmtValor(p.value, o.sufijo, true),
      },
    }],
  };
  return base(id, opciones, o.onClick ? (p) => o.onClick(arr[p.dataIndex].sucursal) : null, altoBarras(arr.length));
}

// ---- Línea temporal (una métrica a la vez) ----------------------------------
export function linea(id, o) {
  const s = o.serie;
  const ultimo = s.length - 1;
  const opciones = {
    grid: { left: 8, right: 64, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      ...TOOLTIP, trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: T.axis, width: 1 } },
      formatter: (ps) => {
        const p = ps[0];
        return tooltipHTML(s[p.dataIndex].periodo, [{ color: o.color, valor: fmtValor(p.value, o.sufijo, o.decimales), nombre: o.nombre }], 'Clic para ver los trabajadores de ese período');
      },
    },
    xAxis: {
      type: 'category', data: s.map((x) => x.periodo), boundaryGap: false,
      axisLine: BASE, axisTick: { show: false }, axisLabel: { ...ejeTxt, hideOverlap: true },
    },
    yAxis: {
      type: 'value', min: o.sufijo === '%' ? (v) => Math.max(0, Math.floor((v.min - 2) / 5) * 5) : 0, max: o.sufijo === '%' ? 100 : null,
      axisLabel: { ...ejeTxt, formatter: (v) => (o.sufijo === '%' ? v + '%' : ejeNum(v)) },
      splitLine: SPLIT, axisLine: { show: false }, axisTick: { show: false },
    },
    series: [{
      type: 'line', data: s.map((x) => +(+x[o.campo]).toFixed(2)), smooth: false,
      lineStyle: { color: o.color, width: 2, cap: 'round', join: 'round' },
      itemStyle: { color: o.color, borderColor: T.surface, borderWidth: 2 },
      symbol: 'circle', symbolSize: (v, p) => (p.dataIndex === ultimo ? 9 : 6),
      showSymbol: s.length <= 45,
      areaStyle: { color: o.color, opacity: 0.08 },
      emphasis: { scale: 1.6 },
      endLabel: {
        show: true, color: T.ink, fontSize: 12, fontWeight: 600, fontFamily: T.fuente,
        formatter: (p) => fmtValor(p.value, o.sufijo, o.decimales),
      },
    }],
  };
  return base(id, opciones, o.onClick ? (p) => o.onClick(s[p.dataIndex].clave) : null, o.altura || 280);
}

// ---- Mapa de calor sucursal × período ----------------------------------------
/** o: { malla, campo: 'incid'|'tard'|'fugaH'|'noPlan'|'pctAsist', nombre, sufijo, onClick(sucursal, clavePeriodo) } */
export function calor(id, o) {
  const m = o.malla;
  const n = m.sucursales.length;
  const valorDe = (c) => {
    if (o.campo === 'pctAsist') return c.esp ? (c.pres / c.esp) * 100 : null;
    if (o.campo === 'fugaH') return c.fugaMin / 60;
    return c[o.campo];
  };
  const data = [];
  let max = 0;
  let min = Infinity;
  for (const c of m.celdas) {
    const v = valorDe(c);
    if (v == null) continue;
    data.push([c.j, n - 1 - c.i, +v.toFixed(2)]);
    if (v > max) max = v;
    if (v < min) min = v;
  }
  // En % de asistencia "más es mejor": la rampa se invierte (más oscuro = peor).
  const invertir = o.campo === 'pctAsist';
  const rampa = invertir ? [...T.rampa].reverse() : T.rampa;
  const sucs = [...m.sucursales].reverse();
  const opciones = {
    grid: { left: 8, right: 16, top: 44, bottom: 8, containLabel: true },
    tooltip: {
      ...TOOLTIP, trigger: 'item',
      formatter: (p) => {
        const suc = sucs[p.value[1]];
        const per = m.periodos[p.value[0]];
        return tooltipHTML(`${suc} · ${per.label}`, [{ color: rampa[5], valor: fmtValor(p.value[2], o.sufijo, o.campo === 'fugaH'), nombre: o.nombre }]);
      },
    },
    visualMap: {
      min: invertir ? Math.max(0, Math.floor(min)) : 0, max: invertir ? 100 : Math.max(1, Math.ceil(max)),
      calculable: false, orient: 'horizontal', top: 0, right: 16, itemWidth: 10, itemHeight: 140,
      text: invertir ? ['100%', 'menor'] : ['más', '0'], textStyle: { ...ejeTxt },
      inRange: { color: rampa },
    },
    xAxis: {
      type: 'category', data: m.periodos.map((p) => p.label), position: 'top', splitArea: { show: false },
      axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...ejeTxt, hideOverlap: true },
    },
    yAxis: {
      type: 'category', data: sucs, axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { ...ejeTxt, color: T.ink2, formatter: (v) => recortar(v, 22) },
    },
    series: [{
      type: 'heatmap', data,
      itemStyle: { borderColor: T.surface, borderWidth: 2, borderRadius: 2 },
      emphasis: { itemStyle: { borderColor: T.ink, borderWidth: 1 } },
    }],
  };
  const alto = Math.max(200, n * 22 + 80);
  return base(id, opciones, o.onClick ? (p) => o.onClick(sucs[p.value[1]], m.periodos[p.value[0]].clave) : null, alto);
}

// ---- Evolución de incidencias por corte (Histórico) -------------------------
// Una sola escala (conteos). El % de regularización vive en la tabla, no en un
// segundo eje.
export function evolucionCortes(id, titulo, serie) {
  const opciones = {
    grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0, icon: 'rect', itemWidth: 10, itemHeight: 10, textStyle: { ...ejeTxt, color: T.ink2 } },
    tooltip: {
      ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(20,24,27,.04)' } },
      formatter: (ps) => tooltipHTML(serie[ps[0].dataIndex].fecha,
        ps.map((p) => ({ color: p.color, valor: fmtMiles(p.value), nombre: p.seriesName })), null),
    },
    xAxis: { type: 'category', data: serie.map((s) => s.fecha), axisLine: BASE, axisTick: { show: false }, axisLabel: ejeTxt },
    yAxis: { type: 'value', axisLabel: ejeTxt, splitLine: SPLIT, axisLine: { show: false }, axisTick: { show: false } },
    series: [
      { name: 'Actuales', type: 'bar', barMaxWidth: 18, data: serie.map((s) => s.actuales), itemStyle: { color: T.s1, borderRadius: [4, 4, 0, 0] } },
      { name: 'Nuevas', type: 'bar', barMaxWidth: 18, data: serie.map((s) => s.nuevas), itemStyle: { color: T.s2, borderRadius: [4, 4, 0, 0] } },
      { name: 'Regularizadas', type: 'bar', barMaxWidth: 18, data: serie.map((s) => s.regularizadas), itemStyle: { color: T.s3, borderRadius: [4, 4, 0, 0] } },
    ],
  };
  return base(id, opciones, null, 300);
}

// ---- Sparkline (SVG en línea, sin ECharts) ----------------------------------
/** Devuelve un SVG con la tendencia en gris y el último punto en el acento. */
export function sparkline(valores, color, ancho = 120, alto = 30) {
  const v = valores.filter((x) => Number.isFinite(x));
  if (v.length < 2) return '';
  const min = Math.min(...v);
  const max = Math.max(...v);
  const rango = max - min || 1;
  const x = (i) => 2 + (i * (ancho - 4)) / (v.length - 1);
  const y = (val) => alto - 3 - ((val - min) / rango) * (alto - 6);
  const d = v.map((val, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(val).toFixed(1)}`).join('');
  const lx = x(v.length - 1);
  const ly = y(v[v.length - 1]);
  return `<svg class="spark" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${T.axis}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3" fill="${color}" stroke="${T.surface}" stroke-width="1.5"/>
  </svg>`;
}
