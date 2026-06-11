/* ============================================================
   offline-queue.js — Cola de entregas pendientes de sincronizar
   ============================================================
   Cuando el repartidor confirma una entrega SIN internet, se
   guarda aquí (IndexedDB). Al recuperar conexión, se sube
   automáticamente a Supabase (incluyendo la foto).
   ============================================================ */

const OQ_DB_NAME = 'tortillaruta_offline';
const OQ_STORE   = 'entregas_pendientes';
let _oqDb = null;

function oqOpen() {
  if (_oqDb) return Promise.resolve(_oqDb);
  return new Promise((res, rej) => {
    const req = indexedDB.open(OQ_DB_NAME, 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(OQ_STORE)) {
        db.createObjectStore(OQ_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => { _oqDb = e.target.result; res(_oqDb); };
    req.onerror   = () => rej(req.error);
  });
}

const OfflineQueue = {
  // Guardar una entrega pendiente (foto en base64 + datos)
  async agregar(entrega) {
    const db = await oqOpen();
    return new Promise((res, rej) => {
      const tx = db.transaction(OQ_STORE, 'readwrite');
      const r  = tx.objectStore(OQ_STORE).add({ ...entrega, ts: Date.now() });
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  },

  // Obtener todas las pendientes
  async listar() {
    const db = await oqOpen();
    return new Promise((res, rej) => {
      const r = db.transaction(OQ_STORE, 'readonly').objectStore(OQ_STORE).getAll();
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  },

  // Eliminar una pendiente ya sincronizada
  async eliminar(id) {
    const db = await oqOpen();
    return new Promise((res, rej) => {
      const r = db.transaction(OQ_STORE, 'readwrite').objectStore(OQ_STORE).delete(id);
      r.onsuccess = () => res();
      r.onerror   = () => rej(r.error);
    });
  },

  // Procesar toda la cola (subir a Supabase)
  async procesar() {
    if (!navigator.onLine) return { procesadas: 0, pendientes: (await this.listar()).length };

    const pendientes = await this.listar();
    let procesadas = 0;

    for (const item of pendientes) {
      try {
        let fotoUrl = null;

        // Subir foto a Supabase Storage si existe
        if (item.foto_base64) {
          const blob = await (await fetch(item.foto_base64)).blob();
          const fileName = `${item.pedido_id}_${item.ts}.jpg`;
          const { error: upErr } = await supabaseClient.storage
            .from('fotos-entregas')
            .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });

          if (!upErr) {
            const { data: urlData } = supabaseClient.storage.from('fotos-entregas').getPublicUrl(fileName);
            fotoUrl = urlData.publicUrl;
          }
        }

        // Actualizar pedido
        const updateData = {
          estado: 'entregado',
          nota_entrega: item.nota || '',
        };
        if (fotoUrl) updateData.foto_entrega_url = fotoUrl;
        if (item.lat) updateData.entrega_lat = item.lat;
        if (item.lng) updateData.entrega_lng = item.lng;

        const { error } = await supabaseClient.from('pedidos').update(updateData).eq('id', item.pedido_id);

        if (!error) {
          await this.eliminar(item.id);
          procesadas++;
        }
      } catch (e) {
        console.error('[OfflineQueue] Error procesando item', item.id, e);
      }
    }

    return { procesadas, pendientes: (await this.listar()).length };
  },
};

window.OfflineQueue = OfflineQueue;

// Procesar automáticamente al recuperar conexión
window.addEventListener('online', async () => {
  const result = await OfflineQueue.procesar();
  if (result.procesadas > 0 && window.toast) {
    window.toast(`${result.procesadas} entrega(s) sincronizada(s)`);
  }
  if (window.actualizarBadgeSync) window.actualizarBadgeSync();
});
