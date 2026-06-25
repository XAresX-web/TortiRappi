/* ============================================================
   admin.js — Panel de administración (conectado a Supabase)
   ============================================================ */

let perfil = null;
let org    = null;
let pedidosCache = [];
let repsCache    = [];
let pedidoAsignarId = null;
let pedidoTrackingActual = null;
let productosCache = [];

let gmap = null;
let mapMarkers = {}; // repartidor_id -> marker

// ── INIT ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  perfil = await Auth.requireAuth(['dueño', 'admin']);
  if (!perfil) return;
  org = perfil.organizaciones;

  document.getElementById('org-nombre').textContent = org.nombre;
  document.getElementById('org-plan').textContent   = `Plan: ${org.plan} · hasta ${org.max_repartidores} repartidores`;
  document.getElementById('user-av').textContent    = perfil.nombre_completo.charAt(0).toUpperCase();

  setVal('cfg-nombre', org.nombre);
  setVal('cfg-tel', org.telefono_wa || '');
  setVal('cfg-dir', org.direccion || '');
  setVal('cfg-plan', org.plan);

  setupOnlineOffline();
  registrarSW();

  await cargarTodo();
  suscribirRealtime();

  whenGoogleMapsReady(() => initMapa());

  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
});

// ── CARGA DE DATOS ────────────────────────────────────────
async function cargarTodo() {
  await Promise.all([cargarPedidos(), cargarRepartidores(), cargarUbicaciones(), cargarProductos()]);
  renderMetricas();
  renderPedidos();
  renderReps();
  renderProductos();
  renderRendimiento();
  poblarSelectRep();
  poblarSelectProd();
  actualizarMapa();
}

async function cargarPedidos() {
  const hoyInicio = new Date(); hoyInicio.setHours(0,0,0,0);
  const { data, error } = await supabaseClient
    .from('pedidos')
    .select('*')
    .gte('creado_en', hoyInicio.toISOString())
    .order('creado_en', { ascending: false });

  if (error) { console.error('[Pedidos]', error); toast('Error cargando pedidos'); return; }
  pedidosCache = data || [];
}

async function cargarRepartidores() {
  const { data, error } = await supabaseClient
    .from('perfiles')
    .select('*')
    .eq('rol', 'repartidor')
    .order('nombre_completo');

  if (error) { console.error('[Reps]', error); return; }
  repsCache = data || [];
}

let ubicacionesCache = {};
async function cargarUbicaciones() {
  const { data, error } = await supabaseClient
    .from('ubicaciones_repartidores')
    .select('*');
  if (error) { console.error('[Ubicaciones]', error); return; }
  ubicacionesCache = {};
  (data || []).forEach(u => ubicacionesCache[u.repartidor_id] = u);
}

async function cargarProductos() {
  const { data, error } = await supabaseClient
    .from('productos')
    .select('*')
    .order('orden', { ascending: true });
  if (error) { console.error('[Productos]', error); return; }
  productosCache = data || [];
}

// ── REALTIME ──────────────────────────────────────────────
function suscribirRealtime() {
  supabaseClient
    .channel('admin-pedidos')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `organizacion_id=eq.${org.id}` },
      async (payload) => {
        await cargarPedidos();
        renderMetricas(); renderPedidos(); renderRendimiento();
        if (payload.eventType === 'INSERT' && payload.new) {
          const p = payload.new;
          playNotifSound();
          showNotification(
            `Nuevo pedido #${String(p.numero).padStart(3,'0')}`,
            `${p.cliente_nombre} — ${p.direccion || ''}`,
            `pedido-${p.id}`
          );
          toast(`Nuevo pedido #${String(p.numero).padStart(3,'0')} de ${p.cliente_nombre}`);
        } else {
          toast('Pedidos actualizados');
        }
      })
    .subscribe();

  supabaseClient
    .channel('admin-ubicaciones')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ubicaciones_repartidores', filter: `organizacion_id=eq.${org.id}` },
      async (payload) => {
        if (payload.new) ubicacionesCache[payload.new.repartidor_id] = payload.new;
        actualizarMapa();
      })
    .subscribe();

  supabaseClient
    .channel('admin-productos')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'productos', filter: `organizacion_id=eq.${org.id}` },
      async () => {
        await cargarProductos();
        renderProductos();
        poblarSelectProd();
      })
    .subscribe();
}

// ── MÉTRICAS ──────────────────────────────────────────────
function renderMetricas() {
  const total     = pedidosCache.length;
  const entregado = pedidosCache.filter(p => p.estado === 'entregado').length;
  const en_ruta   = pedidosCache.filter(p => p.estado === 'en_ruta').length;
  const pendiente = pedidosCache.filter(p => p.estado === 'pendiente').length;

  document.getElementById('metricas').innerHTML = `
    <div class="metric"><div class="metric-val">${total}</div><div class="metric-lbl">Pedidos hoy</div></div>
    <div class="metric"><div class="metric-val" style="color:var(--green)">${entregado}</div><div class="metric-lbl">Entregados</div></div>
    <div class="metric"><div class="metric-val" style="color:var(--amber)">${en_ruta}</div><div class="metric-lbl">En ruta</div></div>
    <div class="metric"><div class="metric-val" style="color:var(--accent)">${pendiente}</div><div class="metric-lbl">Pendientes</div></div>
  `;
}

// ── MAPA GOOGLE ───────────────────────────────────────────
function initMapa() {
  const center = { lat: 20.6411, lng: -103.3137 }; // Tlaquepaque, Jalisco
  gmap = new google.maps.Map(document.getElementById('gmap-admin'), {
    zoom: 13,
    center,
    disableDefaultUI: true,
    zoomControl: true,
    styles: [
      { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    ],
  });
  actualizarMapa();
}

function actualizarMapa() {
  if (!gmap) return;

  const activos = repsCache.filter(r => r.activo);
  const bounds  = new google.maps.LatLngBounds();
  let huboPunto = false;

  // Limpiar markers de repartidores que ya no están activos
  for (const id in mapMarkers) {
    if (!activos.find(r => r.id === id) || !ubicacionesCache[id]) {
      mapMarkers[id].setMap(null);
      delete mapMarkers[id];
    }
  }

  activos.forEach(r => {
    const u = ubicacionesCache[r.id];
    if (!u) return;
    const pos = { lat: u.lat, lng: u.lng };
    bounds.extend(pos);
    huboPunto = true;

    if (mapMarkers[r.id]) {
      mapMarkers[r.id].setPosition(pos);
    } else {
      mapMarkers[r.id] = new google.maps.Marker({
        position: pos,
        map: gmap,
        label: { text: r.nombre_completo.charAt(0).toUpperCase(), color: '#fff', fontWeight: 'bold' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: '#1D9E75',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
          scale: 16,
        },
        title: r.nombre_completo,
      });
    }
  });

  if (huboPunto) gmap.fitBounds(bounds, 60);

  // Chips de repartidores activos
  document.getElementById('rep-chips').innerHTML = activos
    .filter(r => ubicacionesCache[r.id])
    .map(r => {
      const u = ubicacionesCache[r.id];
      const mins = Math.floor((Date.now() - new Date(u.actualizado_en)) / 60000);
      const reciente = mins < 3;
      return `<span class="badge ${reciente ? 'badge-teal' : 'badge-gray'}">
        ${reciente ? '🟢' : '⚪'} ${r.nombre_completo.split(' ')[0]} · hace ${mins < 1 ? '<1' : mins} min
      </span>`;
    }).join('') || '<span style="font-size:12px;color:var(--gray);">Sin repartidores reportando ubicación aún.</span>';
}

// ── PEDIDOS ───────────────────────────────────────────────
function renderPedidos() {
  const filtro = document.getElementById('filtro-estado').value;
  const lista  = filtro ? pedidosCache.filter(p => p.estado === filtro) : pedidosCache;
  const el     = document.getElementById('lista-pedidos');

  if (!lista.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="icon">📦</div>
      ${filtro ? 'No hay pedidos con ese estado.' : 'No hay pedidos hoy. ¡Crea el primero!'}
    </div>`;
    return;
  }

  el.innerHTML = lista.map(p => {
    const repNombre  = repNombrePorId(p.repartidor_id);
    const claseBorde = p.estado === 'entregado' ? 'entregado' : (p.urgente ? 'urgente' : '');
    const badgeEstado = { pendiente: 'badge-red', en_ruta: 'badge-amber', entregado: 'badge-green' }[p.estado];
    const labelEstado = { pendiente: 'Pendiente', en_ruta: 'En ruta', entregado: 'Entregado' }[p.estado];
    const hora = p.creado_en ? new Date(p.creado_en).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '';

    return `
      <div class="pedido-item ${claseBorde}">
        <div class="pedido-num">#${String(p.numero).padStart(3,'0')}</div>
        <div class="pedido-info">
          <div class="pedido-cliente">${escapeHtml(p.cliente_nombre)} ${p.urgente ? '🔴' : ''}</div>
          <div class="pedido-detalle">${escapeHtml(p.direccion || '')} · ${escapeHtml(p.producto || '')}</div>
          <div class="pedido-meta">
            <span class="badge ${badgeEstado}">${labelEstado}</span>
            ${repNombre ? `<span class="badge badge-teal">🛵 ${repNombre}</span>` : ''}
            ${hora ? `<span class="badge badge-gray">🕐 ${hora}</span>` : ''}
            ${p.total ? `<span class="badge badge-gray">$${p.total}</span>` : ''}
          </div>
        </div>
        <div class="pedido-actions">
          <button class="btn btn-outline btn-sm" onclick="verDetalle(${p.id})">Ver</button>
          ${p.estado !== 'entregado' ? `<button class="btn btn-outline btn-sm" onclick="abrirAsignar(${p.id})">Asignar</button>` : ''}
          <button class="btn btn-wa btn-sm" onclick="enviarWA(${p.id})">WA</button>
        </div>
      </div>`;
  }).join('');
}

// ── REPARTIDORES ──────────────────────────────────────────
function renderReps() {
  const el = document.getElementById('lista-reps');
  const limitMsg = document.getElementById('rep-limit-msg');
  const addBtn = document.getElementById('btn-add-rep');

  if (repsCache.length >= org.max_repartidores) {
    limitMsg.style.display = 'flex';
    limitMsg.textContent = `Has alcanzado el límite de ${org.max_repartidores} repartidores de tu plan "${org.plan}". Actualiza tu plan para agregar más.`;
    addBtn.disabled = true;
  } else {
    limitMsg.style.display = 'none';
    addBtn.disabled = false;
  }

  if (!repsCache.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">🛵</div>Sin repartidores. Agrega el primero.</div>';
    return;
  }

  const coloresBg   = ['var(--primary-light)', 'var(--blue-light)', 'var(--amber-light)', 'var(--accent-light)'];
  const coloresText = ['var(--primary-dark)',  'var(--blue)',       'var(--amber-dark)',   'var(--accent)'];

  el.innerHTML = repsCache.map((r, i) => {
    const pedRep = pedidosCache.filter(p => p.repartidor_id === r.id && p.estado !== 'entregado').length;
    const u = ubicacionesCache[r.id];
    const enLinea = u && (Date.now() - new Date(u.actualizado_en)) < 3 * 60000;

    return `
      <div class="rep-item" style="cursor:default;">
        <div class="rep-avatar" style="background:${coloresBg[i%4]};color:${coloresText[i%4]}">
          ${r.nombre_completo.charAt(0).toUpperCase()}
        </div>
        <div class="rep-info">
          <div class="rep-name">${escapeHtml(r.nombre_completo)}</div>
          <div class="rep-detail">📞 ${r.telefono || '—'} · ${r.zona || 'Sin zona'}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
          <span class="badge ${enLinea ? 'badge-green' : 'badge-gray'}">${enLinea ? '🟢 En línea' : '⚪ Sin GPS'}</span>
          ${pedRep > 0 ? `<span class="badge badge-amber">${pedRep} en ruta</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ── RENDIMIENTO ───────────────────────────────────────────
function renderRendimiento() {
  const el = document.getElementById('tabla-rendimiento');
  const porRep = {};
  for (const r of repsCache) porRep[r.id] = { nombre: r.nombre_completo, entregados: 0, en_ruta: 0 };

  for (const p of pedidosCache) {
    if (p.repartidor_id && porRep[p.repartidor_id]) {
      if (p.estado === 'entregado') porRep[p.repartidor_id].entregados++;
      else if (p.estado === 'en_ruta') porRep[p.repartidor_id].en_ruta++;
    }
  }

  const filas = Object.values(porRep).filter(r => r.entregados + r.en_ruta > 0);
  if (!filas.length) { el.innerHTML = '<p style="color:var(--gray);font-size:13px;">Sin datos aún hoy.</p>'; return; }

  el.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Repartidor</th><th>Entregados</th><th>En ruta</th><th>Eficiencia</th></tr></thead>
      <tbody>
        ${filas.map(r => {
          const total = r.entregados + r.en_ruta;
          const pct   = total > 0 ? Math.round((r.entregados / total) * 100) : 0;
          return `<tr>
            <td><strong>${escapeHtml(r.nombre)}</strong></td>
            <td><span class="badge badge-green">${r.entregados}</span></td>
            <td><span class="badge badge-amber">${r.en_ruta}</span></td>
            <td>
              <div style="display:flex;align-items:center;gap:6px;">
                <div style="flex:1;height:6px;background:#eee;border-radius:3px;">
                  <div style="width:${pct}%;height:100%;background:var(--primary);border-radius:3px;"></div>
                </div>
                <span style="font-size:12px;font-weight:700;">${pct}%</span>
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

// ── CREAR PEDIDO ──────────────────────────────────────────
async function crearPedido() {
  const nombre = getVal('f-nombre').trim();
  const tel    = getVal('f-tel').trim();
  const dir    = getVal('f-dir').trim();
  if (!nombre || !dir) { alert('El nombre y dirección son obligatorios.'); return; }

  const repId  = getVal('f-rep') || null;
  const btn = document.getElementById('btn-crear-pedido');
  btn.disabled = true; btn.textContent = 'Creando...';

  const { data, error } = await supabaseClient.from('pedidos').insert({
    organizacion_id: org.id,
    cliente_nombre:  nombre,
    cliente_telefono: tel,
    direccion:       dir,
    producto:        getVal('f-prod'),
    total:           getVal('f-total') || null,
    notas:           getVal('f-notas').trim(),
    urgente:         document.getElementById('f-urgente').checked,
    repartidor_id:   repId,
    estado:          repId ? 'en_ruta' : 'pendiente',
  }).select().single();

  btn.disabled = false; btn.textContent = 'Crear pedido y generar link de tracking';

  if (error) { alert('Error al crear pedido: ' + error.message); return; }

  await cargarPedidos();
  renderMetricas(); renderPedidos(); renderRendimiento();
  closeModal('nuevo-pedido');
  limpiarFormNuevo();

  pedidoTrackingActual = data;
  mostrarTrackingModal(data);
}

function mostrarTrackingModal(pedido) {
  const url   = `${APP_URL}/tracking.html?t=${pedido.tracking_token}`;
  const msg   = `Hola ${pedido.cliente_nombre} 👋\nTu pedido *#${String(pedido.numero).padStart(3,'0')}* de ${org.nombre} está confirmado 🫓\n\nSigue tu pedido aquí:\n${url}\n\n¡Gracias por tu preferencia! 🙏`;
  const telCliente = pedido.cliente_telefono ? '52' + pedido.cliente_telefono.replace(/\D/g,'') : (org.telefono_wa || '');
  const waURL = `https://wa.me/${telCliente}?text=${encodeURIComponent(msg)}`;

  document.getElementById('wa-preview-body').innerHTML = `
    <div class="wa-bubble">
      <div class="wa-bubble-hdr">📲 Mensaje para el cliente</div>
      ${msg.replace(/\n/g,'<br>').replace(/\*(.*?)\*/g,'<strong>$1</strong>')}
    </div>
    <div style="background:var(--primary-light);border-radius:6px;padding:8px 12px;font-size:12px;color:var(--primary-dark);margin-bottom:12px;word-break:break-all;">
      🔗 ${url}
    </div>`;
  document.getElementById('wa-btn-directo').href = waURL;
  openModal('tracking');
}

function copiarMensajeWA() {
  if (!pedidoTrackingActual) return;
  const url = `${APP_URL}/tracking.html?t=${pedidoTrackingActual.tracking_token}`;
  const msg = `Hola ${pedidoTrackingActual.cliente_nombre} 👋\nTu pedido #${String(pedidoTrackingActual.numero).padStart(3,'0')} de ${org.nombre} está confirmado 🫓\n\nSigue tu pedido aquí: ${url}\n\n¡Gracias por tu preferencia! 🙏`;
  navigator.clipboard.writeText(msg).then(() => toast('Mensaje copiado')).catch(() => alert(msg));
}

// ── ASIGNAR REPARTIDOR (con sugerencia de más cercano) ───
function abrirAsignar(pedidoId) {
  pedidoAsignarId = pedidoId;
  const pedido = pedidosCache.find(p => p.id === pedidoId);
  document.getElementById('modal-asignar-num').textContent = `#${String(pedido.numero).padStart(3,'0')}`;

  const disp = repsCache.filter(r => r.activo);
  const colores = ['var(--primary-light)', 'var(--blue-light)', 'var(--amber-light)'];
  const textCol = ['var(--primary-dark)',  'var(--blue)',       'var(--amber-dark)'];

  // Calcular distancias si hay coordenadas
  let conDistancia = disp.map(r => {
    const u = ubicacionesCache[r.id];
    let dist = null;
    if (u && pedido.direccion_lat && pedido.direccion_lng) {
      dist = distanciaKm(u.lat, u.lng, pedido.direccion_lat, pedido.direccion_lng);
    }
    const activos = pedidosCache.filter(p => p.repartidor_id === r.id && p.estado !== 'entregado').length;
    return { ...r, dist, activos };
  });

  // Sugerencia: más cercano con menos carga
  conDistancia.sort((a, b) => {
    if (a.dist != null && b.dist != null) return a.dist - b.dist;
    if (a.dist != null) return -1;
    if (b.dist != null) return 1;
    return a.activos - b.activos;
  });

  const sugBox = document.getElementById('sugerencia-cercano');
  if (conDistancia[0]) {
    sugBox.style.display = 'flex';
    if (conDistancia[0].dist != null) {
      sugBox.textContent = `🎯 Sugerido: ${conDistancia[0].nombre_completo} — el más cercano (${conDistancia[0].dist.toFixed(1)} km)`;
    } else {
      sugBox.textContent = `🎯 Sugerido: ${conDistancia[0].nombre_completo} — el de menos carga actual (sin GPS para calcular distancia)`;
    }
  } else {
    sugBox.style.display = 'none';
  }

  document.getElementById('modal-rep-list').innerHTML = conDistancia.map((r, i) => `
    <div class="rep-item" onclick="selectRepAsignar(this, '${r.id}')" id="rep-sel-${r.id}">
      <div class="rep-avatar" style="background:${colores[i%3]};color:${textCol[i%3]}">${r.nombre_completo.charAt(0)}</div>
      <div class="rep-info">
        <div class="rep-name">${escapeHtml(r.nombre_completo)} ${i===0 ? '⭐' : ''}</div>
        <div class="rep-detail">${r.zona || 'Sin zona'} · ${r.activos} pendiente${r.activos !== 1 ? 's' : ''}${r.dist != null ? ` · ${r.dist.toFixed(1)} km` : ''}</div>
      </div>
      <span class="badge ${r.activos < 3 ? 'badge-green' : 'badge-amber'}">${r.activos < 3 ? 'Disponible' : 'Cargado'}</span>
    </div>`).join('');

  openModal('asignar');
}

function selectRepAsignar(el, repId) {
  document.querySelectorAll('#modal-rep-list .rep-item').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  el.dataset.repId = repId;
}

async function confirmarAsignacion() {
  const sel = document.querySelector('#modal-rep-list .rep-item.selected');
  if (!sel) { alert('Selecciona un repartidor.'); return; }
  const repId = sel.dataset.repId;

  const { error } = await supabaseClient.from('pedidos')
    .update({ repartidor_id: repId, estado: 'en_ruta' })
    .eq('id', pedidoAsignarId);

  if (error) { alert('Error: ' + error.message); return; }

  await cargarPedidos();
  renderMetricas(); renderPedidos(); renderReps(); renderRendimiento();
  closeModal('asignar');
}

// ── DETALLE PEDIDO ────────────────────────────────────────
function verDetalle(pedidoId) {
  const p = pedidosCache.find(x => x.id === pedidoId);
  if (!p) return;
  const rep = repNombrePorId(p.repartidor_id);
  const url = `${APP_URL}/tracking.html?t=${p.tracking_token}`;
  const estadoLabel = { pendiente: 'Pendiente', en_ruta: 'En ruta', entregado: '✅ Entregado' };
  const badgeEstado = { pendiente: 'badge-red', en_ruta: 'badge-amber', entregado: 'badge-green' };

  document.getElementById('modal-detalle-body').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
      <div>
        <div style="font-size:22px;font-weight:800;color:var(--primary-dark);">#${String(p.numero).padStart(3,'0')}</div>
        <div style="font-size:13px;color:var(--gray);">${new Date(p.creado_en).toLocaleString('es-MX')}</div>
      </div>
      <span class="badge ${badgeEstado[p.estado]}">${estadoLabel[p.estado]}</span>
    </div>
    <div style="font-size:13px;display:flex;flex-direction:column;gap:6px;margin-bottom:14px;">
      <div><strong>Cliente:</strong> ${escapeHtml(p.cliente_nombre)}</div>
      <div><strong>Teléfono:</strong> ${p.cliente_telefono || '—'}</div>
      <div><strong>Dirección:</strong> ${escapeHtml(p.direccion)}</div>
      <div><strong>Producto:</strong> ${escapeHtml(p.producto || '')}</div>
      ${p.total ? `<div><strong>Total:</strong> $${p.total}</div>` : ''}
      ${p.notas ? `<div><strong>Notas:</strong> ${escapeHtml(p.notas)}</div>` : ''}
      <div><strong>Repartidor:</strong> ${rep || 'Sin asignar'}</div>
    </div>
    ${p.foto_entrega_url ? `
      <div style="margin-bottom:12px;">
        <div class="card-title">📸 Foto de entrega</div>
        <img src="${p.foto_entrega_url}" style="max-width:100%;border-radius:8px;">
        ${p.nota_entrega ? `<p style="font-size:12px;color:var(--gray);margin-top:6px;">📝 ${escapeHtml(p.nota_entrega)}</p>` : ''}
      </div>` : ''}
    <div class="sep"></div>
    <div class="card-title">🔗 Link de tracking</div>
    <div style="background:var(--primary-light);border-radius:6px;padding:8px 12px;font-size:12px;color:var(--primary-dark);word-break:break-all;margin-bottom:10px;">${url}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <a href="${url}" target="_blank"><button class="btn btn-outline btn-sm">Ver tracking</button></a>
      <button class="btn btn-wa btn-sm" onclick="enviarWA(${p.id});closeModal('detalle')">Enviar WA</button>
      ${p.estado !== 'entregado' ? `<button class="btn btn-accent btn-sm" onclick="marcarEntregado(${p.id})">Marcar entregado</button>` : ''}
      ${p.estado !== 'entregado' ? `<button class="btn btn-danger btn-sm" onclick="cancelarPedido(${p.id})">Cancelar</button>` : ''}
    </div>`;

  openModal('detalle');
}

async function marcarEntregado(id) {
  if (!confirm('¿Marcar este pedido como entregado?')) return;
  const { error } = await supabaseClient.from('pedidos').update({ estado: 'entregado' }).eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  await cargarPedidos();
  renderMetricas(); renderPedidos(); renderRendimiento();
  closeModal('detalle');
}

async function cancelarPedido(id) {
  if (!confirm('¿Cancelar este pedido? Esta acción no se puede deshacer.')) return;
  const { error } = await supabaseClient.from('pedidos').update({ estado: 'cancelado' }).eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  await cargarPedidos();
  renderMetricas(); renderPedidos(); renderRendimiento();
  closeModal('detalle');
}

function enviarWA(pedidoId) {
  const p = pedidosCache.find(x => x.id === pedidoId);
  if (!p) return;
  pedidoTrackingActual = p;
  mostrarTrackingModal(p);
}

// ── CREAR REPARTIDOR ──────────────────────────────────────
async function crearRepartidor() {
  const nombre = getVal('r-nombre').trim();
  const email  = getVal('r-email').trim();
  const password = getVal('r-password');

  if (!nombre || !email || !password) { alert('Completa los campos obligatorios.'); return; }
  if (password.length < 6) { alert('La contraseña debe tener al menos 6 caracteres.'); return; }
  if (repsCache.length >= org.max_repartidores) { alert('Has alcanzado el límite de repartidores de tu plan.'); return; }

  const btn = document.getElementById('btn-crear-rep');
  btn.disabled = true; btn.textContent = 'Creando...';

  const { error } = await Auth.crearRepartidor({
    email, password,
    nombreCompleto: nombre,
    telefono: getVal('r-tel').trim(),
    zona: getVal('r-zona').trim(),
  });

  btn.disabled = false; btn.textContent = 'Agregar repartidor';

  if (error) { alert('Error: ' + error); return; }

  await cargarRepartidores();
  renderReps(); poblarSelectRep();
  closeModal('nuevo-rep');
  ['r-nombre','r-tel','r-zona','r-email','r-password'].forEach(id => setVal(id, ''));
  toast('Repartidor agregado. Comparte sus credenciales para que entre en repartidor.html');
}

// ── CONFIG ────────────────────────────────────────────────
async function guardarConfig() {
  const { error } = await supabaseClient.from('organizaciones').update({
    nombre: getVal('cfg-nombre'),
    telefono_wa: getVal('cfg-tel'),
    direccion: getVal('cfg-dir'),
  }).eq('id', org.id);

  if (error) { alert('Error: ' + error.message); return; }

  org.nombre = getVal('cfg-nombre');
  org.telefono_wa = getVal('cfg-tel');
  org.direccion = getVal('cfg-dir');
  document.getElementById('org-nombre').textContent = org.nombre;
  closeModal('config');
  toast('Configuración guardada');
}

// ── PRODUCTOS ────────────────────────────────────────────

function renderProductos() {
  const el = document.getElementById('lista-productos');
  if (!productosCache.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">🛒</div>Sin productos. Agrega el primero para activar tu catalogo publico.</div>';
    return;
  }
  el.innerHTML = productosCache.map(p => {
    const badge = p.disponible
      ? '<span class="badge badge-green">Disponible</span>'
      : '<span class="badge badge-gray">No disponible</span>';
    return `
      <div class="rep-item" style="cursor:default;">
        <div style="flex:1;">
          <div class="rep-name">${escapeHtml(p.nombre)}</div>
          <div class="rep-detail">$${Number(p.precio).toFixed(2)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          ${badge}
          <button class="btn btn-outline btn-sm" onclick="editarProducto(${p.id})">Editar</button>
          <button class="btn btn-outline btn-sm" onclick="toggleProducto(${p.id})">${p.disponible ? '🚫' : '✅'}</button>
          <button class="btn btn-outline btn-sm" style="color:var(--red);" onclick="eliminarProducto(${p.id})">✕</button>
        </div>
      </div>`;
  }).join('');
}

async function guardarProducto() {
  const nombre = getVal('p-nombre').trim();
  const precio = parseFloat(getVal('p-precio'));
  const orden = parseInt(getVal('p-orden')) || 0;
  const editId = getVal('p-edit-id');

  if (!nombre || isNaN(precio)) { alert('Nombre y precio son obligatorios.'); return; }

  const btn = document.getElementById('btn-guardar-prod');
  btn.disabled = true;

  if (editId) {
    const { error } = await supabaseClient.from('productos').update({ nombre, precio, orden }).eq('id', editId);
    if (error) { alert('Error: ' + error.message); btn.disabled = false; return; }
  } else {
    const { error } = await supabaseClient.from('productos').insert({ organizacion_id: org.id, nombre, precio, orden });
    if (error) { alert('Error: ' + error.message); btn.disabled = false; return; }
  }

  btn.disabled = false;
  await cargarProductos();
  renderProductos();
  poblarSelectProd();
  closeModal('nuevo-prod');
  setVal('p-nombre', ''); setVal('p-precio', ''); setVal('p-orden', ''); setVal('p-edit-id', '');
  document.getElementById('modal-prod-title').textContent = 'Agregar producto';
  toast(editId ? 'Producto actualizado' : 'Producto agregado');
}

function editarProducto(id) {
  const p = productosCache.find(x => x.id === id);
  if (!p) return;
  setVal('p-nombre', p.nombre);
  setVal('p-precio', p.precio);
  setVal('p-orden', p.orden);
  setVal('p-edit-id', id);
  document.getElementById('modal-prod-title').textContent = 'Editar producto';
  openModal('nuevo-prod');
}

async function toggleProducto(id) {
  const p = productosCache.find(x => x.id === id);
  if (!p) return;
  const { error } = await supabaseClient.from('productos').update({ disponible: !p.disponible }).eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  await cargarProductos();
  renderProductos();
  poblarSelectProd();
  toast(p.disponible ? 'Producto desactivado' : 'Producto activado');
}

async function eliminarProducto(id) {
  if (!confirm('¿Eliminar este producto del catalogo?')) return;
  const { error } = await supabaseClient.from('productos').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  await cargarProductos();
  renderProductos();
  poblarSelectProd();
  toast('Producto eliminado');
}

function poblarSelectProd() {
  const sel = document.getElementById('f-prod');
  const disp = productosCache.filter(p => p.disponible);
  sel.innerHTML = '<option value="">Seleccionar producto</option>' +
    disp.map(p => `<option value="${escapeHtml(p.nombre)}" data-precio="${p.precio}">${escapeHtml(p.nombre)} — $${Number(p.precio).toFixed(2)}</option>`).join('') +
    '<option value="Otro">Otro (escribir en notas)</option>';
}

function autoFillTotal() {
  const sel = document.getElementById('f-prod');
  const opt = sel.options[sel.selectedIndex];
  if (opt && opt.dataset.precio) {
    setVal('f-total', opt.dataset.precio);
  }
}

function compartirCatalogo() {
  const url = `${APP_URL}/pedir.html?n=${org.slug}`;
  document.getElementById('catalogo-url-box').textContent = url;
  const waMsg = `Haz tu pedido de ${org.nombre} en linea! 🫓\n${url}`;
  document.getElementById('catalogo-wa-link').href = `https://wa.me/?text=${encodeURIComponent(waMsg)}`;
  openModal('catalogo');
}

function copiarURLCatalogo() {
  const url = `${APP_URL}/pedir.html?n=${org.slug}`;
  navigator.clipboard.writeText(url).then(() => toast('Enlace copiado')).catch(() => alert(url));
}

// ── NOTIFICACIONES ───────────────────────────────────────

function playNotifSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 800;
    gain.gain.value = 0.3;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (_) {}
}

function showNotification(title, body, tag) {
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(title, { body, icon: '/icons/icon-192.png', tag: tag || 'tortirappi', renotify: true });
    n.onclick = () => { window.focus(); n.close(); };
  }
}

// ── HELPERS ───────────────────────────────────────────────
function repNombrePorId(id) {
  if (!id) return null;
  const r = repsCache.find(x => x.id === id);
  return r ? r.nombre_completo.split(' ')[0] : null;
}

function poblarSelectRep() {
  const sel  = document.getElementById('f-rep');
  const disp = repsCache.filter(r => r.activo);
  sel.innerHTML = '<option value="">⚪ Sin asignar</option>' +
    disp.map(r => `<option value="${r.id}">${escapeHtml(r.nombre_completo)}</option>`).join('');
}

function limpiarFormNuevo() {
  ['f-nombre','f-tel','f-dir','f-total','f-notas'].forEach(id => setVal(id, ''));
  setVal('f-prod', ''); setVal('f-rep', '');
  document.getElementById('f-urgente').checked = false;
}

function distanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLon = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function openModal(id)  { document.getElementById('modal-'+id).classList.add('open'); }
function closeModal(id) { document.getElementById('modal-'+id).classList.remove('open'); }
function getVal(id)     { return (document.getElementById(id)||{}).value || ''; }
function setVal(id, v)  { const el = document.getElementById(id); if (el) el.value = v; }

document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
});

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

function setupOnlineOffline() {
  const bar = document.getElementById('offline-bar');
  const badge = document.getElementById('online-badge');
  const update = () => {
    if (navigator.onLine) {
      bar.style.display = 'none';
      badge.innerHTML = '<span class="pulse-dot"></span> En línea';
    } else {
      bar.style.display = 'flex';
      badge.innerHTML = '⚠️ Sin conexión';
    }
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function registrarSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}
