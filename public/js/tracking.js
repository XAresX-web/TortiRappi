/* ============================================================
   tracking.js — Tracking público (sin login) — Supabase + Maps
   ============================================================ */

const PASOS_CONFIG = [
  { key: 'recibido',  label: 'Pedido recibido',          icon: '📋' },
  { key: 'preparando', label: 'En preparación',          icon: '🫓' },
  { key: 'asignado',  label: 'Asignado a repartidor',    icon: '🛵' },
  { key: 'en_camino', label: 'En camino a tu domicilio', icon: '📍' },
  { key: 'entregado', label: 'Entregado',                icon: '✅' },
];

let gmap = null;
let marcadorRepartidor = null;
let token = null;

document.addEventListener('DOMContentLoaded', async () => {
  token = new URLSearchParams(window.location.search).get('t');
  if (!token) { mostrarNoEncontrado(); return; }

  await cargarYRender();
  setInterval(cargarYRender, TRACKING_REFRESH_MS);
});

async function cargarYRender() {
  const { data, error } = await supabaseClient
    .from('tracking_publico')
    .select('*')
    .eq('tracking_token', token)
    .single();

  if (error || !data) { mostrarNoEncontrado(); return; }

  document.getElementById('loading').style.display = 'none';
  document.getElementById('main-content').style.display = 'block';
  document.getElementById('footer-wa').style.display = 'block';

  renderTracking(data);
}

function renderTracking(p) {
  document.getElementById('t-num').textContent = `#${String(p.numero).padStart(3,'0')}`;
  document.getElementById('t-cliente').textContent = p.cliente_nombre || '';

  const badgeMap = { pendiente: 'badge-red', en_ruta: 'badge-amber', entregado: 'badge-green' };
  const labelMap = { pendiente: 'Pendiente', en_ruta: '🛵 En camino', entregado: '✅ Entregado' };
  document.getElementById('t-estado-badge').innerHTML =
    `<span class="badge ${badgeMap[p.estado]} big-badge">${labelMap[p.estado] || p.estado}</span>`;

  const etaEl = document.getElementById('t-eta');
  const etaMap = { pendiente: '~25–35 min', en_ruta: '~10–20 min' };
  if (etaMap[p.estado]) {
    etaEl.textContent = `⏱️ Tiempo estimado: ${etaMap[p.estado]}`;
    etaEl.style.display = 'inline-block';
  } else {
    etaEl.style.display = 'none';
  }

  // Mapa en vivo (solo si está en ruta y hay coordenadas del repartidor)
  const mapaCard = document.getElementById('mapa-card');
  if (p.estado === 'en_ruta' && p.repartidor_lat && p.repartidor_lng) {
    mapaCard.style.display = 'block';
    whenGoogleMapsReady(() => actualizarMapaTracking(p));
  } else if (p.estado === 'entregado') {
    mapaCard.style.display = 'none';
  } else {
    mapaCard.style.display = 'none';
  }

  renderPasos(p.estado);

  document.getElementById('t-detalle').innerHTML = `
    <div style="font-size:13px;display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--gray);">${escapeHtml(p.producto || 'Pedido')}</span><span style="font-weight:700;">${p.total ? '$' + p.total : ''}</span></div>
      <div style="display:flex;justify-content:space-between;"><span style="color:var(--gray);">Dirección:</span><span style="text-align:right;max-width:200px;">${escapeHtml(p.direccion || '—')}</span></div>
      ${p.notas ? `<div style="background:var(--amber-light);border-radius:6px;padding:6px 10px;font-size:12px;color:var(--amber-dark);">📝 ${escapeHtml(p.notas)}</div>` : ''}
    </div>
    ${p.estado === 'entregado' && p.foto_entrega_url ? `
      <div style="margin-top:10px;">
        <div style="font-weight:700;font-size:12px;color:var(--gray-dark);margin-bottom:6px;">📸 Foto de entrega</div>
        <img src="${p.foto_entrega_url}" style="max-width:100%;border-radius:8px;">
        ${p.nota_entrega ? `<p style="font-size:12px;color:var(--gray);margin-top:5px;">📝 ${escapeHtml(p.nota_entrega)}</p>` : ''}
      </div>` : ''}
  `;

  document.getElementById('t-negocio-nombre').textContent = p.negocio_nombre || '';
  document.getElementById('t-negocio-dir').textContent    = p.negocio_direccion || '';
  document.getElementById('t-updated').textContent = tiempoRelativo(p.actualizado_en);

  const waMsg = `Hola, quiero consultar sobre mi pedido #${String(p.numero).padStart(3,'0')}`;
  const tel   = p.negocio_telefono || '';
  document.getElementById('wa-link').href = `https://wa.me/${tel}?text=${encodeURIComponent(waMsg)}`;
  if (document.getElementById('wa-negocio')) {
    document.getElementById('wa-negocio').href = `https://wa.me/${tel}?text=${encodeURIComponent('Hola, necesito ayuda con mi pedido.')}`;
  }
}

function actualizarMapaTracking(p) {
  const pos = { lat: p.repartidor_lat, lng: p.repartidor_lng };

  if (!gmap) {
    gmap = new google.maps.Map(document.getElementById('gmap-tracking'), {
      zoom: 15, center: pos, disableDefaultUI: true, zoomControl: true,
      styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }],
    });
    marcadorRepartidor = new google.maps.Marker({
      position: pos, map: gmap,
      icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: '#D85A30', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 12 },
      title: 'Tu repartidor',
    });
  } else {
    marcadorRepartidor.setPosition(pos);
    gmap.panTo(pos);
  }
}

function renderPasos(estadoActual) {
  const pasosDone = {
    pendiente: ['recibido','preparando'],
    en_ruta:   ['recibido','preparando','asignado','en_camino'],
    entregado: ['recibido','preparando','asignado','en_camino','entregado'],
  }[estadoActual] || [];

  document.getElementById('t-pasos').innerHTML = PASOS_CONFIG.map((paso, i) => {
    const isDone   = pasosDone.includes(paso.key);
    const isActive = !isDone && PASOS_CONFIG[i-1] && pasosDone.includes(PASOS_CONFIG[i-1].key);
    const cls      = isDone ? 'done' : isActive ? 'active' : 'pending';
    const esUltimo = i === PASOS_CONFIG.length - 1;

    return `
      <div class="t-step ${cls}">
        <div class="t-step-col">
          <div class="t-step-circle">${isDone ? '✓' : isActive ? paso.icon : ''}</div>
          ${!esUltimo ? '<div class="t-step-line"></div>' : ''}
        </div>
        <div class="t-step-content">
          <div class="t-step-title">${paso.label}</div>
          <div class="t-step-time">${isDone ? 'Completado' : isActive ? 'En progreso' : 'Pendiente'}</div>
        </div>
      </div>`;
  }).join('');
}

function mostrarNoEncontrado() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('not-found').style.display = 'block';
}

function tiempoRelativo(iso) {
  if (!iso) return 'un momento';
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (mins < 1)  return 'un momento';
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins/60)}h`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
