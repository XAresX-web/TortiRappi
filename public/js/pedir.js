/* ============================================================
   pedir.js — Catálogo público de pedidos (sin login)
   ============================================================ */

let catalogoData = null;
let carrito = {};
let slug = null;

document.addEventListener('DOMContentLoaded', async () => {
  slug = new URLSearchParams(window.location.search).get('n');
  if (!slug) { mostrarNoEncontrado(); return; }
  await cargarCatalogo();
});

async function cargarCatalogo() {
  const { data, error } = await supabaseClient.rpc('obtener_catalogo', { p_slug: slug });

  if (error || !data) { mostrarNoEncontrado(); return; }

  catalogoData = data;
  document.title = `${data.negocio_nombre} — TortiRappi`;
  document.getElementById('negocio-nombre').textContent = data.negocio_nombre;
  document.getElementById('negocio-dir').textContent = data.negocio_direccion || '';

  document.getElementById('loading').style.display = 'none';
  document.getElementById('main-content').style.display = 'block';

  renderProductos();
}

function renderProductos() {
  const el = document.getElementById('productos-lista');

  if (!catalogoData.productos || !catalogoData.productos.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">🫓</div>Este negocio aun no tiene productos disponibles.</div>';
    return;
  }

  el.innerHTML = catalogoData.productos.map(p => {
    const qty = carrito[p.id] || 0;
    return `
      <div class="prod-card ${qty > 0 ? 'selected' : ''}" id="prod-${p.id}">
        <div class="prod-info">
          <div class="prod-nombre">${escapeHtml(p.nombre)}</div>
          <div class="prod-precio">$${Number(p.precio).toFixed(2)}</div>
        </div>
        <div class="qty-ctrl">
          <button class="qty-btn" onclick="cambiarCantidad(${p.id}, -1)" ${qty === 0 ? 'disabled style="opacity:0.3"' : ''}>−</button>
          <span class="qty-val ${qty > 0 ? 'has' : ''}">${qty}</span>
          <button class="qty-btn" onclick="cambiarCantidad(${p.id}, 1)">+</button>
        </div>
      </div>`;
  }).join('');
}

function cambiarCantidad(prodId, delta) {
  const current = carrito[prodId] || 0;
  const next = Math.max(0, current + delta);
  if (next === 0) delete carrito[prodId];
  else carrito[prodId] = next;

  renderProductos();
  renderResumen();
}

function renderResumen() {
  const items = Object.entries(carrito);
  const cardResumen = document.getElementById('card-resumen');
  const btn = document.getElementById('btn-pedir');

  if (!items.length) {
    cardResumen.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Selecciona al menos un producto';
    return;
  }

  cardResumen.style.display = 'block';
  let total = 0;

  const html = items.map(([id, qty]) => {
    const prod = catalogoData.productos.find(p => p.id === parseInt(id));
    if (!prod) return '';
    const lineTotal = prod.precio * qty;
    total += lineTotal;
    return `<div class="resumen-item">
      <span>${escapeHtml(prod.nombre)} x${qty}</span>
      <span>$${lineTotal.toFixed(2)}</span>
    </div>`;
  }).join('');

  document.getElementById('resumen-productos').innerHTML = html;
  document.getElementById('resumen-total').textContent = `$${total.toFixed(2)}`;

  btn.disabled = false;
  btn.textContent = `Hacer pedido — $${total.toFixed(2)}`;
}

async function hacerPedido() {
  const nombre = document.getElementById('f-nombre').value.trim();
  const tel = document.getElementById('f-tel').value.trim();
  const dir = document.getElementById('f-dir').value.trim();
  const notas = document.getElementById('f-notas').value.trim();

  if (!nombre || !dir) {
    alert('Tu nombre y direccion son obligatorios.');
    return;
  }

  const items = Object.entries(carrito);
  if (!items.length) {
    alert('Selecciona al menos un producto.');
    return;
  }

  const productosJson = items.map(([id, qty]) => {
    const prod = catalogoData.productos.find(p => p.id === parseInt(id));
    return { id: prod.id, nombre: prod.nombre, precio: Number(prod.precio), cantidad: qty };
  });

  const btn = document.getElementById('btn-pedir');
  btn.disabled = true;
  btn.textContent = 'Enviando pedido...';

  const { data, error } = await supabaseClient.rpc('crear_pedido_publico', {
    p_slug: slug,
    p_cliente_nombre: nombre,
    p_cliente_telefono: tel || null,
    p_direccion: dir,
    p_productos_json: productosJson,
    p_notas: notas || null,
  });

  if (error) {
    alert('Error al crear el pedido: ' + (error.message || 'Intenta de nuevo.'));
    btn.disabled = false;
    renderResumen();
    return;
  }

  mostrarExito(data, nombre);
}

function mostrarExito(pedido, clienteNombre) {
  document.getElementById('main-content').style.display = 'none';
  document.getElementById('success-view').style.display = 'block';

  document.getElementById('success-num').textContent = `#${String(pedido.numero).padStart(3, '0')}`;
  document.getElementById('success-total').textContent = `$${Number(pedido.total).toFixed(2)}`;

  const trackingUrl = `${APP_URL}/tracking.html?t=${pedido.tracking_token}`;
  document.getElementById('success-tracking-url').textContent = trackingUrl;
  document.getElementById('success-tracking-link').href = trackingUrl;

  const waMsg = `Hola, acabo de hacer el pedido #${String(pedido.numero).padStart(3, '0')} por $${Number(pedido.total).toFixed(2)} a traves de su catalogo.\nMi nombre: ${clienteNombre}`;
  const waTel = catalogoData.negocio_telefono || '';
  document.getElementById('success-wa-btn').href = `https://wa.me/${waTel}?text=${encodeURIComponent(waMsg)}`;

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function mostrarNoEncontrado() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('not-found').style.display = 'block';
}

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
