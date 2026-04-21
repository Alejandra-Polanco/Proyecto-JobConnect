// =============================================
//  JobConnect — server.js  VERSIÓN FINAL
// =============================================
require('dotenv').config();

const express  = require('express');
const { Pool } = require('pg');
const cors     = require('cors');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

const app         = express();
const PORT        = process.env.PORT || 3000;
const JWT_SECRET  = process.env.JWT_SECRET || 'jobconnect_dev_secret_2025';
const SALT_ROUNDS = 10;

// ─── CARPETAS DE UPLOADS ──────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ─── MULTER — subida de CV PDF/DOCX ──────────
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext  = path.extname(file.originalname).toLowerCase();
        const name = `CV-${req.user.id_usuario}-${Date.now()}${ext}`;
        cb(null, name);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.pdf' && ext !== '.docx')
            return cb(new Error('Solo se permiten archivos PDF o DOCX'));
        cb(null, true);
    }
});

// ─── MULTER para postulación (sin auth en multer, se valida luego) ─
const storagePost = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
        const ext  = path.extname(file.originalname).toLowerCase();
        cb(null, `POST-${Date.now()}${ext}`);
    }
});
const uploadPost = multer({
    storage: storagePost,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.pdf' && ext !== '.docx') return cb(new Error('Solo PDF o DOCX'));
        cb(null, true);
    }
});

// ─── MIDDLEWARES ──────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(UPLOADS_DIR));

app.use((req, _res, next) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
    next();
});

// ─── POSTGRES ─────────────────────────────────
const pool = new Pool({
    user:     process.env.DB_USER     || 'postgres',
    host:     process.env.DB_HOST     || 'localhost',
    database: process.env.DB_NAME     || 'jobconnect_db',
    password: process.env.DB_PASSWORD,
    port:     Number(process.env.DB_PORT) || 5432,
});
pool.connect(err => {
    if (err) return console.error('❌ Error PostgreSQL:', err.message);
    console.log('✅ PostgreSQL conectado');
});

async function q(sql, params = []) {
    const client = await pool.connect();
    try   { return await client.query(sql, params); }
    finally { client.release(); }
}

// ─── JWT middleware ───────────────────────────
function verificarToken(req, res, next) {
    const header = req.headers['authorization'];
    const token  = header && header.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token requerido' });
    try { req.user = jwt.verify(token, JWT_SECRET); next(); }
    catch { return res.status(403).json({ error: 'Token inválido o expirado' }); }
}

function soloAdmin(req, res, next) {
    if (req.user?.rol !== 'admin')
        return res.status(403).json({ error: 'Solo administradores' });
    next();
}

function validar(campos, body) {
    for (const [key, rules] of Object.entries(campos)) {
        const val = body[key];
        if (rules.required && (val === undefined || val === null || String(val).trim() === ''))
            return `El campo '${key}' es obligatorio`;
        if (val && rules.min && String(val).length < rules.min)
            return `'${key}' debe tener al menos ${rules.min} caracteres`;
        if (val && rules.max && String(val).length > rules.max)
            return `'${key}' no puede superar ${rules.max} caracteres`;
        if (val && rules.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val))
            return `'${key}' debe ser un email válido`;
        if (val && rules.number && isNaN(Number(val)))
            return `'${key}' debe ser un número`;
    }
    return null;
}

// ══════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════

app.post('/api/registro', async (req, res) => {
    const { nombre, email, password } = req.body;
    const error = validar({
        nombre:   { required: true, min: 3, max: 60 },
        email:    { required: true, email: true },
        password: { required: true, min: 6 }
    }, req.body);
    if (error) return res.status(400).json({ success: false, message: error });

    try {
        const existe = await q('SELECT id_usuario FROM usuarios WHERE email = $1', [email.trim().toLowerCase()]);
        if (existe.rows.length > 0)
            return res.status(409).json({ success: false, message: 'Este correo ya está registrado' });

        const hash   = await bcrypt.hash(password, SALT_ROUNDS);
        const result = await q(
            `INSERT INTO usuarios (nombre, email, password, rol) VALUES ($1,$2,$3,'candidato')
             RETURNING id_usuario, nombre, email, rol`,
            [nombre.trim(), email.trim().toLowerCase(), hash]
        );
        const user  = result.rows[0];
        const token = jwt.sign({ id_usuario: user.id_usuario, email: user.email, rol: user.rol }, JWT_SECRET, { expiresIn: '7d' });
        console.log(`👤 Nuevo usuario: ${user.email}`);
        res.status(201).json({ success: true, user: { ...user, token } });
    } catch (err) {
        console.error('Error registro:', err.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ success: false, message: 'Email y contraseña requeridos' });

    try {
        const result = await q(
            'SELECT id_usuario, nombre, email, password, rol, cv_url FROM usuarios WHERE email = $1',
            [email.trim().toLowerCase()]
        );
        if (!result.rows.length)
            return res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos' });

        const user = result.rows[0];
        const ok   = await bcrypt.compare(password, user.password);
        if (!ok) return res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos' });

        const token = jwt.sign({ id_usuario: user.id_usuario, email: user.email, rol: user.rol }, JWT_SECRET, { expiresIn: '7d' });
        const { password: _, ...userSinPass } = user;
        res.json({ success: true, user: { ...userSinPass, token } });
    } catch (err) {
        console.error('Error login:', err.message);
        res.status(500).json({ success: false, message: 'Error interno' });
    }
});

// ══════════════════════════════════════════════
//  VACANTES
// ══════════════════════════════════════════════

app.get('/api/vacantes/buscar', async (req, res) => {
    const texto = (req.query.q || '').trim();
    try {
        const result = await q(
            `SELECT * FROM vacantes WHERE (titulo ILIKE $1 OR ubicacion ILIKE $1 OR descripcion ILIKE $1) AND estado='Activa' ORDER BY id_vacante DESC`,
            [`%${texto}%`]
        );
        res.json(result.rows);
    } catch { res.status(500).json({ error: 'Error en búsqueda' }); }
});

app.get('/api/vacantes', async (req, res) => {
    try {
        const result = await q(`SELECT * FROM vacantes WHERE estado='Activa' ORDER BY id_vacante DESC`);
        res.json(result.rows);
    } catch { res.status(500).json({ error: 'Error al obtener vacantes' }); }
});

app.get('/api/vacantes/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
    try {
        const result = await q('SELECT * FROM vacantes WHERE id_vacante=$1', [id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Vacante no encontrada' });
        res.json(result.rows[0]);
    } catch { res.status(500).json({ error: 'Error al obtener vacante' }); }
});

app.post('/api/vacantes', verificarToken, async (req, res) => {
    const error = validar({ titulo: { required: true, min: 3 }, ubicacion: { required: true }, salario: { required: true, number: true } }, req.body);
    if (error) return res.status(400).json({ error });
    const { titulo, ubicacion, salario, modalidad, descripcion } = req.body;
    try {
        const result = await q(
            `INSERT INTO vacantes (titulo, empresa_id, ubicacion, salario, modalidad, descripcion, estado) VALUES ($1,$2,$3,$4,$5,$6,'Activa') RETURNING *`,
            [titulo, req.user.id_usuario, ubicacion, Number(salario), modalidad || 'Presencial', descripcion || '']
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error vacante:', err.message);
        res.status(500).json({ error: 'Error al publicar vacante' });
    }
});

// ══════════════════════════════════════════════
//  POSTULACIONES — con formulario completo + CV adjunto
// ══════════════════════════════════════════════

// Postular con formulario (nombre, apellido, tel, correo, dirección + CV opcional)
app.post('/api/postulaciones', verificarToken, uploadPost.single('cv_adjunto'), async (req, res) => {
    const id_candidato = req.user.id_usuario;
    const { id_vacante, nombres, apellidos, telefono, correo_contacto, direccion } = req.body;

    if (!id_vacante)          return res.status(400).json({ error: 'id_vacante requerido' });
    if (!nombres?.trim())     return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!apellidos?.trim())   return res.status(400).json({ error: 'El apellido es obligatorio' });
    if (!telefono?.trim())    return res.status(400).json({ error: 'El teléfono es obligatorio' });
    if (!correo_contacto?.trim()) return res.status(400).json({ error: 'El correo de contacto es obligatorio' });

    try {
        // Verificar duplicado
        const existe = await q('SELECT id FROM postulaciones WHERE id_vacante=$1 AND id_candidato=$2', [id_vacante, id_candidato]);
        if (existe.rows.length > 0)
            return res.status(409).json({ error: 'Ya te postulaste a esta vacante anteriormente' });

        // Si subió un nuevo CV, actualizar perfil también
        let cv_filename = req.file ? req.file.filename : null;
        if (cv_filename) {
            await q('UPDATE usuarios SET cv_url=$1 WHERE id_usuario=$2', [cv_filename, id_candidato]);
        }

        // Si no subió CV, intentar usar el del perfil
        if (!cv_filename) {
            const u = await q('SELECT cv_url FROM usuarios WHERE id_usuario=$1', [id_candidato]);
            cv_filename = u.rows[0]?.cv_url || null;
        }

        await q(
            `INSERT INTO postulaciones (id_vacante, id_candidato, nombres, apellidos, telefono, correo_contacto, direccion, cv_adjunto)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [id_vacante, id_candidato, nombres.trim(), apellidos.trim(), telefono.trim(), correo_contacto.trim(), (direccion || '').trim(), cv_filename]
        );
        res.status(201).json({ mensaje: 'Postulación enviada exitosamente' });
    } catch (err) {
        console.error('Error postulación:', err.message);
        res.status(500).json({ error: 'Error al registrar postulación' });
    }
});

// Mis postulaciones
app.get('/api/postulaciones/mias', verificarToken, async (req, res) => {
    try {
        const result = await q(
            `SELECT p.id, p.fecha_postulacion, p.nombres, p.apellidos, p.telefono, p.correo_contacto, p.cv_adjunto,
                    v.titulo, v.ubicacion, v.salario, v.modalidad
             FROM postulaciones p
             JOIN vacantes v ON p.id_vacante = v.id_vacante
             WHERE p.id_candidato = $1
             ORDER BY p.fecha_postulacion DESC`,
            [req.user.id_usuario]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener postulaciones' });
    }
});

// ══════════════════════════════════════════════
//  CV — Subir desde perfil
// ══════════════════════════════════════════════

app.post('/api/usuarios/subir-cv', verificarToken, upload.single('cv'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    try {
        await q('UPDATE usuarios SET cv_url=$1 WHERE id_usuario=$2', [req.file.filename, req.user.id_usuario]);
        res.json({ success: true, mensaje: 'CV guardado correctamente', archivo: req.file.filename });
    } catch { res.status(500).json({ error: 'Error al guardar el CV' }); }
});

app.get('/api/usuarios/yo', verificarToken, async (req, res) => {
    try {
        const result = await q('SELECT id_usuario, nombre, email, rol, cv_url FROM usuarios WHERE id_usuario=$1', [req.user.id_usuario]);
        if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(result.rows[0]);
    } catch { res.status(500).json({ error: 'Error al obtener perfil' }); }
});

// ══════════════════════════════════════════════
//  VALORACIONES
// ══════════════════════════════════════════════

app.get('/api/valoraciones', async (req, res) => {
    try {
        const result = await q(
            `SELECT v.id_valoracion, v.empresa_nombre, v.puntuacion, v.comentario, v.fecha_valoracion, u.nombre AS usuario_nombre
             FROM valoraciones v JOIN usuarios u ON v.id_usuario = u.id_usuario ORDER BY v.fecha_valoracion DESC`
        );
        res.json(result.rows);
    } catch { res.status(500).json({ error: 'Error al obtener valoraciones' }); }
});

app.post('/api/valoraciones', verificarToken, async (req, res) => {
    const { empresa_nombre, puntuacion, comentario } = req.body;
    const pts = parseInt(puntuacion);
    if (!empresa_nombre) return res.status(400).json({ success: false, message: 'Nombre de empresa requerido' });
    if (isNaN(pts) || pts < 1 || pts > 5) return res.status(400).json({ success: false, message: 'Puntuación entre 1 y 5' });
    try {
        const result = await q(
            `INSERT INTO valoraciones (id_usuario, empresa_nombre, puntuacion, comentario) VALUES ($1,$2,$3,$4) RETURNING *`,
            [req.user.id_usuario, empresa_nombre.trim(), pts, (comentario || '').trim()]
        );
        res.status(201).json({ success: true, valoracion: result.rows[0] });
    } catch { res.status(500).json({ success: false, message: 'Error al guardar valoración' }); }
});

// ══════════════════════════════════════════════
//  ESTADÍSTICAS
// ══════════════════════════════════════════════

app.get('/api/stats', async (req, res) => {
    try {
        const [v, p, u] = await Promise.all([
            q(`SELECT COUNT(*) FROM vacantes WHERE estado='Activa'`),
            q('SELECT COUNT(*) FROM postulaciones'),
            q('SELECT COUNT(*) FROM usuarios')
        ]);
        res.json({ empleos: Number(v.rows[0].count), solicitudes: Number(p.rows[0].count), usuarios: Number(u.rows[0].count) });
    } catch { res.status(500).json({ error: 'Error en estadísticas' }); }
});

app.get('/api/stats/historico', verificarToken, soloAdmin, async (req, res) => {
    try {
        const reg = await q(`SELECT TO_CHAR(DATE_TRUNC('month', created_at),'Mon') AS mes, COUNT(*) AS total FROM usuarios WHERE created_at >= NOW() - INTERVAL '6 months' GROUP BY DATE_TRUNC('month', created_at) ORDER BY DATE_TRUNC('month', created_at)`);
        const cat = await q(`SELECT modalidad, COUNT(*) AS total FROM vacantes WHERE estado='Activa' GROUP BY modalidad`);
        res.json({ registros: reg.rows, categorias: cat.rows });
    } catch {
        res.json({
            registros:  [{ mes:'Ene',total:8 },{ mes:'Feb',total:15 },{ mes:'Mar',total:12 },{ mes:'Abr',total:22 },{ mes:'May',total:18 },{ mes:'Jun',total:30 }],
            categorias: [{ modalidad:'Presencial',total:45 },{ modalidad:'Remoto',total:30 },{ modalidad:'Hibrido',total:25 }]
        });
    }
});

// ─── Error handler multer ─────────────────────
app.use((err, _req, res, _next) => {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'El archivo no puede superar 5 MB' });
    if (err.message)                    return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Error interno' });
});

app.listen(PORT, () => {
    console.log(`\n🚀 JobConnect en: http://localhost:${PORT}`);
    console.log(`   Modo: ${process.env.NODE_ENV || 'desarrollo'}\n`);
});