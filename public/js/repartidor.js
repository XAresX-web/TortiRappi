/* ============================================================
   repartidor.js — App del repartidor (GPS real + Supabase)
   ============================================================ */

let perfil = null;
let org    = null;
let pedidosRep = [];
let pedidoActivo = null;
let fotoBase64   = null;
let gpsWatchId   = null;
let gpsActivo    = false;

document.addEventListener('DOMContentLoaded', async () => {
  perfil = await Auth.requireAuth(['repartidor']);
  if (!perfil) return;
  org = perfil.organizaciones;

  document.getElementById('rep-avatar').textContent = perfil.nombre_completo.charAt(0).toUpperCase();
  document.getElementById('rep-nombre').textContent  = perfil.nombre_completo;
  document.getElementById('rep-zona').textContent    = perfil.zona ? `Zona: ${perfil.zona}` : '';

  setupOnlineOffline();
  registrarSW();

  await cargarPedidos();
  renderRuta();
  suscribirRealtime();

  // Procesar cola offline si hay pendientes
  await actualizarBadgeSync();
  if (navigator.onLine) await procesarCola();

  // Recordar si el GPS estaba activo
  if (localStorage.getItem('gps_activo') === '1') {
    toggleGPS();
  }

  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
});

// ── CARGAR PEDIDOS ASIGNADOS A MÍ (HOY) ──────────────────
async function cargarPedidos() {
  const hoyInicio = new Date(); hoyInicio.setHours(0,0,0,0);
  const { data, error } = await supabaseClient
    .from('pedidos')
    .select('*')
    .eq('repartidor_id', perfil.id)
    .gte('creado_en', hoyInicio.toISOString())
    .order('creado_en', { ascending: true });

  if (error) { console.error('[Pedidos]', error); toast('Error cargando ruta'); return; }

  pedidosRep = (data || []).filter(p => p.estado !== 'cancelado');
  pedidosRep.sort((a, b) => {
    const orden = { en_ruta: 0, pendiente: 1, entregado: 2 };
    return (orden[a.estado] ?? 9) - (orden[b.estado] ?? 9);
  });

  const entregados = pedidosRep.filter(p => p.estado === 'entregado').length;
  document.getElementById('rep-score').textContent = `${entregados}/${pedidosRep.length}`;
}

// ── REALTIME: si el admin asigna nuevos pedidos ──────────
function suscribirRealtime() {
  supabaseClient
    .channel('repartidor-pedidos')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'pedidos', filter: `repartidor_id=eq.${perfil.id}` },
      async () => {
        const prevIds = new Set(pedidosRep.map(p => p.id));
        await cargarPedidos();
        renderRuta();

        const nuevos = pedidosRep.filter(p => !prevIds.has(p.id) && p.estado !== 'entregado');
        if (nuevos.length > 0) {
          const p = nuevos[0];
          playNotifSound();
          showNotificationRep(
            `Te asignaron pedido #${String(p.numero).padStart(3,'0')}`,
            `${p.cliente_nombre} — ${p.direccion || ''}`,
            `pedido-rep-${p.id}`
          );
          toast(`Nuevo pedido asignado: #${String(p.numero).padStart(3,'0')}`);
        } else {
          toast('Tu ruta se actualizo');
        }
      })
    .subscribe();
}

// ── RENDER RUTA ───────────────────────────────────────────
function renderRuta() {
  const el = document.getElementById('lista-ruta');
  const pendientes = pedidosRep.filter(p => p.estado !== 'entregado').length;
  document.getElementById('ruta-pendiente-cnt').textContent = `${pendientes} pendiente${pendientes !== 1 ? 's' : ''}`;

  if (!pedidosRep.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">🎉</div>No tienes pedidos asignados hoy.</div>';
    return;
  }

  const primerActivo = pedidosRep.findIndex(x => x.estado !== 'entregado');

  el.innerHTML = pedidosRep.map((p, i) => {
    const done   = p.estado === 'entregado';
    const activo = !done && i === primerActivo;
    const numCls = done ? 'done' : activo ? 'active' : '';
    const dirEnc = encodeURIComponent(p.direccion || '');

    return `
      <div class="route-item" style="${activo ? 'border-color:var(--primary);background:var(--primary-light);' : ''}">
        <div class="route-num ${numCls}">${done ? '✓' : i + 1}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:14px;">${escapeHtml(p.cliente_nombre)}</div>
          <div style="font-size:12px;color:var(--gray);margin:2px 0;">${escapeHtml(p.direccion || '')}</div>
          <div style="font-size:12px;color:var(--gray);">${escapeHtml(p.producto || '')} ${p.total ? '· $'+p.total : ''}</div>
          ${p.notas ? `<div style="font-size:11px;color:var(--amber);margin-top:2px;">📝 ${escapeHtml(p.notas)}</div>` : ''}
          <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
            ${done
              ? `<span class="badge badge-green">✅ Entregado</span>`
              : activo
                ? `<button class="btn btn-primary btn-sm" onclick="iniciarEntrega(${p.id})">📸 Confirmar entrega</button>`
                : `<span class="badge badge-gray">En espera</span>`
            }
            <a href="https://maps.google.com/?q=${dirEnc}" target="_blank">
              <button class="btn btn-outline btn-sm">📍 Ver en mapa</button>
            </a>
            ${p.cliente_telefono ? `<a href="https://wa.me/52${p.cliente_telefono.replace(/\D/g,'')}?text=Hola+${encodeURIComponent(p.cliente_nombre)}%2C+soy+de+${encodeURIComponent(org.nombre)}+y+estoy+en+camino." target="_blank"><button class="btn btn-wa btn-sm">WA</button></a>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── INICIAR ENTREGA ───────────────────────────────────────
function iniciarEntrega(pedidoId) {
  pedidoActivo = pedidosRep.find(p => p.id === pedidoId);
  if (!pedidoActivo) return;

  document.getElementById('entrega-pedido-info').innerHTML =
    `Pedido <strong>#${String(pedidoActivo.numero).padStart(3,'0')}</strong> para <strong>${escapeHtml(pedidoActivo.cliente_nombre)}</strong> · ${escapeHtml(pedidoActivo.direccion)}`;

  fotoBase64 = null;
  document.getElementById('foto-preview').style.display = 'none';
  document.getElementById('foto-preview').src = '';
  document.getElementById('photo-placeholder').textContent = '📷 Toca para tomar foto de la entrega';
  document.getElementById('photo-zone').classList.remove('filled');
  document.getElementById('nota-entrega').value = '';

  document.getElementById('card-entrega').style.display = 'block';
  document.getElementById('card-confirmado').style.display = 'none';
  document.getElementById('card-entrega').scrollIntoView({ behavior: 'smooth' });
}

// ── PROCESAR FOTO (con compresión) ───────────────────────
function procesarFoto(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    // Comprimir la imagen para que no pese mucho (importante offline)
    const img = new Image();
    img.onload = () => {
      const maxDim = 1024;
      let { width, height } = img;
      if (width > height && width > maxDim) { height *= maxDim/width; width = maxDim; }
      else if (height > maxDim) { width *= maxDim/height; height = maxDim; }

      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      fotoBase64 = canvas.toDataURL('image/jpeg', 0.7);

      document.getElementById('foto-preview').src = fotoBase64;
      document.getElementById('foto-preview').style.display = 'block';
      document.getElementById('photo-placeholder').textContent = '✅ Foto lista';
      document.getElementById('photo-zone').classList.add('filled');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ── CONFIRMAR ENTREGA ─────────────────────────────────────
async function confirmarEntrega() {
  if (!pedidoActivo) return;
  if (!fotoBase64 && !confirm('¿Confirmar sin foto? Se recomienda tomar una foto como comprobante.')) return;

  const nota = document.getElementById('nota-entrega').value.trim();
  const btn  = document.getElementById('btn-confirmar');
  btn.disabled = true; btn.textContent = 'Confirmando...';

  // Geolocalización del momento de entrega
  let lat = null, lng = null;
  try {
    if (navigator.geolocation) {
      await new Promise(res => {
        navigator.geolocation.getCurrentPosition(pos => {
          lat = pos.coords.latitude; lng = pos.coords.longitude; res();
        }, res, { timeout: 4000 });
      });
    }
  } catch (_) {}

  if (navigator.onLine) {
    // ── ONLINE: subir directo ──
    let fotoUrl = null;
    if (fotoBase64) {
      try {
        const blob = await (await fetch(fotoBase64)).blob();
        const fileName = `${pedidoActivo.id}_${Date.now()}.jpg`;
        const { error: upErr } = await supabaseClient.storage
          .from('fotos-entregas')
          .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });
        if (!upErr) {
          const { data: urlData } = supabaseClient.storage.from('fotos-entregas').getPublicUrl(fileName);
          fotoUrl = urlData.publicUrl;
        }
      } catch (e) { console.error('[Foto]', e); }
    }

    const updateData = { estado: 'entregado', nota_entrega: nota };
    if (fotoUrl) updateData.foto_entrega_url = fotoUrl;
    if (lat) { updateData.entrega_lat = lat; updateData.entrega_lng = lng; }

    const { error } = await supabaseClient.from('pedidos').update(updateData).eq('id', pedidoActivo.id);

    if (error) {
      // Si falla, guardar offline como respaldo
      await OfflineQueue.agregar({ pedido_id: pedidoActivo.id, foto_base64: fotoBase64, nota, lat, lng });
      toast('Sin conexión a la base de datos — guardado localmente');
    } else {
      toast('Entrega confirmada ✅');
    }
  } else {
    // ── OFFLINE: guardar en cola local ──
    await OfflineQueue.agregar({ pedido_id: pedidoActivo.id, foto_base64: fotoBase64, nota, lat, lng });
    toast('Sin conexión — entrega guardada, se subirá automáticamente');
  }

  // Actualizar UI local inmediatamente (optimistic update)
  const idx = pedidosRep.findIndex(p => p.id === pedidoActivo.id);
  if (idx !== -1) pedidosRep[idx] = { ...pedidosRep[idx], estado: 'entregado' };

  const entregados = pedidosRep.filter(p => p.estado === 'entregado').length;
  document.getElementById('rep-score').textContent = `${entregados}/${pedidosRep.length}`;

  await actualizarBadgeSync();
  renderRuta();

  document.getElementById('confirmado-txt').textContent =
    `#${String(pedidoActivo.numero).padStart(3,'0')} — ${pedidoActivo.cliente_nombre} · ${new Date().toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' })}`;
  document.getElementById('card-confirmado').style.display = 'block';
  cerrarEntrega();
  document.getElementById('card-confirmado').scrollIntoView({ behavior: 'smooth' });

  btn.disabled = false; btn.textContent = '✅ Confirmar entrega';
  setTimeout(() => { document.getElementById('card-confirmado').style.display = 'none'; }, 5000);
}

function cerrarEntrega() {
  document.getElementById('card-entrega').style.display = 'none';
  pedidoActivo = null;
}

// ── GPS EN VIVO ───────────────────────────────────────────
function toggleGPS() {
  if (gpsActivo) {
    if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
    gpsActivo = false;
    localStorage.setItem('gps_activo', '0');
    actualizarEstadoGPS();
    return;
  }

  if (!navigator.geolocation) { alert('Tu dispositivo no soporta GPS.'); return; }

  navigator.geolocation.getCurrentPosition(
    () => {
      gpsActivo = true;
      localStorage.setItem('gps_activo', '1');
      actualizarEstadoGPS();
      iniciarSeguimientoGPS();
    },
    err => {
      alert('No se pudo activar el GPS. Verifica los permisos de ubicación en tu navegador.');
      console.error(err);
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function iniciarSeguimientoGPS() {
  // Enviar ubicación inmediatamente y luego cada GPS_INTERVAL_MS
  enviarUbicacion();

  gpsWatchId = navigator.geolocation.watchPosition(
    pos => {
      window._lastPos = pos;
    },
    err => console.error('[GPS]', err),
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );

  // Enviar a Supabase periódicamente (no en cada watchPosition para no saturar)
  if (window._gpsInterval) clearInterval(window._gpsInterval);
  window._gpsInterval = setInterval(() => {
    if (window._lastPos) enviarUbicacion(window._lastPos);
  }, GPS_INTERVAL_MS);
}

async function enviarUbicacion(pos) {
  let coords;
  if (pos) {
    coords = pos.coords;
  } else {
    coords = await new Promise((res, rej) => {
      navigator.geolocation.getCurrentPosition(p => res(p.coords), rej, { enableHighAccuracy: true, timeout: 8000 });
    }).catch(() => null);
  }
  if (!coords) return;

  const payload = {
    repartidor_id: perfil.id,
    organizacion_id: org.id,
    lat: coords.latitude,
    lng: coords.longitude,
    precision_m: coords.accuracy,
    actualizado_en: new Date().toISOString(),
  };

  if (!navigator.onLine) return; // GPS solo se sincroniza online (no crítico para offline-first)

  await supabaseClient.from('ubicaciones_repartidores').upsert(payload, { onConflict: 'repartidor_id' });

  // Guardar también en historial (no bloqueante)
  supabaseClient.from('historial_ubicaciones').insert({
    repartidor_id: perfil.id,
    organizacion_id: org.id,
    lat: coords.latitude,
    lng: coords.longitude,
  }).then(() => {});
}

function actualizarEstadoGPS() {
  const status = document.getElementById('gps-status');
  const btn    = document.getElementById('btn-gps');
  if (gpsActivo) {
    status.className = 'gps-status gps-on';
    status.innerHTML = '<span class="pulse-dot"></span> GPS activo — compartiendo ubicación en vivo';
    btn.textContent = '📡 Desactivar ubicación';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-outline');
  } else {
    status.className = 'gps-status gps-off';
    status.innerHTML = '<span class="pulse-dot red"></span> GPS desactivado — Activa para compartir tu ubicación';
    btn.textContent = '📡 Activar ubicación en vivo';
    btn.classList.add('btn-primary');
    btn.classList.remove('btn-outline');
    if (window._gpsInterval) clearInterval(window._gpsInterval);
  }
}

// ── COLA OFFLINE ──────────────────────────────────────────
async function actualizarBadgeSync() {
  const pendientes = await OfflineQueue.listar();
  const el = document.getElementById('sync-pending');
  if (pendientes.length > 0) {
    el.style.display = 'flex';
    el.textContent = `📤 ${pendientes.length} entrega(s) esperando subir (se sincronizan automáticamente al conectarte)`;
  } else {
    el.style.display = 'none';
  }
}

async function procesarCola() {
  const result = await OfflineQueue.procesar();
  if (result.procesadas > 0) {
    toast(`${result.procesadas} entrega(s) sincronizada(s)`);
    await cargarPedidos();
    renderRuta();
  }
  await actualizarBadgeSync();
}
window.actualizarBadgeSync = actualizarBadgeSync;

// ── ONLINE / OFFLINE ──────────────────────────────────────
function setupOnlineOffline() {
  const bar   = document.getElementById('offline-bar');
  const badge = document.getElementById('conn-badge');
  const update = async () => {
    if (navigator.onLine) {
      bar.style.display = 'none';
      badge.innerHTML = '<span class="pulse-dot"></span> En línea';
      badge.className = 'badge badge-teal';
      await procesarCola();
    } else {
      bar.style.display = 'flex';
      badge.innerHTML = '⚠️ Sin conexión';
      badge.className = 'badge badge-amber';
    }
  };
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
}

function registrarSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
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

function showNotificationRep(title, body, tag) {
  if ('vibrate' in navigator) {
    navigator.vibrate([200, 100, 200]);
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(title, { body, icon: '/icons/icon-192.png', tag: tag || 'tortirappi-rep', renotify: true });
    n.onclick = () => { window.focus(); n.close(); };
  }
}

// ── HELPERS ───────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}
window.toast = toast;
