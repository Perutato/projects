// =============================================================================
// app.js
// Controlador principal: navegación, carga de archivos, calidad y dashboards.
// La comunicación con el Web Worker usa un patrón pedido/respuesta (reqId) que
// devuelve promesas; los eventos de progreso llegan aparte.
// =============================================================================

import {
  getConfig,
  getDotacion,
  setDotacion,
  getAsistencia,
  getTiempoExtra,
  appendAsistencia,
  appendTiempoExtra,
  getInventario,
  setInventario,
  siguienteLote,
  eliminarArchivo,
  limpiarTodo,
} from './storage.js';
import { fmtMiles, fmtPct } from './config.js';
import { crearDashboards } from './dashboards.js';
import { crearPaneles } from './panels.js';
import { resizeTodos } from './charts.js';

let cfg = null;
let worker = null;
let dashboards = null;
let paneles = null;
let ultimaCalidad = null;
const cola = [];
let procesando = false;

// Pedido/respuesta con el worker.
let reqSeq = 0;
const pendientes = new Map();
function callWorker(type, payload = {}, transfer = []) {
  return new Promise((resolve, reject) => {
    const reqId = ++reqSeq;
    pendientes.set(reqId, { resolve, reject });
    worker.postMessage({ ...payload, type, reqId }, transfer);
  });
}

init();

async function init() {
  cfg = await getConfig();
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onWorkerMessage;
  worker.onerror = (e) => {
    mostrarProgreso(false);
    toast('Error en el procesamiento: ' + (e.message || e), 'error');
    console.error(e);
  };

  dashboards = crearDashboards({ callWorker, getCfg: () => cfg });
  paneles = crearPaneles({ callWorker, getCfg: () => cfg });

  configurarNavegacion();
  configurarCarga();
  window.addEventListener('resize', () => resizeTodos());
  await renderInventario();
  mostrarVista('carga');

  const inv = await getInventario();
  if (inv.length) await recalcular();
}

function onWorkerMessage(e) {
  const m = e.data;
  if (m.type === 'progress') {
    const txt = { leyendo: 'Leyendo archivo…', modelo: 'Cruzando datos…', calidad: 'Calculando calidad…' }[m.fase];
    if (txt) mostrarProgreso(true, txt);
    return;
  }
  if (m.type === 'error') {
    mostrarProgreso(false);
    toast('Error: ' + m.message, 'error');
    console.error(m.message);
    return;
  }
  if (m.reqId && pendientes.has(m.reqId)) {
    const { resolve, reject } = pendientes.get(m.reqId);
    pendientes.delete(m.reqId);
    if (m.ok) resolve(m.result);
    else reject(new Error(m.error));
  }
}

// ---- Navegación -------------------------------------------------------------
function configurarNavegacion() {
  document.querySelectorAll('[data-vista]').forEach((btn) => {
    btn.addEventListener('click', () => mostrarVista(btn.dataset.vista));
  });
}

function mostrarVista(vista) {
  document.querySelectorAll('.vista').forEach((v) => v.classList.toggle('activa', v.id === 'vista-' + vista));
  document.querySelectorAll('[data-vista]').forEach((b) => b.classList.toggle('activo', b.dataset.vista === vista));
  if (vista === 'calidad') renderCalidad();
  if (vista === 'tienda') dashboards.render('Tienda');
  if (vista === 'logistica') dashboards.render('Logística');
  if (vista === 'complementarios') paneles.renderComplementarios();
  if (vista === 'alertas') paneles.renderAlertas();
}

// ---- Carga ------------------------------------------------------------------
function configurarCarga() {
  const zona = document.getElementById('dropzone');
  const input = document.getElementById('fileInput');
  zona.addEventListener('click', () => input.click());
  zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('arrastrando'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('arrastrando'));
  zona.addEventListener('drop', (e) => { e.preventDefault(); zona.classList.remove('arrastrando'); agregarArchivos(e.dataTransfer.files); });
  input.addEventListener('change', () => { agregarArchivos(input.files); input.value = ''; });
  document.getElementById('btnRecalcular').addEventListener('click', () => recalcular());
  document.getElementById('btnLimpiar').addEventListener('click', onLimpiarTodo);
}

function agregarArchivos(fileList) {
  const files = [...fileList].filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name));
  if (!files.length) { toast('Solo se aceptan archivos .xlsx, .xls o .csv', 'error'); return; }
  for (const f of files) cola.push(f);
  procesarCola();
}

async function procesarCola() {
  if (procesando) return;
  const file = cola.shift();
  if (!file) { await recalcular(); return; }
  procesando = true;
  mostrarProgreso(true, `Leyendo ${file.name}…`);
  try {
    const buffer = await file.arrayBuffer();
    const lote = await siguienteLote();
    const payload = await callWorker('parseFile', { buffer, fileName: file.name, lote, cfg }, [buffer]);
    await guardarParseado(payload);
  } catch (err) {
    toast('Error al leer ' + file.name + ': ' + err.message, 'error');
    console.error(err);
  }
  procesando = false;
  procesarCola();
}

async function guardarParseado(p) {
  const inv = await getInventario();
  if (p.tipo === 'desconocido') {
    toast(`No se reconoció el tipo de "${p.fileName}". Verifica los encabezados.`, 'error');
    return;
  }
  if (p.tipo === 'dotacion') {
    await setDotacion({ personas: p.personas, fechaFoto: new Date().toISOString(), fileName: p.fileName });
    const resto = inv.filter((x) => x.tipo !== 'dotacion');
    resto.push(invItem(p, 'dotacion'));
    await setInventario(resto);
    toast(`Dotación cargada (${fmtMiles(p.filas)} personas).`, 'ok');
  } else if (p.tipo === 'asistencia') {
    await appendAsistencia(p.registros);
    inv.push(invItem(p, 'asistencia'));
    await setInventario(inv);
    toast(`Asistencia acumulada (${fmtMiles(p.filas)} filas).`, 'ok');
  } else if (p.tipo === 'tiempoExtra') {
    await appendTiempoExtra(p.registros);
    inv.push(invItem(p, 'tiempoExtra'));
    await setInventario(inv);
    toast(`Tiempo Extra acumulado (${fmtMiles(p.filas)} filas).`, 'ok');
  }
  await renderInventario();
}

function invItem(p, tipo) {
  return {
    id: `${tipo}-${p.lote}-${Date.now()}`,
    nombre: p.fileName, tipo, rango: p.rango || '—',
    filas: p.filas || 0, fechaCarga: new Date().toISOString(), lote: p.lote,
  };
}

async function recalcular() {
  const dot = await getDotacion();
  const asistencia = await getAsistencia();
  const tiempoExtra = await getTiempoExtra();
  if (!dot && !asistencia.length) { renderCalidad(); return; }
  mostrarProgreso(true, 'Recalculando…');
  try {
    const res = await callWorker('recalcular', {
      personas: dot ? dot.personas : [],
      asistencia, tiempoExtra, cfg, meta: {},
    });
    ultimaCalidad = { controles: res.controles, listados: res.listados, totalFilas: res.totalFilas };
    dashboards.setOpciones(res.filtros);
    paneles.setOpciones(res.filtros);
    mostrarProgreso(false);
    renderCalidad();
    toast('Datos recalculados.', 'ok');
  } catch (err) {
    mostrarProgreso(false);
    toast('Error al recalcular: ' + err.message, 'error');
    console.error(err);
  }
}

async function onLimpiarTodo() {
  if (!confirm('¿Eliminar todos los datos cargados? Los parámetros se conservan.')) return;
  await limpiarTodo(false);
  ultimaCalidad = null;
  await renderInventario();
  renderCalidad();
  toast('Datos eliminados.', 'ok');
}

// ---- Inventario -------------------------------------------------------------
async function renderInventario() {
  const inv = await getInventario();
  const cont = document.getElementById('inventario');
  if (!inv.length) { cont.innerHTML = '<p class="vacio">No hay archivos cargados todavía.</p>'; return; }
  const tipoLabel = { dotacion: 'Dotación', asistencia: 'Asistencia', tiempoExtra: 'Tiempo Extra' };
  const rows = inv.map((x) => `
      <tr>
        <td>${escapeHtml(x.nombre)}</td>
        <td><span class="pill pill-${x.tipo}">${tipoLabel[x.tipo] || x.tipo}</span></td>
        <td>${escapeHtml(x.rango)}</td>
        <td class="num">${fmtMiles(x.filas)}</td>
        <td>${new Date(x.fechaCarga).toLocaleString('es-PE')}</td>
        <td><button class="btn-chico btn-del" data-id="${x.id}">Eliminar</button></td>
      </tr>`).join('');
  cont.innerHTML = `
    <table class="tabla">
      <thead><tr><th>Archivo</th><th>Tipo</th><th>Rango de fechas</th><th class="num">Filas</th><th>Fecha de carga</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  cont.querySelectorAll('.btn-del').forEach((b) =>
    b.addEventListener('click', async () => {
      await eliminarArchivo(b.dataset.id);
      await renderInventario();
      await recalcular();
    })
  );
}

// ---- Calidad ----------------------------------------------------------------
function renderCalidad() {
  const cont = document.getElementById('vista-calidad');
  if (!ultimaCalidad) {
    cont.querySelector('.contenido').innerHTML = '<p class="vacio">Carga datos para ejecutar los controles de calidad.</p>';
    return;
  }
  const { controles, listados } = ultimaCalidad;
  const okCount = controles.filter((c) => c.ok).length;
  const filasCt = controles.map((c) => `
      <tr class="${c.ok ? 'ct-ok' : 'ct-error'}">
        <td>${c.id}</td><td>${escapeHtml(c.nombre)}</td>
        <td><span class="badge ${c.ok ? 'badge-ok' : 'badge-error'}">${c.ok ? 'OK' : 'ERROR'}</span></td>
        <td class="detalle">${escapeHtml(c.detalle || '')}</td>
      </tr>`).join('');
  const lst = (titulo, arr, render) => `
    <details class="listado">
      <summary>${titulo} <span class="cuenta">${fmtMiles(arr.length)}</span></summary>
      ${arr.length ? `<div class="listado-body">${arr.slice(0, 200).map(render).join('')}</div>${arr.length > 200 ? `<p class="nota">Mostrando 200 de ${fmtMiles(arr.length)}.</p>` : ''}` : '<p class="vacio">Sin observaciones.</p>'}
    </details>`;
  cont.querySelector('.contenido').innerHTML = `
    <div class="resumen-ct"><span class="badge ${okCount === controles.length ? 'badge-ok' : 'badge-error'}">${okCount}/${controles.length} controles OK</span></div>
    <table class="tabla tabla-ct"><thead><tr><th>Control</th><th>Descripción</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>${filasCt}</tbody></table>
    <h3>Observaciones adicionales</h3>
    <div class="listados">
      ${lst('DNI con longitud ≠ 8', listados.dniLongitud, (x) => `<div class="li">${x.keyId} · ${escapeHtml(x.nombre)} (${x.longitud} díg.)</div>`)}
      ${lst('DNI duplicados en Dotación', listados.dniDuplicados, (x) => `<div class="li">${x.keyId} · ${x.veces} veces</div>`)}
      ${lst('Personas sin "Exije huella"', listados.sinHuella, (x) => `<div class="li">${x.keyId} · ${escapeHtml(x.nombre)}</div>`)}
      ${lst('Horarios sin modelo', listados.horariosSinModelo, (x) => `<div class="li">${x.keyId} · ${escapeHtml(x.nombre)} · ${escapeHtml(x.horario)}</div>`)}
      ${lst('Validación de horas = "Revisar"', listados.horasRevisar, (x) => `<div class="li">${x.keyId} · ${escapeHtml(x.nombre)} · horario ${x.horasHorario ?? '?'}h vs contrato ${x.horasContrato ?? '?'}h</div>`)}
      ${lst('Cargos que no coinciden', listados.cargosNoCoinciden, (x) => `<div class="li">${x.keyId} · ${escapeHtml(x.cargoOficial)} ≠ ${escapeHtml(x.cargoMarcacion)}</div>`)}
      ${lst('Marcaciones después del cese', listados.marcacionesTrasCese, (x) => `<div class="li">${x.keyId} · ${escapeHtml(x.nombre)} · ${x.fecha}</div>`)}
    </div>`;
}

// ---- UI ---------------------------------------------------------------------
function mostrarProgreso(visible, texto = '') {
  const el = document.getElementById('progreso');
  el.classList.toggle('visible', visible);
  if (texto) el.querySelector('.texto').textContent = texto;
}
let toastTimer = null;
function toast(msg, tipo = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast visible ${tipo}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 4000);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
