-- ============================================================
-- TortiRappi — Migración v2 (correr en Supabase SQL Editor)
-- ============================================================
-- Si ya tienes la base de datos creada con schema.sql original,
-- corre ESTE archivo para aplicar las correcciones de seguridad
-- y estabilidad. Es seguro correrlo múltiples veces.
-- ============================================================


-- 1. RACE CONDITION: Evitar números de pedido duplicados
--    bajo inserciones concurrentes
-- ────────────────────────────────────────────────────────────
create or replace function siguiente_numero_pedido()
returns trigger as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.organizacion_id::text));
  select coalesce(max(numero), 0) + 1 into new.numero
  from pedidos
  where organizacion_id = new.organizacion_id;
  return new;
end;
$$ language plpgsql;


-- 2. TRACKING TOKEN: Tokens más seguros para pedidos nuevos
--    (los tokens existentes siguen funcionando sin cambio)
-- ────────────────────────────────────────────────────────────
alter table pedidos
  alter column tracking_token
  set default replace(uuid_generate_v4()::text, '-', '');


-- 3. SEGURIDAD: Quitar acceso directo a la vista tracking_publico
--    y reemplazarlo con una función que solo devuelve UN pedido
--    por token (evita que un usuario anónimo consulte TODOS los pedidos)
-- ────────────────────────────────────────────────────────────
revoke select on tracking_publico from anon;

create or replace function obtener_tracking(p_token text)
returns json as $$
select row_to_json(sub) from (
  select
    t.tracking_token, t.numero, t.cliente_nombre, t.direccion,
    t.producto, t.total, t.estado, t.notas,
    t.foto_entrega_url, t.nota_entrega,
    t.creado_en, t.asignado_en, t.en_ruta_en, t.entregado_en, t.actualizado_en,
    t.repartidor_lat, t.repartidor_lng, t.ubicacion_actualizada_en,
    t.negocio_nombre, t.negocio_telefono, t.negocio_direccion
  from tracking_publico t
  where t.tracking_token = p_token
) sub;
$$ language sql stable security definer;

grant execute on function obtener_tracking(text) to anon;


-- ============================================================
-- FIN DE LA MIGRACIÓN
-- ============================================================
