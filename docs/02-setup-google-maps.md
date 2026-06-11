# 🗺️ Configurar Google Maps (GPS en vivo)

Necesitas una API Key de Google Maps para que funcione el mapa con la
ubicación en vivo de tus repartidores.

---

## Paso 1 — Crear proyecto en Google Cloud

1. Ve a **https://console.cloud.google.com/**
2. Inicia sesión con tu cuenta de Google
3. Arriba, click en el selector de proyecto → **"New Project"**
4. Nómbralo `TortillaRuta` → Create

---

## Paso 2 — Activar la API de Maps

1. En el buscador superior, escribe **"Maps JavaScript API"**
2. Click en el resultado → **"Enable"** (Habilitar)
3. Repite para **"Geocoding API"** (opcional, para convertir direcciones en coordenadas)

---

## Paso 3 — Crear tu API Key

1. Menú izquierdo → **"APIs & Services" → "Credentials"**
2. Click **"+ Create Credentials" → "API key"**
3. Copia la clave generada (algo como `AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`)

---

## Paso 4 — Restringir tu API Key (IMPORTANTE — seguridad)

Sin restricciones, cualquiera podría usar tu clave y gastar tu crédito.

1. Click en la clave que acabas de crear
2. En **"Application restrictions"** elige **"Websites"**
3. Agrega las URLs donde funcionará tu app:
   - `https://tortillaruta.netlify.app/*` (o tu dominio)
   - `http://localhost:8080/*` (para pruebas locales)
4. En **"API restrictions"** elige **"Restrict key"** y selecciona:
   - Maps JavaScript API
   - Geocoding API
5. Save

---

## Paso 5 — Pegar la clave en tu app

Abre `public/js/config.js` y pega tu clave:

```javascript
const GOOGLE_MAPS_API_KEY = 'AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
```

---

## 💰 Sobre el costo

- Google da **$200 USD de crédito gratis cada mes** automáticamente.
- El uso típico de un negocio pequeño (mapa cargado algunas decenas/cientos de
  veces al día) está MUY por debajo de ese límite — normalmente $0.

### Para mantenerlo gratis:
1. Activa **alertas de presupuesto**: Billing → Budgets & alerts → crea una
   alerta en $1 USD para que te avisen si algo sale mal
2. Las restricciones del Paso 4 evitan uso indebido por terceros

---

## ✅ Verificar que funciona

1. Abre tu app y entra al panel admin
2. Si ves el mapa cargando correctamente (sin mensaje de error gris), ¡listo!
3. Si ves "Esta página no puede cargar Google Maps correctamente", revisa:
   - Que copiaste la clave completa sin espacios
   - Que activaste "Maps JavaScript API"
   - Que la facturación esté activada en tu cuenta de Google Cloud (es
     necesario aunque uses la capa gratuita — Google pide tarjeta pero no
     cobra dentro del crédito gratuito)
