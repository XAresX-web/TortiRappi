# 🫓 TortillaRuta — SaaS de gestión de entregas

App real (no demo) para administrar pedidos, repartidores y entregas de
tortillerías y negocios similares, con multi-negocio (SaaS), GPS en vivo,
tracking público para clientes y funcionamiento offline.

---

## 🧱 ¿Qué incluye?

- **Backend en Supabase**: base de datos, autenticación, tiempo real y
  almacenamiento de fotos — gratis para empezar
- **Multi-negocio (multi-tenant)**: cada negocio que se registra tiene sus
  propios datos completamente aislados (Row Level Security)
- **Panel admin**: pedidos, repartidores, mapa en vivo, asignación al más
  cercano, rendimiento del día
- **App repartidor (PWA)**: ruta del día, GPS en vivo, confirmar entrega con
  foto y nota, funciona sin internet (cola offline)
- **Tracking público para clientes**: link por WhatsApp, sin necesidad de
  cuenta, mapa en vivo del repartidor
- **Google Maps**: ubicación en vivo, cálculo de repartidor más cercano

---

## 🚀 Puesta en marcha (orden recomendado)

1. **[docs/01-setup-supabase.md](docs/01-setup-supabase.md)** — crear base de
   datos y autenticación (15-20 min)
2. **[docs/02-setup-google-maps.md](docs/02-setup-google-maps.md)** — activar
   mapas con GPS (10 min)
3. Edita **`public/js/config.js`** con tus 3 claves (Supabase URL, Supabase
   anon key, Google Maps key)
4. **[docs/03-deploy.md](docs/03-deploy.md)** — publicar en internet con
   Netlify (5 min)

Tiempo total estimado: **30-45 minutos** para tener tu app funcionando en vivo.

---

## 📂 Estructura del proyecto

```
tortillaruta-saas/
├── supabase/
│   └── schema.sql          ← Ejecutar UNA VEZ en Supabase SQL Editor
├── docs/
│   ├── 01-setup-supabase.md
│   ├── 02-setup-google-maps.md
│   └── 03-deploy.md
└── public/                  ← Esta es la carpeta que se publica
    ├── login.html           ← Inicio de sesión
    ├── registro.html         ← Registro de nuevo negocio (onboarding SaaS)
    ├── admin.html            ← Panel del dueño/administrador
    ├── repartidor.html       ← App del repartidor (PWA con GPS)
    ├── tracking.html         ← Página pública de seguimiento (clientes)
    ├── manifest.json / sw.js ← PWA (instalable, funciona offline)
    ├── css/style.css         ← Estilos (colores personalizables en :root)
    ├── icons/                ← Íconos de la app
    └── js/
        ├── config.js         ← ⚠️ ÚNICO ARCHIVO QUE DEBES EDITAR
        ├── auth.js            ← Login, registro, sesiones
        ├── admin.js           ← Lógica del panel admin
        ├── repartidor.js      ← Lógica de la app repartidor + GPS
        ├── tracking.js        ← Lógica del tracking público
        ├── offline-queue.js   ← Cola de entregas sin internet
        └── maps-loader.js     ← Carga dinámica de Google Maps
```

---

## 👥 Roles de usuario

| Rol | Acceso | Cómo se crea |
|---|---|---|
| **Dueño** | Panel admin completo, configuración del negocio | Se crea automáticamente al registrar el negocio en `registro.html` |
| **Admin** | Panel admin (sin poder cambiar config. del negocio) | El dueño puede crearlos editando su rol en Supabase manualmente (futuro: UI) |
| **Repartidor** | App de ruta y entregas (`repartidor.html`) | El dueño/admin lo crea desde el panel ("Agregar repartidor") |
| **Cliente final** | Solo `tracking.html` con su link único, sin cuenta | Recibe el link automáticamente por WhatsApp al crear su pedido |

---

## 🎨 Personalizar colores y nombre

Edita las variables en `public/css/style.css`:

```css
:root {
  --primary: #1D9E75;  /* Verde teal — color principal */
  --accent:  #D85A30;  /* Naranja/coral — acentos, urgente */
}
```

Para cambiar el nombre de la app, busca y reemplaza "TortillaRuta" en los
archivos `.html` y `manifest.json`.

---

## 💳 Planes y límites (estructura para vender el SaaS)

La tabla `organizaciones` en Supabase ya incluye:
- `plan` (texto: "gratis", "pro", "premium")
- `max_repartidores` (número — controla cuántos repartidores puede agregar
  cada negocio)

Esto te permite ofrecer distintos planes a tus clientes (otros negocios) solo
cambiando estos valores manualmente desde el SQL Editor de Supabase, por
ejemplo:

```sql
update organizaciones set plan = 'pro', max_repartidores = 10
where slug = 'tortilleria-el-molino-ab12';
```

Una UI de upgrade de planes y cobro automático (Stripe, etc.) quedaría como
siguiente fase del proyecto.

---

## 🔮 Posibles mejoras futuras

- Geocodificación automática de direcciones (para que "asignar al más
  cercano" use distancias reales desde el primer pedido)
- Recuperación de contraseña
- Notificaciones push al cliente (cambios de estado)
- Historial y reportes más allá de "hoy" (exportar a Excel/PDF)
- Panel super-admin para gestionar todos los negocios registrados
- Cobro automático de planes (Stripe/Mercado Pago)
- Límite de pedidos por mes según plan (no solo repartidores)

---

## 🆘 Soporte

Si algo no funciona:
1. Revisa la consola del navegador (F12 → pestaña "Console") — los errores de
   Supabase o Maps aparecen ahí con detalles
2. Verifica que `public/js/config.js` tenga las 3 claves correctas, sin
   espacios extra
3. Revisa que el `schema.sql` se haya ejecutado completo sin errores en
   Supabase
