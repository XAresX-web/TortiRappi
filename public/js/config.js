/* ============================================================
   config.js — CONFIGURACIÓN CENTRAL
   ============================================================
   Este es el ÚNICO archivo que necesitas editar para conectar
   tu app con tu proyecto de Supabase.

   Sigue la guía: docs/01-setup-supabase.md
   ============================================================ */

// 1. Pega aquí la "Project URL" de tu proyecto Supabase
const SUPABASE_URL = 'https://qbawcklgkhposyxxoqsn.supabase.com';

// 2. Pega aquí la "anon public key" (es segura de exponer)
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFiYXdja2xna2hwb3N5eHhvcXNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExNzgzMzMsImV4cCI6MjA5Njc1NDMzM30.a-DefhHglBPQYliQwySXVzyvFQhMdMrz0lGr9Vz10qc';

// 3. Google Maps API Key (ver docs/02-setup-google-maps.md)
const GOOGLE_MAPS_API_KEY = 'AIzaSyDYVyLIZY8L0M7pf-u_uKw2b3stjkClzyc';

// 4. URL base donde está publicada tu app (sin / al final)
//    Ejemplo: 'https://tortillaruta.netlify.app'
const APP_URL = window.location.origin;

// ── No edites debajo de esta línea ──────────────────────────

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Intervalo de actualización de GPS del repartidor (ms)
const GPS_INTERVAL_MS = 15000; // cada 15 segundos

// Intervalo de refresco de tracking público (ms)
const TRACKING_REFRESH_MS = 10000; // cada 10 segundos
