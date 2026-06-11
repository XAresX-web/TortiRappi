/* ============================================================
   auth.js — Manejo de sesión y autenticación
   ============================================================ */

const Auth = {
  // Sesión y perfil actuales (cache en memoria)
  _session: null,
  _perfil: null,
  _organizacion: null,

  // ── Obtener sesión actual ─────────────────────────────────
  async getSession() {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) { console.error('[Auth] Error sesión:', error); return null; }
    this._session = data.session;
    return this._session;
  },

  // ── Obtener perfil del usuario actual (con organización) ──
  async getPerfil() {
    if (this._perfil) return this._perfil;

    const session = await this.getSession();
    if (!session) return null;

    const { data, error } = await supabaseClient
      .from('perfiles')
      .select('*, organizaciones(*)')
      .eq('id', session.user.id)
      .single();

    if (error) { console.error('[Auth] Error perfil:', error); return null; }

    this._perfil = data;
    this._organizacion = data.organizaciones;
    return this._perfil;
  },

  async getOrganizacion() {
    if (this._organizacion) return this._organizacion;
    await this.getPerfil();
    return this._organizacion;
  },

  // ── Login ──────────────────────────────────────────────────
  async login(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) return { error: traducirError(error.message) };
    this._session = data.session;
    return { data };
  },

  // ── Registro de NUEVO NEGOCIO (dueño) ────────────────────
  async registrarNegocio({ email, password, nombreNegocio, nombreDueño, telefonoWA }) {
    // 1. Crear usuario en Auth
    const { data: authData, error: authError } = await supabaseClient.auth.signUp({ email, password });
    if (authError) return { error: traducirError(authError.message) };

    const userId = authData.user?.id;
    if (!userId) return { error: 'No se pudo crear el usuario. Intenta de nuevo.' };

    // 2. Generar slug único a partir del nombre del negocio
    const slugBase = nombreNegocio.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const slug = `${slugBase}-${Math.random().toString(36).substr(2, 4)}`;

    // 3. Crear organización + perfil de dueño vía función RPC
    const { error: rpcError } = await supabaseClient.rpc('registrar_negocio', {
      p_user_id: userId,
      p_nombre_negocio: nombreNegocio,
      p_slug: slug,
      p_nombre_dueño: nombreDueño,
      p_telefono_wa: telefonoWA || null,
    });

    if (rpcError) return { error: traducirError(rpcError.message) };

    return { data: { userId, slug } };
  },

  // ── Crear repartidor (lo hace el dueño/admin desde el panel) ──
  // NOTA: requiere que el repartidor confirme su correo o que
  // "Confirm email" esté desactivado en Supabase para pruebas.
  async crearRepartidor({ email, password, nombreCompleto, telefono, zona }) {
    const org = await this.getOrganizacion();
    if (!org) return { error: 'No se encontró tu organización.' };

    // Crear usuario auth (esto cierra la sesión del admin temporalmente
    // en algunos flujos — se maneja con signUp que no cambia la sesión activa
    // si "autoconfirm" está activo, pero recomendamos hacerlo desde un
    // dispositivo aparte o re-loguear al admin después)
    const { data: authData, error: authError } = await supabaseClient.auth.signUp({ email, password });
    if (authError) return { error: traducirError(authError.message) };

    const userId = authData.user?.id;
    if (!userId) return { error: 'No se pudo crear el usuario repartidor.' };

    const { error: insertError } = await supabaseClient.from('perfiles').insert({
      id: userId,
      organizacion_id: org.id,
      nombre_completo: nombreCompleto,
      telefono,
      zona,
      rol: 'repartidor',
    });

    if (insertError) return { error: traducirError(insertError.message) };

    return { data: { userId } };
  },

  // ── Logout ─────────────────────────────────────────────────
  async logout() {
    await supabaseClient.auth.signOut();
    this._session = null;
    this._perfil = null;
    this._organizacion = null;
    window.location.href = 'login.html';
  },

  // ── Proteger página: redirige a login si no hay sesión ────
  async requireAuth(rolesPermitidos = null) {
    const session = await this.getSession();
    if (!session) {
      window.location.href = 'login.html';
      return null;
    }
    const perfil = await this.getPerfil();
    if (!perfil) {
      window.location.href = 'login.html';
      return null;
    }
    if (rolesPermitidos && !rolesPermitidos.includes(perfil.rol)) {
      alert('No tienes permiso para acceder a esta página.');
      window.location.href = perfil.rol === 'repartidor' ? 'repartidor.html' : 'admin.html';
      return null;
    }
    return perfil;
  },
};

// ── Traducir mensajes de error comunes de Supabase ──────────
function traducirError(msg) {
  const traducciones = {
    'Invalid login credentials': 'Correo o contraseña incorrectos.',
    'User already registered': 'Ya existe una cuenta con ese correo.',
    'Password should be at least 6 characters': 'La contraseña debe tener al menos 6 caracteres.',
    'Email not confirmed': 'Debes confirmar tu correo antes de iniciar sesión.',
    'Unable to validate email address: invalid format': 'El formato del correo no es válido.',
  };
  return traducciones[msg] || msg;
}

window.Auth = Auth;
