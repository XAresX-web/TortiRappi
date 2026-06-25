-- ============================================================
-- TortiRappi — Migración v3: Catálogo público + productos
-- Correr en Supabase SQL Editor
-- ============================================================


-- 1. TABLA: PRODUCTOS
-- ────────────────────────────────────────────────────────────
create table if not exists productos (
  id              bigserial primary key,
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  nombre          text not null,
  precio          numeric(10,2) not null default 0,
  disponible      boolean not null default true,
  orden           integer not null default 0,
  creado_en       timestamptz not null default now()
);

create index if not exists idx_productos_org on productos(organizacion_id);

alter table productos enable row level security;

create policy "ver productos de mi organizacion"
  on productos for select
  using (organizacion_id = mi_organizacion_id());

create policy "crear productos (admin)"
  on productos for insert
  with check (
    organizacion_id = mi_organizacion_id()
    and mi_rol() in ('dueño','admin')
  );

create policy "editar productos (admin)"
  on productos for update
  using (
    organizacion_id = mi_organizacion_id()
    and mi_rol() in ('dueño','admin')
  );

create policy "eliminar productos (admin)"
  on productos for delete
  using (
    organizacion_id = mi_organizacion_id()
    and mi_rol() in ('dueño','admin')
  );


-- 2. FUNCIÓN: Obtener catálogo por slug (acceso público)
-- ────────────────────────────────────────────────────────────
create or replace function obtener_catalogo(p_slug text)
returns json as $$
select row_to_json(sub) from (
  select
    o.id as organizacion_id,
    o.nombre as negocio_nombre,
    o.direccion as negocio_direccion,
    o.telefono_wa as negocio_telefono,
    o.slug,
    (
      select coalesce(json_agg(
        json_build_object(
          'id', p.id,
          'nombre', p.nombre,
          'precio', p.precio
        ) order by p.orden, p.nombre
      ), '[]'::json)
      from productos p
      where p.organizacion_id = o.id
        and p.disponible = true
    ) as productos
  from organizaciones o
  where o.slug = p_slug
    and o.activo = true
) sub;
$$ language sql stable security definer;

grant execute on function obtener_catalogo(text) to anon;


-- 3. FUNCIÓN: Crear pedido desde catálogo (acceso público)
-- ────────────────────────────────────────────────────────────
create or replace function crear_pedido_publico(
  p_slug             text,
  p_cliente_nombre   text,
  p_cliente_telefono text,
  p_direccion        text,
  p_productos_json   json,
  p_notas            text default null
)
returns json as $$
declare
  v_org_id uuid;
  v_producto_texto text;
  v_total numeric(10,2);
  v_pedido_id bigint;
  v_tracking_token text;
  v_numero integer;
begin
  select id into v_org_id
  from organizaciones
  where slug = p_slug and activo = true;

  if v_org_id is null then
    raise exception 'Negocio no encontrado';
  end if;

  select
    string_agg(item->>'nombre' || ' x' || (item->>'cantidad'), ', '),
    coalesce(sum((item->>'precio')::numeric * (item->>'cantidad')::integer), 0)
  into v_producto_texto, v_total
  from json_array_elements(p_productos_json) as item;

  insert into pedidos (
    organizacion_id, cliente_nombre, cliente_telefono,
    direccion, producto, total, notas, estado
  ) values (
    v_org_id, p_cliente_nombre, p_cliente_telefono,
    p_direccion, v_producto_texto, v_total, p_notas, 'pendiente'
  )
  returning id, tracking_token, numero
  into v_pedido_id, v_tracking_token, v_numero;

  return json_build_object(
    'pedido_id', v_pedido_id,
    'tracking_token', v_tracking_token,
    'numero', v_numero,
    'total', v_total
  );
end;
$$ language plpgsql security definer;

grant execute on function crear_pedido_publico(text, text, text, text, json, text) to anon;


-- 4. MODIFICAR registrar_negocio() para seedear productos
-- ────────────────────────────────────────────────────────────
create or replace function registrar_negocio(
  p_user_id        uuid,
  p_nombre_negocio text,
  p_slug           text,
  p_nombre_dueño   text,
  p_telefono_wa    text default null
)
returns uuid as $$
declare
  v_org_id uuid;
begin
  insert into organizaciones (nombre, slug, telefono_wa)
  values (p_nombre_negocio, p_slug, p_telefono_wa)
  returning id into v_org_id;

  insert into perfiles (id, organizacion_id, nombre_completo, rol)
  values (p_user_id, v_org_id, p_nombre_dueño, 'dueño');

  insert into productos (organizacion_id, nombre, precio, orden) values
    (v_org_id, 'Tortilla de maíz 500g',  14.00, 1),
    (v_org_id, 'Tortilla de maíz 1kg',   28.00, 2),
    (v_org_id, 'Tortilla de maíz 2kg',   55.00, 3),
    (v_org_id, 'Tortilla de harina 500g', 18.00, 4),
    (v_org_id, 'Tortilla de harina 1kg',  35.00, 5),
    (v_org_id, 'Paquete mixto 3kg',       78.00, 6),
    (v_org_id, 'Paquete mixto 5kg',      125.00, 7);

  return v_org_id;
end;
$$ language plpgsql security definer;


-- 5. SEEDEAR productos para negocios existentes sin productos
-- ────────────────────────────────────────────────────────────
insert into productos (organizacion_id, nombre, precio, orden)
select o.id, p.nombre, p.precio, p.orden
from organizaciones o
cross join (values
  ('Tortilla de maíz 500g',  14.00::numeric, 1),
  ('Tortilla de maíz 1kg',   28.00::numeric, 2),
  ('Tortilla de maíz 2kg',   55.00::numeric, 3),
  ('Tortilla de harina 500g', 18.00::numeric, 4),
  ('Tortilla de harina 1kg',  35.00::numeric, 5),
  ('Paquete mixto 3kg',       78.00::numeric, 6),
  ('Paquete mixto 5kg',      125.00::numeric, 7)
) as p(nombre, precio, orden)
where not exists (select 1 from productos where organizacion_id = o.id);


-- 6. REALTIME para productos
-- ────────────────────────────────────────────────────────────
alter publication supabase_realtime add table productos;


-- ============================================================
-- FIN DE LA MIGRACIÓN v3
-- ============================================================
