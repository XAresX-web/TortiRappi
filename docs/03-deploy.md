# 🚀 Publicar tu app en Internet (Netlify)

---

## Opción recomendada: Netlify (gratis)

### Paso 1 — Preparar
Asegúrate de haber completado:
- `docs/01-setup-supabase.md` (base de datos)
- `docs/02-setup-google-maps.md` (mapas)
- Editado `public/js/config.js` con tus 3 claves

### Paso 2 — Subir a Netlify

**Opción A: Arrastrar y soltar (más fácil)**
1. Ve a **https://app.netlify.com/drop**
2. Arrastra la carpeta **`public/`** completa (solo esa carpeta, no todo el proyecto)
3. Netlify te da una URL como `https://random-name-123.netlify.app`

**Opción B: Conectar con GitHub (recomendado para actualizaciones)**
1. Sube este proyecto a un repositorio de GitHub
2. En Netlify: "Add new site" → "Import an existing project"
3. Conecta tu repo
4. **Build settings**:
   - Base directory: `public`
   - Build command: (dejar vacío)
   - Publish directory: `public`
5. Deploy

### Paso 3 — Dominio personalizado (opcional)
1. En Netlify: Site settings → Domain management → Add custom domain
2. Sigue las instrucciones para apuntar tu dominio (ej. `tortillaruta.mx`)

### Paso 4 — Actualizar URLs de configuración
Una vez que tengas tu URL final:
1. Actualiza `public/js/config.js` si usaste `APP_URL` fija (por defecto usa `window.location.origin`, así que normalmente no necesitas tocar nada)
2. En Supabase: **Authentication → URL Configuration → Site URL** → pon tu URL de Netlify
3. En Google Cloud: agrega tu URL de Netlify a las restricciones de la API Key de Maps

---

## 📱 Instalar como app en celular

### Android (Chrome):
1. Abre tu URL (ej. `https://tortillaruta.netlify.app/repartidor.html`)
2. Menú (⋮) → "Añadir a pantalla principal"

### iPhone (Safari — debe ser Safari):
1. Abre la URL
2. Botón compartir (□↑) → "Agregar a pantalla de inicio"

---

## 🔄 Actualizar la app después de cambios

**Si usaste arrastrar y soltar**: vuelve a arrastrar la carpeta `public/` actualizada a Netlify Drop — se reemplaza automáticamente.

**Si conectaste GitHub**: solo haz `git push` y Netlify reconstruye automáticamente.

---

## 🧪 Probar localmente antes de publicar (opcional)

Si tienes Python instalado:
```bash
cd public
python3 -m http.server 8080
```
Abre `http://localhost:8080` en tu navegador.

> Nota: el Service Worker y algunas funciones de geolocalización requieren
> HTTPS o `localhost` específicamente — `http://localhost:8080` funciona bien
> para pruebas.
