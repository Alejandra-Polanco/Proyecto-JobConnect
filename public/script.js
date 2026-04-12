const API_URL = 'http://localhost:3000/api';
let usuarioActual = null;
let vacanteDetalleId = null;

document.addEventListener('DOMContentLoaded', () => {
    verificarSesion();
    actualizarEstadisticas();
    cargarValoraciones();
});

// --- NAVEGACIÓN Y VISTAS ---
function ocultarTodo() {
    ['vista-inicio', 'vista-resultados', 'vista-recursos', 'vista-valoraciones', 'vista-admin', 'vista-perfil', 'vista-detalle'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('d-none');
    });
    window.scrollTo(0, 0);
}

function irInicio() { ocultarTodo(); document.getElementById('vista-inicio').classList.remove('d-none'); }
function mostrarRecursos() { ocultarTodo(); document.getElementById('vista-recursos').classList.remove('d-none'); }
function mostrarValoraciones() { ocultarTodo(); document.getElementById('vista-valoraciones').classList.remove('d-none'); cargarValoraciones(); }
function mostrarAdmin() { ocultarTodo(); document.getElementById('vista-admin').classList.remove('d-none'); initAdminCharts(); }

// --- BÚSQUEDA ---
async function buscar() {
    const q = document.getElementById('input-busqueda').value;
    try {
        const res = await fetch(`${API_URL}/vacantes/buscar?q=${q}`);
        const vacantes = await res.json();
        
        ocultarTodo();
        document.getElementById('vista-resultados').classList.remove('d-none');
        document.getElementById('txt-resultados').innerText = `Resultados para "${q}"`;
        
        const contenedor = document.getElementById('contenedor-vacantes');
        contenedor.innerHTML = '';

        if (vacantes.length === 0) {
            contenedor.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>No encontramos vacantes que coincidan.</p></div>';
            return;
        }

        vacantes.forEach((v, index) => {
            contenedor.innerHTML += `
                <div class="col-12 animate-up" style="animation-delay: ${index * 0.1}s">
                    <div class="vacante-card d-flex justify-content-between align-items-center">
                        <div>
                            <span class="badge-mod ${v.modalidad}">${v.modalidad}</span>
                            <h4 class="vacante-title mt-2">${v.titulo}</h4>
                            <div class="vacante-meta">${v.ubicacion} • <span style="color:var(--cyan)">$${v.salario}</span></div>
                        </div>
                        <button class="btn-primary-job" onclick="verDetalle(${v.id_vacante})">Ver vacante</button>
                    </div>
                </div>`;
        });
    } catch (err) { mostrarToast("Error al buscar vacantes", "error"); }
}

// --- DETALLE VACANTE ---
async function verDetalle(id) {
    try {
        const res = await fetch(`${API_URL}/vacantes/${id}`);
        const v = await res.json();
        vacanteDetalleId = v.id_vacante;

        // Usamos el modal que ya tienes en el HTML
        document.getElementById('det-titulo').innerText = v.titulo;
        document.getElementById('det-sub').innerText = `${v.ubicacion} • $${v.salario}/mes`;
        document.getElementById('det-descripcion').innerText = v.descripcion;
        
        const badges = document.getElementById('det-badges');
        badges.innerHTML = `<span class="badge-mod ${v.modalidad}">${v.modalidad}</span>`;

        const modal = new bootstrap.Modal(document.getElementById('modalDetalle'));
        modal.show();
    } catch (err) { mostrarToast("No se pudo cargar el detalle", "error"); }
}

// --- POSTULACIÓN ---
async function realizarPostulacion() {
    const token = localStorage.getItem('token');
    if (!token) {
        bootstrap.Modal.getInstance(document.getElementById('modalDetalle')).hide();
        abrirModal('modalLogin');
        return;
    }

    try {
        const res = await fetch(`${API_URL}/postulaciones`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ id_vacante: vacanteDetalleId })
        });
        const data = await res.json();
        if (res.ok) {
            mostrarToast("¡Postulación enviada!", "success");
            bootstrap.Modal.getInstance(document.getElementById('modalDetalle')).hide();
        } else {
            mostrarToast(data.error, "error");
        }
    } catch (err) { mostrarToast("Error de conexión", "error"); }
}

// --- AUTH (LOGIN/REGISTRO) ---
async function auth(tipo) {
    const path = tipo === 'login' ? 'login' : 'registro';
    const body = tipo === 'login' 
        ? { email: document.getElementById('log-email').value, password: document.getElementById('log-pass').value }
        : { nombre: document.getElementById('reg-nom').value, email: document.getElementById('reg-email').value, password: document.getElementById('reg-pass').value };

    try {
        const res = await fetch(`${API_URL}/${path}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
        const data = await res.json();

        if (data.success) {
            localStorage.setItem('token', data.user.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            mostrarToast(`¡Bienvenido, ${data.user.nombre}!`, "success");
            location.reload();
        } else {
            mostrarToast(data.message, "error");
        }
    } catch (err) { mostrarToast("Error en el servidor", "error"); }
}

// --- VALORACIONES ---
let puntosSeleccionados = 0;
function setPuntos(n) {
    puntosSeleccionados = n;
    const stars = document.querySelectorAll('#star-rating .star');
    stars.forEach((s, i) => {
        s.innerHTML = i < n ? '★' : '☆';
        s.classList.toggle('active', i < n);
    });
}

async function guardarValoracion() {
    const token = localStorage.getItem('token');
    if (!token) { abrirModal('modalLogin'); return; }

    const payload = {
        empresa_nombre: document.getElementById('val-empresa').value,
        puntuacion: puntosSeleccionados,
        comentario: document.getElementById('val-coment').value
    };

    try {
        const res = await fetch(`${API_URL}/valoraciones`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            mostrarToast("Valoración publicada", "success");
            bootstrap.Modal.getInstance(document.getElementById('modalValoracion')).hide();
            cargarValoraciones();
        }
    } catch (err) { mostrarToast("Error al guardar", "error"); }
}

async function cargarValoraciones() {
    const res = await fetch(`${API_URL}/valoraciones`);
    const data = await res.json();
    const lista = document.getElementById('lista-valoraciones');
    lista.innerHTML = '';
    data.forEach(v => {
        lista.innerHTML += `
            <div class="col-md-6 animate-up">
                <div class="val-card">
                    <div class="val-empresa">${v.empresa_nombre}</div>
                    <div class="val-stars" style="color:#fbbf24">${'★'.repeat(v.puntuacion)}${'☆'.repeat(5-v.puntuacion)}</div>
                    <p class="val-comment">"${v.comentario}"</p>
                    <small style="color:var(--gray-4)">— ${v.usuario_nombre}</small>
                </div>
            </div>`;
    });
}

// --- PUBLICAR ---
async function publicarVacante() {
    const token = localStorage.getItem('token');
    const payload = {
        titulo: document.getElementById('pub-titulo').value,
        ubicacion: document.getElementById('pub-ubicacion').value,
        salario: document.getElementById('pub-salario').value,
        modalidad: document.getElementById('pub-modalidad').value,
        descripcion: document.getElementById('pub-descripcion').value
    };

    try {
        const res = await fetch(`${API_URL}/vacantes`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            mostrarToast("Vacante publicada", "success");
            bootstrap.Modal.getInstance(document.getElementById('modalPublicar')).hide();
            irInicio();
        }
    } catch (err) { mostrarToast("Error al publicar", "error"); }
}

// --- UTILS ---
function verificarSesion() {
    const user = JSON.parse(localStorage.getItem('user'));
    if (user) {
        usuarioActual = user;
        document.getElementById('auth-buttons').style.display = 'none';
        const userMenu = document.getElementById('user-menu');
        userMenu.setAttribute('style', 'display: flex !important');
        document.getElementById('user-name-nav').innerText = user.nombre;
        document.getElementById('nav-mi-perfil').style.display = 'block';
        if (user.rol === 'admin') document.getElementById('nav-admin').style.display = 'block';
    }
}

function cerrarSesion() {
    localStorage.clear();
    location.reload();
}

function abrirModal(id) { new bootstrap.Modal(document.getElementById(id)).show(); }
function abrirPublicar() { 
    if(!localStorage.getItem('token')) { abrirModal('modalLogin'); return; }
    abrirModal('modalPublicar'); 
}
function abrirValoracion() { 
    if(!localStorage.getItem('token')) { abrirModal('modalLogin'); return; }
    abrirModal('modalValoracion'); 
}

function mostrarToast(msg, tipo) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast-msg ${tipo}`;
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

async function actualizarEstadisticas() {
    const res = await fetch(`${API_URL}/stats`);
    const s = await res.json();
    document.getElementById('stat-usuarios').innerText = s.usuarios + "+";
    document.getElementById('stat-empleos').innerText = s.empleos;
    document.getElementById('stat-postulaciones').innerText = s.solicitudes;
    // También para admin
    if (document.getElementById('admin-usuarios')) {
        document.getElementById('admin-usuarios').innerText = s.usuarios;
        document.getElementById('admin-empleos').innerText = s.empleos;
        document.getElementById('admin-postulaciones').innerText = s.solicitudes;
    }
}

function mostrarPerfil() {
    ocultarTodo();
    document.getElementById('vista-perfil').classList.remove('d-none');
    const user = JSON.parse(localStorage.getItem('user'));
    document.getElementById('perfil-nombre').innerText = user.nombre;
    document.getElementById('perfil-email').innerText = user.email;
    document.getElementById('perfil-avatar').innerText = user.nombre[0].toUpperCase();
    initChart();
}

function initAdminCharts() {
    const ctxB = document.getElementById('chartBarras').getContext('2d');
    new Chart(ctxB, { type: 'bar', data: { labels: ['Ene','Feb','Mar','Abr'], datasets: [{ label: 'Registros', data: [15,25,20,35], backgroundColor: '#4f6ef7', borderRadius: 8 }] } });
    const ctxP = document.getElementById('chartPastel').getContext('2d');
    new Chart(ctxP, { type: 'doughnut', data: { labels: ['Ingeniería','Ventas','Diseño'], datasets: [{ data: [60,25,15], backgroundColor: ['#4f6ef7','#06d6c7','#1e40af'], borderWidth: 0 }] }, options: { cutout: '70%' } });
}

function initChart() {
    const ctx = document.getElementById('chartPerfil').getContext('2d');
    new Chart(ctx, { type: 'line', data: { labels: ['Lun','Mar','Mie','Jue','Vie'], datasets: [{ label: 'Visitas', data: [10,25,15,40,30], borderColor: '#4f6ef7', tension: 0.4, fill: true, backgroundColor: 'rgba(79,110,247,0.1)' }] } });
}