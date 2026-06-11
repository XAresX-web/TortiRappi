/* ============================================================
   maps-loader.js — Carga dinámica de Google Maps API
   ============================================================
   Carga el script de Google Maps usando la API key definida
   en config.js. Llama a window.onGoogleMapsReady() cuando
   esté listo (cada página define esa función).
   ============================================================ */

(function () {
  window._googleMapsReady = false;
  window._googleMapsCallbacks = [];

  window.onGoogleMapsLoaded = function () {
    window._googleMapsReady = true;
    window._googleMapsCallbacks.forEach(cb => cb());
    window._googleMapsCallbacks = [];
  };

  window.whenGoogleMapsReady = function (cb) {
    if (window._googleMapsReady && window.google?.maps) cb();
    else window._googleMapsCallbacks.push(cb);
  };

  if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY.includes('TU-GOOGLE')) {
    console.warn('[Maps] No se configuró GOOGLE_MAPS_API_KEY en config.js — el mapa no se mostrará.');
    return;
  }

  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&loading=async&callback=onGoogleMapsLoaded`;
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
})();
