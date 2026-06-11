# 🗄️ Configurar Supabase — Guía paso a paso

Supabase es el "cerebro" de tu app: guarda todos los pedidos, repartidores y
ubicaciones en la nube, de forma gratuita (hasta cierto límite, generoso para
empezar).

---

## Paso 1 — Crear tu cuenta y proyecto

1. Ve a **https://supabase.com** → "Start your project"
2. Crea cuenta con tu correo o GitHub
3. Click en **"New Project"**
   - **Name**: `tortillaruta` (o el nombre que quieras)
   - **Database Password**: genera una segura y **GUÁRDALA** en un lugar seguro
   - **Region**: elige la más cercana a México, ej. `us-west-1` o `us-east-1`
4. Espera ~2 minutos mientras se crea el proyecto

---

## Paso 2 — Ejecutar el esquema de base de datos

1. En el menú izquierdo, click en **"SQL Editor"**
2. Click en **"New query"**
3. Abre el archivo `supabase/schema.sql` (incluido en este proyecto)
4. Copia TODO el contenido y pégalo en el editor
5. Click en **"Run"** (o Ctrl+Enter)
6. Deberías ver "Success. No rows returned" — ¡listo! Tu base de datos está creada

> Si ves un error, revisa que copiaste el archivo completo desde el inicio.

---

## Paso 3 — Activar autenticación por correo

1. Menú izquierdo → **"Authentication"** → **"Providers"**
2. Asegúrate que **"Email"** esté habilitado (lo está por defecto)
3. Ve a **"Authentication" → "URL Configuration"**
4. En **"Site URL"** pon la URL donde publicarás tu app (ej. `https://tortillaruta.netlify.app`)
   - Si aún no la tienes, pon `http://localhost:8080` por ahora y cámbialo después

### Opcional pero recomendado: desactivar confirmación de correo (para pruebas rápidas)
1. **Authentication → Providers → Email**
2. Desactiva **"Confirm email"** (puedes reactivarlo cuando vendas el producto)

---

## Paso 4 — Obtener tus credenciales de conexión

1. Menú izquierdo → **"Project Settings"** (ícono de engranaje) → **"API"**
2. Copia estos dos valores:
   - **Project URL** → algo como `https://abcdefgh.supabase.co`
   - **anon public key** → una cadena larga que empieza con `eyJ...`

3. Abre el archivo `public/js/config.js` (incluido en este proyecto)
4. Pega tus valores ahí:

```javascript
const SUPABASE_URL = 'https://abcdefgh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...........tu-clave-larga.......';
```

> ⚠️ La "anon key" es PÚBLICA y segura de exponer — Supabase usa Row Level
> Security (RLS) para proteger los datos, no esta clave. NUNCA expongas la
> "service_role key" (esa sí es secreta).

---

## Paso 5 — Configurar Storage (fotos de entrega)

El esquema SQL ya creó el bucket `fotos-entregas`, pero verifica:

1. Menú izquierdo → **"Storage"**
2. Deberías ver un bucket llamado **"fotos-entregas"** marcado como público
3. Si no existe, créalo manualmente:
   - Click "New bucket" → nombre: `fotos-entregas` → marca "Public bucket" → Create

---

## Paso 6 — Crear tu primer negocio (registro)

1. Abre tu app (`public/registro.html`) en el navegador
2. Llena el formulario de registro de negocio
3. Esto creará automáticamente:
   - Tu cuenta de usuario (en Supabase Auth)
   - Tu organización (negocio)
   - Tu perfil con rol "dueño"

---

## 📊 Límites del plan gratuito de Supabase (a junio 2026)

- 500 MB de base de datos
- 1 GB de almacenamiento de archivos (fotos)
- 50,000 usuarios activos mensuales
- 2 millones de Edge Function invocations
- Proyectos pausados tras 1 semana de inactividad (se reactivan solos al usarlos)

Esto es **más que suficiente** para varios negocios pequeños/medianos. Cuando
crezcas, el plan Pro cuesta $25 USD/mes y quita estos límites.

---

## 🔄 Verificar que Realtime está activo

1. Menú izquierdo → **"Database" → "Replication"**
2. Verifica que las tablas `pedidos` y `ubicaciones_repartidores` tengan el
   toggle de Realtime activado (el script SQL ya lo hizo, esto es solo para
   confirmar)

---

## ✅ Checklist final

- [ ] Proyecto creado en Supabase
- [ ] `schema.sql` ejecutado sin errores
- [ ] Email auth habilitado
- [ ] Credenciales copiadas a `public/js/config.js`
- [ ] Bucket `fotos-entregas` existe y es público
- [ ] Primer negocio registrado desde `registro.html`

Cuando todo esto esté listo, tu app estará 100% funcional con datos reales en
la nube, sincronización en tiempo real y multi-negocio.
