-- ============================================================
-- TortillaRuta SaaS — Esquema de base de datos (Supabase / Postgres)
-- ============================================================
-- Cómo usar este archivo:
-- 1. Entra a tu proyecto en https://supabase.com
-- 2. Ve a "SQL Editor" (menú izquierdo)
-- 3. Pega TODO este archivo y dale "Run"
-- 4. Listo — tu base de datos multi-negocio está creada
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. EXTENSIONES NECESARIAS
-- ────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";


-- ────────────────────────────────────────────────────────────
-- 2. ORGANIZACIONES (cada negocio que se registra = 1 fila)
-- ────────────────────────────────────────────────────────────
-- Esta es la tabla CLAVE del modelo multi-tenant (SaaS).
-- Cada negocio tiene su propio "org_id", y TODA su información
-- (pedidos, repartidores, etc.) está aislada por este id.

create table organizaciones (
  id              uuid primary key default uuid_generate_v4(),
  nombre          text not null,                    -- "Tortillería El Molino"
  slug            text unique not null,             -- "tortilleria-el-molino" (para URLs)
  telefono_wa     text,                             -- número de WhatsApp del negocio
  direccion       text,
  plan            text not null default 'gratis',  -- 'gratis' | 'pro' | 'premium'
  max_repartidores int not null default 3,          -- límite según plan
  creado_en       timestamptz not null default now(),
  activo          boolean not null default true
);

comment on table organizaciones is 'Cada negocio (tenant) registrado en la plataforma';


-- ────────────────────────────────────────────────────────────
-- 3. PERFILES DE USUARIO (vinculados a auth.users de Supabase)
-- ────────────────────────────────────────────────────────────
-- Supabase Auth ya crea la tabla auth.users automáticamente.
-- Aquí guardamos información adicional: a qué organización
-- pertenece cada usuario y qué rol tiene.

create table perfiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  nombre_completo text not null,
  telefono        text,
  rol             text not null default 'repartidor', -- 'dueño' | 'admin' | 'repartidor'
  zona            text,                                -- zona de cobertura (solo repartidores)
  activo          boolean not null default true,
  creado_en       timestamptz not null default now()
);

comment on table perfiles is 'Datos extra de cada usuario: organización, rol, zona';


-- ────────────────────────────────────────────────────────────
-- 4. PEDIDOS
-- ────────────────────────────────────────────────────────────

create table pedidos (
  id                  bigserial primary key,
  organizacion_id     uuid not null references organizaciones(id) on delete cascade,
  numero              integer not null,              -- número visible para el negocio (#001, #002...)

  -- Datos del cliente
  cliente_nombre      text not null,
  cliente_telefono    text,
  direccion           text not null,
  direccion_lat       double precision,              -- coordenadas si se geocodificó
  direccion_lng       double precision,

  -- Datos del pedido
  producto            text,
  notas               text,
  total               numeric(10,2),

  -- Estado y asignación
  estado              text not null default 'pendiente', -- 'pendiente' | 'en_ruta' | 'entregado' | 'cancelado'
  urgente             boolean not null default false,
  repartidor_id       uuid references perfiles(id) on delete set null,

  -- Tracking
  tracking_token      text unique not null default substr(md5(random()::text), 1, 10),

  -- Comprobante de entrega
  foto_entrega_url    text,                          -- URL en Supabase Storage
  nota_entrega        text,
  entrega_lat         double precision,
  entrega_lng         double precision,

  -- Timestamps
  creado_en           timestamptz not null default now(),
  asignado_en         timestamptz,
  en_ruta_en          timestamptz,
  entregado_en        timestamptz,
  actualizado_en      timestamptz not null default now()
);

create index idx_pedidos_org       on pedidos(organizacion_id);
create index idx_pedidos_estado    on pedidos(organizacion_id, estado);
create index idx_pedidos_repartidor on pedidos(repartidor_id);
create index idx_pedidos_token     on pedidos(tracking_token);
create index idx_pedidos_fecha     on pedidos(organizacion_id, creado_en desc);

comment on table pedidos is 'Pedidos de cada negocio, aislados por organizacion_id';


-- Auto-incrementar el "numero" visible por organización (no global)
create or replace function siguiente_numero_pedido()
returns trigger as $$
begin
  select coalesce(max(numero), 0) + 1 into new.numero
  from pedidos
  where organizacion_id = new.organizacion_id;
  return new;
end;
$$ language plpgsql;

create trigger trg_numero_pedido
  before insert on pedidos
  for each row
  when (new.numero is null)
  execute function siguiente_numero_pedido();


-- Actualizar timestamps automáticamente según cambios de estado
create or replace function actualizar_timestamps_pedido()
returns trigger as $$
begin
  new.actualizado_en = now();

  if new.estado = 'en_ruta' and old.estado != 'en_ruta' then
    new.en_ruta_en = now();
    if new.asignado_en is null then new.asignado_en = now(); end if;
  end if;

  if new.estado = 'entregado' and old.estado != 'entregado' then
    new.entregado_en = now();
  end if;

  if new.repartidor_id is not null and old.repartidor_id is null then
    new.asignado_en = now();
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_timestamps_pedido
  before update on pedidos
  for each row
  execute function actualizar_timestamps_pedido();


-- ────────────────────────────────────────────────────────────
-- 5. UBICACIONES EN VIVO DE REPARTIDORES (GPS)
-- ────────────────────────────────────────────────────────────
-- Tabla separada y ligera: se actualiza muy seguido (cada 10-30s)
-- Solo guardamos LA ÚLTIMA ubicación de cada repartidor.

create table ubicaciones_repartidores (
  repartidor_id   uuid primary key references perfiles(id) on delete cascade,
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  lat             double precision not null,
  lng             double precision not null,
  precision_m     double precision,              -- precisión del GPS en metros
  actualizado_en  timestamptz not null default now()
);

create index idx_ubicaciones_org on ubicaciones_repartidores(organizacion_id);

comment on table ubicaciones_repartidores is 'Última ubicación GPS conocida de cada repartidor (para mapa en vivo)';


-- ────────────────────────────────────────────────────────────
-- 6. HISTORIAL DE UBICACIONES (opcional, para rutas/reportes)
-- ────────────────────────────────────────────────────────────
-- Guarda un punto cada vez que se actualiza la ubicación.
-- Útil para reconstruir la ruta recorrida del día.
-- (Se puede limpiar periódicamente para no crecer infinito)

create table historial_ubicaciones (
  id              bigserial primary key,
  repartidor_id   uuid not null references perfiles(id) on delete cascade,
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  lat             double precision not null,
  lng             double precision not null,
  registrado_en   timestamptz not null default now()
);

create index idx_historial_rep_fecha on historial_ubicaciones(repartidor_id, registrado_en desc);

comment on table historial_ubicaciones is 'Historial de puntos GPS para reconstruir rutas (limpiar cada 7-30 días)';


-- ────────────────────────────────────────────────────────────
-- 7. ROW LEVEL SECURITY (RLS) — Aislamiento entre negocios
-- ────────────────────────────────────────────────────────────
-- Esto es LO MÁS IMPORTANTE para un SaaS multi-cliente:
-- garantiza que un negocio NUNCA pueda ver los datos de otro,
-- incluso si hay un error en el código de la app.

alter table organizaciones           enable row level security;
alter table perfiles                 enable row level security;
alter table pedidos                  enable row level security;
alter table ubicaciones_repartidores enable row level security;
alter table historial_ubicaciones    enable row level security;


-- Función helper: obtiene la organización del usuario actual
create or replace function mi_organizacion_id()
returns uuid as $$
  select organizacion_id from perfiles where id = auth.uid();
$$ language sql stable security definer;

-- Función helper: obtiene el rol del usuario actual
create or replace function mi_rol()
returns text as $$
  select rol from perfiles where id = auth.uid();
$$ language sql stable security definer;


-- ── Políticas: ORGANIZACIONES ──
-- Un usuario solo puede ver/editar su propia organización
create policy "ver mi organizacion"
  on organizaciones for select
  using (id = mi_organizacion_id());

create policy "editar mi organizacion (solo dueño)"
  on organizaciones for update
  using (id = mi_organizacion_id() and mi_rol() = 'dueño');


-- ── Políticas: PERFILES ──
-- Ver: cualquiera de mi organización puede ver los perfiles de mi organización
create policy "ver perfiles de mi organizacion"
  on perfiles for select
  using (organizacion_id = mi_organizacion_id());

-- Editar: dueños/admins pueden editar perfiles de su organización;
-- cualquier usuario puede editar SU PROPIO perfil (ej. su ubicación de zona)
create policy "editar perfiles"
  on perfiles for update
  using (
    organizacion_id = mi_organizacion_id()
    and (mi_rol() in ('dueño','admin') or id = auth.uid())
  );

-- Insertar: dueños/admins pueden crear nuevos repartidores en su organización
create policy "crear perfiles (admin)"
  on perfiles for insert
  with check (
    organizacion_id = mi_organizacion_id()
    and mi_rol() in ('dueño','admin')
  );


-- ── Políticas: PEDIDOS ──
-- Ver: cualquiera de la organización ve TODOS los pedidos de su organización
create policy "ver pedidos de mi organizacion"
  on pedidos for select
  using (organizacion_id = mi_organizacion_id());

-- Crear: dueños/admins pueden crear pedidos
create policy "crear pedidos (admin)"
  on pedidos for insert
  with check (
    organizacion_id = mi_organizacion_id()
    and mi_rol() in ('dueño','admin')
  );

-- Editar: admins pueden editar cualquier pedido de su organización;
-- repartidores SOLO pueden editar pedidos asignados a ellos
-- (para marcar entregado, subir foto, etc.)
create policy "editar pedidos"
  on pedidos for update
  using (
    organizacion_id = mi_organizacion_id()
    and (
      mi_rol() in ('dueño','admin')
      or repartidor_id = auth.uid()
    )
  );


-- ── Políticas: UBICACIONES EN VIVO ──
-- Ver: cualquiera de la organización ve las ubicaciones de su organización
create policy "ver ubicaciones de mi organizacion"
  on ubicaciones_repartidores for select
  using (organizacion_id = mi_organizacion_id());

-- Insertar/Actualizar: un repartidor solo puede actualizar SU PROPIA ubicación
create policy "repartidor actualiza su ubicacion"
  on ubicaciones_repartidores for insert
  with check (
    organizacion_id = mi_organizacion_id()
    and repartidor_id = auth.uid()
  );

create policy "repartidor edita su ubicacion"
  on ubicaciones_repartidores for update
  using (repartidor_id = auth.uid());


-- ── Políticas: HISTORIAL DE UBICACIONES ──
create policy "ver historial de mi organizacion"
  on historial_ubicaciones for select
  using (organizacion_id = mi_organizacion_id());

create policy "repartidor inserta su historial"
  on historial_ubicaciones for insert
  with check (
    organizacion_id = mi_organizacion_id()
    and repartidor_id = auth.uid()
  );


-- ────────────────────────────────────────────────────────────
-- 8. ACCESO PÚBLICO PARA TRACKING (sin login)
-- ────────────────────────────────────────────────────────────
-- El cliente final NO tiene cuenta. Accede por un link con un
-- "tracking_token" único. Necesitamos una vista pública segura
-- que SOLO exponga lo necesario (sin teléfonos de otros, etc.)

create view tracking_publico as
select
  p.tracking_token,
  p.numero,
  p.cliente_nombre,
  p.direccion,
  p.producto,
  p.total,
  p.estado,
  p.notas,
  p.foto_entrega_url,
  p.nota_entrega,
  p.creado_en,
  p.asignado_en,
  p.en_ruta_en,
  p.entregado_en,
  p.actualizado_en,
  -- Ubicación en vivo del repartidor (si está en ruta)
  u.lat  as repartidor_lat,
  u.lng  as repartidor_lng,
  u.actualizado_en as ubicacion_actualizada_en,
  -- Datos del negocio
  o.nombre      as negocio_nombre,
  o.telefono_wa as negocio_telefono,
  o.direccion   as negocio_direccion
from pedidos p
join organizaciones o on o.id = p.organizacion_id
left join ubicaciones_repartidores u on u.repartidor_id = p.repartidor_id
where p.estado != 'cancelado';

-- Esta vista es accesible públicamente (sin autenticación) porque
-- el "tracking_token" actúa como contraseña: solo quien tiene el
-- link puede consultar ESE pedido específico.
grant select on tracking_publico to anon;


-- ────────────────────────────────────────────────────────────
-- 9. FUNCIÓN: REGISTRO DE NUEVO NEGOCIO (onboarding)
-- ────────────────────────────────────────────────────────────
-- Cuando un nuevo negocio se registra, esta función crea:
-- 1. La organización
-- 2. El perfil del dueño con rol 'dueño'
-- Se llama DESPUÉS de que el usuario se registra con Supabase Auth.

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

  return v_org_id;
end;
$$ language plpgsql security definer;


-- ────────────────────────────────────────────────────────────
-- 10. REALTIME — Activar actualizaciones en tiempo real
-- ────────────────────────────────────────────────────────────
-- Permite que el panel admin y la página de tracking se
-- actualicen automáticamente sin recargar la página.

alter publication supabase_realtime add table pedidos;
alter publication supabase_realtime add table ubicaciones_repartidores;


-- ────────────────────────────────────────────────────────────
-- 11. STORAGE — Bucket para fotos de entrega
-- ────────────────────────────────────────────────────────────
-- Nota: esto se configura mejor desde el Dashboard de Supabase
-- (Storage → New Bucket), pero aquí dejamos las políticas SQL
-- por si prefieres hacerlo todo por código.

insert into storage.buckets (id, name, public)
values ('fotos-entregas', 'fotos-entregas', true)
on conflict (id) do nothing;

create policy "cualquiera puede ver fotos de entrega"
  on storage.objects for select
  using (bucket_id = 'fotos-entregas');

create policy "usuarios autenticados suben fotos"
  on storage.objects for insert
  with check (bucket_id = 'fotos-entregas' and auth.role() = 'authenticated');


-- ============================================================
-- FIN DEL ESQUEMA
-- ============================================================
-- Siguiente paso: configurar Authentication en Supabase
-- (Settings → Authentication → habilitar Email/Password)
-- ============================================================
