require("dotenv").config();

const express    = require("express");
const mysql      = require("mysql2");
const cors       = require("cors");
const multer     = require("multer");
const cloudinary = require("cloudinary").v2;
const fs         = require("fs");

const app    = express();
const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

/* ════════════════════════════════════════════
   CLOUDINARY
════════════════════════════════════════════ */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key:    process.env.CLOUDINARY_KEY,
  api_secret: process.env.CLOUDINARY_SECRET
});

/* ════════════════════════════════════════════
   MYSQL — CleverCloud
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
   SQL DE CREACIÓN DE TABLAS
   (ejecutar 1 vez en tu base de datos)

   CREATE TABLE IF NOT EXISTS operadores (
     id     INT AUTO_INCREMENT PRIMARY KEY,
     nombre VARCHAR(150),
     email  VARCHAR(150),
     UNIQUE KEY uniq_email (email)
   );

   CREATE TABLE IF NOT EXISTS cooperativas (
     id                  INT AUTO_INCREMENT PRIMARY KEY,
     nombre_coop         VARCHAR(200) NOT NULL,
     matricula           VARCHAR(100),
     cuit                VARCHAR(20),
     direccion           VARCHAR(250),
     tipo                VARCHAR(150),
     estado              VARCHAR(50),
     referente_nombre    VARCHAR(150),
     referente_tel       VARCHAR(50),
     referente_email     VARCHAR(150),
     cantidad_asociados  INT,
     rubro               VARCHAR(200),
     observaciones       TEXT,
     lat                 DECIMAL(10,7),
     lng                 DECIMAL(10,7),
     foto                TEXT,
     fecha               VARCHAR(50),
     operador_id         INT,
     FOREIGN KEY (operador_id) REFERENCES operadores(id)
   );

════════════════════════════════════════════ */


/* ════════════════════════════════════════════
   HELPER: asegurar que el operador existe
════════════════════════════════════════════ */
function asegurarOperador(nombre, email, callback) {
  const sql = `
    INSERT INTO operadores (nombre, email)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE nombre = VALUES(nombre)
  `;
  db.query(sql, [nombre, email], (err, result) => {
    if (err) return callback(err);

    // Si hubo INSERT real, insertId tiene el nuevo id
    if (result.insertId) return callback(null, result.insertId);

    // Si fue UPDATE (ON DUPLICATE), buscamos el id existente
    db.query("SELECT id FROM operadores WHERE email = ?", [email], (err2, rows) => {
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
app.post("/guardar-cooperativa", upload.single("foto"), async (req, res) => {
  try {
    const data = req.body;

    const fecha = new Date().toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires"
    });

    // ── Subir foto a Cloudinary ──────────────────
    let fotoUrl = null;
    if (req.file) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: "cooperativas",
          transformation: [
            { width: 1600, height: 1600, crop: "limit" },
            { quality: "auto" }
          ]
        });
        fotoUrl = result.secure_url;
        fs.unlinkSync(req.file.path);
      } catch (err) {
        console.log("❌ ERROR CLOUDINARY:", err);
      }
    }

    // ── Asegurar operador y luego insertar ───────
    asegurarOperador(data.operador_nombre, data.operador_email, (err, operador_id) => {
      if (err) { console.log("❌ ERROR OPERADOR:", err); return res.status(500).send("Error DB"); }

      const sql = `
        INSERT INTO cooperativas
          (nombre_coop, matricula, cuit, direccion, tipo, estado,
           referente_nombre, referente_tel, referente_email,
           cantidad_asociados, rubro, observaciones,
           lat, lng, foto, fecha, operador_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      db.query(sql, [
        data.nombre_coop,
        data.matricula         || null,
        data.cuit              || null,
        data.direccion         || null,
        data.tipo              || null,
        data.estado            || null,
        data.referente_nombre  || null,
        data.referente_tel     || null,
        data.referente_email   || null,
        data.cantidad_asociados ? parseInt(data.cantidad_asociados) : null,
        data.rubro             || null,
        data.observaciones     || null,
        parseFloat(data.lat),
        parseFloat(data.lng),
        fotoUrl,
        fecha,
        operador_id
      ], (err2) => {
        if (err2) { console.log("❌ DB ERROR COOP:", err2); return res.status(500).send("Error DB"); }
        console.log("✅ Cooperativa guardada:", data.nombre_coop);
        res.send("OK");
      });
    });

  } catch (e) {
    console.log("❌ ERROR GENERAL:", e);
    res.status(500).send("Error servidor");
  }
});

/* ════════════════════════════════════════════
   GET /cooperativas  (panel de administración)
════════════════════════════════════════════ */
app.get("/cooperativas", (req, res) => {
  const sql = `
    SELECT c.*, o.nombre AS operador_nombre
    FROM cooperativas c
    LEFT JOIN operadores o ON c.operador_id = o.id
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
    FROM cooperativas c
    LEFT JOIN operadores o ON c.operador_id = o.id
    WHERE c.id = ?
  `;
  db.query(sql, [req.params.id], (err, results) => {
    if (err) { console.log("❌ ERROR GET COOP ID:", err); return res.status(500).send("Error DB"); }
    if (results.length === 0) return res.status(404).send("No encontrado");
    res.json(results[0]);
  });
});

/* ════════════════════════════════════════════
   GET /operadores  (lista de operadores)
════════════════════════════════════════════ */
app.get("/operadores", (req, res) => {
  db.query("SELECT * FROM operadores ORDER BY id DESC", (err, results) => {
    if (err) { console.log("❌ ERROR GET OPS:", err); return res.status(500).send("Error DB"); }
    res.json(results);
  });
});

/* ════════════════════════════════════════════
   GET /health  (para monitoreo en Render)
════════════════════════════════════════════ */
app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

/* ════════════════════════════════════════════
   SERVER
════════════════════════════════════════════ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 API Cooperativas corriendo en puerto ${PORT}`));
