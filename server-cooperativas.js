require("dotenv").config();

const express = require("express");
const mysql   = require("mysql2");
const cors    = require("cors");
const multer  = require("multer");
const upload  = multer();

const app = express();

app.use(cors());
app.use(express.json());

/* ════════════════════════════════════════════
   MYSQL
════════════════════════════════════════════ */
const db = mysql.createPool({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port:     process.env.DB_PORT || 3306
});

db.getConnection((err, conn) => {
  if (err) console.log("❌ ERROR MYSQL:", err);
  else { console.log("✅ MYSQL OK"); conn.release(); }
});

/* ════════════════════════════════════════════
   HELPER: asegurar que el operador existe
════════════════════════════════════════════ */
function asegurarOperador(nombre, email, callback) {
  const sql = `
    INSERT INTO coop_operadores (nombre, email)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE nombre = VALUES(nombre)
  `;
  db.query(sql, [nombre, email], (err, result) => {
    if (err) return callback(err);
    if (result.insertId) return callback(null, result.insertId);
    db.query("SELECT id FROM coop_operadores WHERE email = ?", [email], (err2, rows) => {
      if (err2) return callback(err2);
      callback(null, rows[0].id);
    });
  });
}

/* ════════════════════════════════════════════
   POST /registrar-operador
════════════════════════════════════════════ */
app.post("/registrar-operador", (req, res) => {
  const { nombre, email } = req.body;
  asegurarOperador(nombre, email, (err) => {
    if (err) { console.log("❌ ERROR OPERADOR:", err); return res.status(500).send("Error DB"); }
    res.send("OK");
  });
});

/* ════════════════════════════════════════════
   POST /guardar-cooperativa
════════════════════════════════════════════ */
app.post("/guardar-cooperativa", upload.none(), (req, res) => {
  const data = req.body;

  const fecha = new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires"
  });

  asegurarOperador(data.operador_nombre, data.operador_email, (err, operador_id) => {
    if (err) { console.log("❌ ERROR OPERADOR:", err); return res.status(500).send("Error DB"); }

    const sql = `
      INSERT INTO coop_datos
        (nombre_coop, matricula_provincial, matricula_nacional, cuit, direccion,
         codigo_postal, departamento, localidad, tipo, estado,
         referente_nombre, referente_tel, referente_email,
         cantidad_asociados, observaciones, foto_url,
         lat, lng, fecha, operador_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [
      data.nombre_coop,
      data.matricula_provincial  || null,
      data.matricula_nacional    || null,
      data.cuit                  || null,
      data.direccion             || null,
      data.codigo_postal         || null,
      data.departamento          || null,
      data.localidad             || null,
      data.tipo                  || null,
      data.estado                || null,
      data.referente_nombre      || null,
      data.referente_tel         || null,
      data.referente_email       || null,
      data.cantidad_asociados ? parseInt(data.cantidad_asociados) : null,
      data.observaciones         || null,
      data.foto_url              || null,
      parseFloat(data.lat),
      parseFloat(data.lng),
      fecha,
      operador_id
    ], (err2) => {
      if (err2) { console.log("❌ DB ERROR COOP:", err2); return res.status(500).send("Error DB"); }
      console.log("✅ Cooperativa guardada:", data.nombre_coop);
      res.send("OK");
    });
  });
});

/* ════════════════════════════════════════════
   GET /cooperativas  (panel de administración)
════════════════════════════════════════════ */
app.get("/cooperativas", (req, res) => {
  const sql = `
    SELECT c.*, o.nombre AS operador_nombre
    FROM coop_datos c
    LEFT JOIN coop_operadores o ON c.operador_id = o.id
    ORDER BY c.id DESC
  `;
  db.query(sql, (err, results) => {
    if (err) { console.log("❌ ERROR GET COOPS:", err); return res.status(500).send("Error DB"); }
    res.json(results);
  });
});

/* ════════════════════════════════════════════
   GET /cooperativas/:id  (detalle)
════════════════════════════════════════════ */
app.get("/cooperativas/:id", (req, res) => {
  const sql = `
    SELECT c.*, o.nombre AS operador_nombre
    FROM coop_datos c
    LEFT JOIN coop_operadores o ON c.operador_id = o.id
    WHERE c.id = ?
  `;
  db.query(sql, [req.params.id], (err, results) => {
    if (err) { console.log("❌ ERROR GET COOP ID:", err); return res.status(500).send("Error DB"); }
    if (results.length === 0) return res.status(404).send("No encontrado");
    res.json(results[0]);
  });
});

/* ════════════════════════════════════════════
   PUT /cooperativas/:id  (editar)
════════════════════════════════════════════ */
app.put("/cooperativas/:id", (req, res) => {
  const data = req.body;
  const sql = `
    UPDATE coop_datos SET
      nombre_coop = ?, matricula_provincial = ?, matricula_nacional = ?,
      cuit = ?, direccion = ?, codigo_postal = ?, departamento = ?, localidad = ?,
      tipo = ?, estado = ?, referente_nombre = ?, referente_tel = ?,
      referente_email = ?, cantidad_asociados = ?, observaciones = ?
    WHERE id = ?
  `;
  db.query(sql, [
    data.nombre_coop,
    data.matricula_provincial || null, data.matricula_nacional || null,
    data.cuit || null, data.direccion || null,
    data.codigo_postal || null, data.departamento || null, data.localidad || null,
    data.tipo || null, data.estado || null,
    data.referente_nombre || null, data.referente_tel || null,
    data.referente_email || null,
    data.cantidad_asociados ? parseInt(data.cantidad_asociados) : null,
    data.observaciones || null,
    req.params.id
  ], (err) => {
    if (err) { console.log("❌ ERROR PUT COOP:", err); return res.status(500).send("Error DB"); }
    res.send("OK");
  });
});

/* ════════════════════════════════════════════
   DELETE /cooperativas/:id  (eliminar)
════════════════════════════════════════════ */
app.delete("/cooperativas/:id", (req, res) => {
  db.query("DELETE FROM coop_datos WHERE id = ?", [req.params.id], (err) => {
    if (err) { console.log("❌ ERROR DELETE COOP:", err); return res.status(500).send("Error DB"); }
    res.send("OK");
  });
});

/* ════════════════════════════════════════════
   GET /operadores
════════════════════════════════════════════ */
app.get("/operadores", (req, res) => {
  db.query("SELECT * FROM coop_operadores ORDER BY id DESC", (err, results) => {
    if (err) { console.log("❌ ERROR GET OPS:", err); return res.status(500).send("Error DB"); }
    res.json(results);
  });
});

/* ════════════════════════════════════════════
   GET /health
════════════════════════════════════════════ */
app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

/* ════════════════════════════════════════════
   SERVER
════════════════════════════════════════════ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 API Cooperativas corriendo en puerto ${PORT}`));
