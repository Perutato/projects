// =============================================================================
// app.js
// Controlador principal de la interfaz. Fase 1: Carga de archivos, inventario,
// y pantalla de Calidad de datos (controles CT + listados). El resto de vistas
// quedan como marcadores de posición para las siguientes fases.
// =============================================================================

import {
  getConfig,
  setConfig,
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
import { fmtMiles, fmtPct, fmtHoras } from './config.js';

// ---- Estado en memoria ------------------------------------------------------
let cfg = null;
let worker = null;
let ultimaCalidad = null; // { controles, listados, resumen }
const cola = []; // archivos pendientes de parsear
let procesando = false;

// ---- Arranque ---------------------------------------------------------------
init();

async function init() {
  cfg = await getConfig();
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onWorkerMessage;
  worker.onerror = (e) => {
    mostrarProgreso(false);
    toast('Error en el procesamiento: ' + e.message, 'error');
    console.error(e);
  };

  configurarNavegacion();
  configurarCarga();
  await renderInventario();
  mostrarVista('carga');
  // Si ya hay datos cargados, recalcula para poblar calidad.
  const inv = await getInventario();
  if (inv.length) recalcular();
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
}

// ---- Carga de archivos ------------------------------------------------------
function configurarCarga() {
  const zona = document.getElementById('dropzone');
  const input = document.getElementById('fileInput');

  zona.addEventListener('click', () => input.click());
  zona.addEventListener('dragover', (e) => {
    e.preventDefault();
    zona.classList.add('arrastrando');
  });
  zona.addEventListener('dragleave', () => zona.classList.remove('arrastrando'));
  zona.addEventListener('drop', (e) => {
    e.preventDefault();
    zona.classList.remove('arrastrando');
    agregarArchivos(e.dataTransfer.files);
  });
  input.addEventListener('change', () => {
    agregarArchivos(input.files);
    input.value = '';
  });

  document.getElementById('btnRecalcular').addEventListener('click', recalcular);
  document.getElementById('btnLimpiar').addEventListener('click', onLimpiarTodo);
}

async function agregarArchivos(fileList) {
  const files = [...fileList].filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name));
  if (!files.length) {
    toast('Solo se aceptan archivos .xlsx, .xls o .csv', 'error');
    return;
  }
  for (const f of files) cola.push(f);
  procesarCola();
}

async function procesarCola() {
  if (procesando) return;
  const file = cola.shift();
  if (!file) {
    // Terminó la cola: recalcular una sola vez.
    recalcular();
    return;
  }
  procesando = true;
  mostrarProgreso(true, `Leyendo ${file.name}…`);
  const buffer = await file.arrayBuffer();
  const lote = await siguienteLote();
  worker.postMessage({ type: 'parseFile', buffer, fileName: file.name, lote, cfg }, [buffer]);
}

// ---- Mensajes del worker ----------------------------------------------------
async function onWorkerMessage(e) {
  const m = e.data;
  if (m.type === 'progress') {
    const txt = { leyendo: 'Leyendo archivo…', modelo: 'Cruzando datos…', calidad: 'Calculando calidad…' }[m.fase];
    if (txt) mostrarProgreso(true, txt);
    return;
  }

  if (m.type === 'parsed') {
    await guardarParseado(m.payload);
    procesando = false;
    procesarCola(); // siguiente de la cola
    return;
  }

  if (m.type === 'recalculado') {
    ultimaCalidad = { controles: m.controles, listados: m.listados, resumen: m.resumen, totalFilas: m.totalFilas };
    mostrarProgreso(false);
    renderCalidad();
    actualizarResumenCarga(m);
    toast('Datos recalculados.', 'ok');
    return;
  }

  if (m.type === 'error') {
    mostrarProgreso(false);
    procesando = false;
    toast('Error: ' + m.message, 'error');
    console.error(m.message);
  }
}

async function guardarParseado(p) {
  const inv = await getInventario();
  if (p.tipo === 'desconocido') {
    toast(`No se reconoció el tipo de "${p.fileName}". Verifica los encabezados.`, 'error');
    return;
  }
  if (p.tipo === 'dotacion') {
    await setDotacion({ personas: p.personas, fechaFoto: new Date().toISOString(), fileName: p.fileName });
    // La dotación reemplaza siempre: quitar inventario previo de dotación.
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
    nombre: p.fileName,
    tipo,
    rango: p.rango || '—',
    filas: p.filas || 0,
    fechaCarga: new Date().toISOString(),
    lote: p.lote,
  };
}

// ---- Recalcular -------------------------------------------------------------
async function recalcular() {
  const dot = await getDotacion();
  const asistencia = await getAsistencia();
  const tiempoExtra = await getTiempoExtra();
  if (!dot && !asistencia.length) {
    renderCalidad();
    return;
  }
  // Suma de fechas inválidas registradas en el inventario.
  const inv = await getInventario();
  const fechasInvalidas = 0; // se recalcula realmente en el parseo; aquí 0.
  mostrarProgreso(true, 'Recalculando…');
  worker.postMessage({
    type: 'recalcular',
    personas: dot ? dot.personas : [],
    asistencia,
    tiempoExtra,
    cfg,
    meta: { fechasInvalidas },
  });
}

async function onLimpiarTodo() {
  if (!confirm('¿Eliminar todos los datos cargados? Los parámetros se conservan.')) return;
  await limpiarTodo(false);
  ultimaCalidad = null;
  await renderInventario();
  renderCalidad();
  actualizarResumenCarga(null);
  toast('Datos eliminados.', 'ok');
}

// ---- Inventario -------------------------------------------------------------
async function renderInventario() {
  const inv = await getInventario();
  const cont = document.getElementById('inventario');
  if (!inv.length) {
    cont.innerHTML = '<p class="vacio">No hay archivos cargados todavía.</p>';
    return;
  }
  const tipoLabel = { dotacion: 'Dotación', asistencia: 'Asistencia', tiempoExtra: 'Tiempo Extra' };
  const rows = inv
    .map(
      (x) => `
      <tr>
        <td>${escapeHtml(x.nombre)}</td>
        <td><span class="pill pill-${x.tipo}">${tipoLabel[x.tipo] || x.tipo}</span></td>
        <td>${escapeHtml(x.rango)}</td>
        <td class="num">${fmtMiles(x.filas)}</td>
        <td>${new Date(x.fechaCarga).toLocaleString('es-PE')}</td>
        <td><button class="btn-chico btn-del" data-id="${x.id}">Eliminar</button></td>
      </tr>`
    )
    .join('');
  cont.innerHTML = `
    <table class="tabla">
      <thead><tr><th>Archivo</th><th>Tipo</th><th>Rango de fechas</th><th class="num">Filas</th><th>Fecha de carga</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  cont.querySelectorAll('.btn-del').forEach((b) =>
    b.addEventListener('click', async () => {
      await eliminarArchivo(b.dataset.id);
      await renderInventario();
      recalcular();
    })
  );
}

function actualizarResumenCarga(m) {
  const el = document.getElementById('resumenCarga');
  if (!m || !m.resumen) {
    el.innerHTML = '';
    return;
  }
  const r = m.resumen;
  const tarjeta = (dash, d) => `
    <div class="mini-card">
      <h4>${dash}</h4>
      <div class="mini-row"><span>Personas</span><b>${fmtMiles(d.personas)}</b></div>
      <div class="mini-row"><span>% Asistencia</span><b>${fmtPct(d.pctAsistencia)}</b></div>
      <div class="mini-row"><span>Tardanzas</span><b>${fmtMiles(d.tardanzas)}</b></div>
      <div class="mini-row"><span>% Tardanza</span><b>${fmtPct(d.pctTardanza)}</b></div>
    </div>`;
  el.innerHTML = `
    <h3>Vista previa (verificación)</h3>
    <div class="mini-cards">
      ${tarjeta('Tienda', r.porDash['Tienda'])}
      ${tarjeta('Logística', r.porDash['Logística'])}
    </div>
    <p class="nota">HHEE reconocidas: <b>${fmtPct(r.pctHHEEReconocidas)}</b> · Total filas persona-día: <b>${fmtMiles(m.totalFilas)}</b></p>`;
}

// ---- Calidad de datos -------------------------------------------------------
function renderCalidad() {
  const cont = document.getElementById('vista-calidad');
  if (!ultimaCalidad) {
    cont.querySelector('.contenido').innerHTML =
      '<p class="vacio">Carga datos para ejecutar los controles de calidad.</p>';
    return;
  }
  const { controles, listados } = ultimaCalidad;
  const okCount = controles.filter((c) => c.ok).length;

  const filasCt = controles
    .map(
      (c) => `
      <tr class="${c.ok ? 'ct-ok' : 'ct-error'}">
        <td>${c.id}</td>
        <td>${escapeHtml(c.nombre)}</td>
        <td><span class="badge ${c.ok ? 'badge-ok' : 'badge-error'}">${c.ok ? 'OK' : 'ERROR'}</span></td>
        <td class="detalle">${escapeHtml(c.detalle || '')}</td>
      </tr>`
    )
    .join('');

  const lst = (titulo, arr, render) => `
    <details class="listado">
      <summary>${titulo} <span class="cuenta">${fmtMiles(arr.length)}</span></summary>
      ${arr.length ? `<div class="listado-body">${arr.slice(0, 200).map(render).join('')}</div>${arr.length > 200 ? `<p class="nota">Mostrando 200 de ${fmtMiles(arr.length)}.</p>` : ''}` : '<p class="vacio">Sin observaciones.</p>'}
    </details>`;

  const html = `
    <div class="resumen-ct">
      <span class="badge ${okCount === controles.length ? 'badge-ok' : 'badge-error'}">
        ${okCount}/${controles.length} controles OK
      </span>
    </div>
    <table class="tabla tabla-ct">
      <thead><tr><th>Control</th><th>Descripción</th><th>Estado</th><th>Detalle</th></tr></thead>
      <tbody>${filasCt}</tbody>
    </table>
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
  cont.querySelector('.contenido').innerHTML = html;
}

// ---- Utilidades de UI -------------------------------------------------------
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
