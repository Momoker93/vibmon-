require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initDB } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Demasiados intentos.' } }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 300 }));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', require('./routes/api'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Error interno' });
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`⚡ VIBMON running on port ${PORT}`);
    console.log(`   Admin: ${process.env.ADMIN_USER || 'admin'} / ${process.env.ADMIN_PASS || 'vibmon2024'}`);
  });
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
