require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'jobconnect_secret_default';
const SALT_ROUNDS = 10;

app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
    user:     process.env.DB_USER || 'postgres',
    host:     process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'jobconnect_db',
    password: process.env.DB_PASSWORD,
    port:     process.env.DB_PORT || 5432,
});

function verificarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token requerido' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (_) {
        return res.status(403).json({ error: 'Token inválido o expirado' });
    }
}

async function query(sql, params = []) {
    const client = await pool.connect();
    try {
        return await client.query(sql, params);
    } finally {
        client.release();
    }
}

app.post('/api/registro', async (req, res) => {
    const { nombre, email, password } = req.body;

    if (!nombre || !email || !password)
        return res.status(400).json({ success: false, message: 'Faltan campos obligatorios' });
    if (password.length < 6)
        return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 6 caracteres' });

    try {
        const existe = await query('SELECT id_usuario FROM usuarios WHERE email = $1', [email]);
        if (existe.rows.length > 0)
            return res.status(409).json({ success: false, message: 'Este correo ya está registrado' });

        const hash = await bcrypt.hash(password, SALT_ROUNDS);

        const resultado = await query(
            'INSERT INTO usuarios (nombre, email, password, rol) VALUES ($1, $2, $3, $4) RETURNING id_usuario, nombre, email, rol',
            [nombre, email, hash, 'candidato']
        );
        const user = resultado.rows[0];

        const token = jwt.sign(
            { id_usuario: user.id_usuario, email: user.email, rol: user.rol },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({ success: true, user: { ...user, token } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ success: false, message: 'Email y contraseña son requeridos' });

    try {
        const resultado = await query(
            'SELECT id_usuario, nombre, email, password, rol FROM usuarios WHERE email = $1',
            [email]
        );

        if (resultado.rows.length === 0)
            return res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos' });

        const user = resultado.rows[0];
        const coincide = await bcrypt.compare(password, user.password);
        if (!coincide)
            return res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos' });

        const token = jwt.sign(
            { id_usuario: user.id_usuario, email: user.email, rol: user.rol },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        const { password: _, ...userSinPass } = user;
        res.json({ success: true, user: { ...userSinPass, token } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

app.get('/api/vacantes/buscar', async (req, res) => {
    const { q = '' } = req.query;
    try {
        const resultado = await query(
            `SELECT * FROM vacantes WHERE (titulo ILIKE $1 OR ubicacion ILIKE $1) AND estado = 'Activa' ORDER BY id_vacante DESC`,
            [`%${q}%`]
        );
        res.json(resultado.rows);
    } catch (err) {
        res.status(500).json({ error: 'Error en la búsqueda' });
    }
});

app.get('/api/vacantes', async (req, res) => {
    try {
        const resultado = await query(
            `SELECT * FROM vacantes WHERE estado = 'Activa' ORDER BY id_vacante DESC`
        );
        res.json(resultado.rows);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener vacantes' });
    }
});

app.get('/api/vacantes/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    try {
        const resultado = await query('SELECT * FROM vacantes WHERE id_vacante = $1', [id]);
        if (resultado.rows.length === 0) return res.status(404).json({ error: 'Vacante no encontrada' });
        res.json(resultado.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener detalle' });
    }
});

app.post('/api/vacantes', verificarToken, async (req, res) => {
    const { titulo, ubicacion, salario, modalidad, descripcion } = req.body;

    if (!titulo || !ubicacion || !salario)
        return res.status(400).json({ error: 'Faltan campos obligatorios' });

    try {
        const resultado = await query(
            `INSERT INTO vacantes (titulo, empresa_id, ubicacion, salario, modalidad, descripcion, estado)
             VALUES ($1, $2, $3, $4, $5, $6, 'Activa') RETURNING *`,
            [titulo, req.user.id_usuario, ubicacion, Number(salario), modalidad || 'Presencial', descripcion || '']
        );
        res.status(201).json(resultado.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Error al publicar la vacante' });
    }
});

app.post('/api/postulaciones', verificarToken, async (req, res) => {
    const { id_vacante } = req.body;
    const id_candidato = req.user.id_usuario;

    if (!id_vacante) return res.status(400).json({ error: 'id_vacante es requerido' });

    try {
        const existe = await query(
            'SELECT id_postulacion FROM postulaciones WHERE id_vacante = $1 AND id_candidato = $2',
            [id_vacante, id_candidato]
        );
        if (existe.rows.length > 0)
            return res.status(409).json({ error: 'Ya te postulaste a esta vacante' });

        await query(
            'INSERT INTO postulaciones (id_vacante, id_candidato) VALUES ($1, $2)',
            [id_vacante, id_candidato]
        );
        res.status(201).json({ mensaje: 'Postulación enviada exitosamente' });
    } catch (err) {
        res.status(500).json({ error: 'Error al registrar postulación' });
    }
});

app.post('/api/valoraciones', verificarToken, async (req, res) => {
    const { empresa_nombre, puntuacion, comentario } = req.body;
    const id_usuario = req.user.id_usuario;

    if (!empresa_nombre || !puntuacion)
        return res.status(400).json({ success: false, message: 'Empresa y puntuación son requeridos' });

    const pts = parseInt(puntuacion);
    if (isNaN(pts) || pts < 1 || pts > 5)
        return res.status(400).json({ success: false, message: 'La puntuación debe ser entre 1 y 5' });

    try {
        const resultado = await query(
            'INSERT INTO valoraciones (id_usuario, empresa_nombre, puntuacion, comentario) VALUES ($1, $2, $3, $4) RETURNING *',
            [id_usuario, empresa_nombre, pts, comentario || '']
        );
        res.status(201).json({ success: true, valoracion: resultado.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al guardar valoración' });
    }
});

app.get('/api/valoraciones', async (req, res) => {
    try {
        const resultado = await query(`
            SELECT v.*, u.nombre as usuario_nombre
            FROM valoraciones v
            JOIN usuarios u ON v.id_usuario = u.id_usuario
            ORDER BY v.fecha_valoracion DESC
        `);
        res.json(resultado.rows);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener valoraciones' });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const [vCount, pCount, uCount] = await Promise.all([
            query('SELECT COUNT(*) FROM vacantes'),
            query('SELECT COUNT(*) FROM postulaciones'),
            query('SELECT COUNT(*) FROM usuarios')
        ]);
        res.json({
            usuarios: uCount.rows[0].count,
            empleos: vCount.rows[0].count,
            solicitudes: pCount.rows[0].count
        });
    } catch (err) {
        res.status(500).json({ error: 'Error en estadísticas' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 JobConnect listo en: http://localhost:${PORT}`);
});