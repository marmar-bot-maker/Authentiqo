require('dotenv').config();

if (!process.env.JWT_SECRET) {
  console.error('Missing JWT_SECRET in your .env file. Copy .env.example to .env and set one before starting the server.');
  process.exit(1);
}

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const deviceRoutes = require('./routes/devices');
const repairRoutes = require('./routes/repairs');
const buyerRoutes = require('./routes/buyer');
const statsRoutes = require('./routes/stats');
const repairShopProfileRoutes = require('./routes/repairShopProfile');

const app = express();
const PORT = process.env.PORT || 3000;

// Render (and most hosts) sit behind a reverse proxy, so every request arrives
// with an X-Forwarded-For header. Without this, express-rate-limit can't
// safely tell which IP is the real client and throws on every request to a
// rate-limited route.
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false, // keep simple for the bundled static frontend; tighten if you add a CDN
}));
app.use(cors());
app.use(express.json());

// Basic rate limiting on auth endpoints to slow down credential stuffing / brute force
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });
app.use('/api/auth', authLimiter);

// ---- API routes ----
app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/repairs', repairRoutes);
app.use('/api/device-lookup', buyerRoutes); // public buyer verification lookup
app.use('/api/stats', statsRoutes); // public homepage statistics
app.use('/api/repair-companies', repairShopProfileRoutes); // public repair shop profiles

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ---- Static frontend ----
app.use(express.static(path.join(__dirname, 'public')));

// Pretty URL /device/:serialNumber serves the buyer results page (the frontend JS
// reads the serial number out of the URL and calls /api/device-lookup/:serialNumber)
app.get('/device/:serialNumber', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'device.html'));
});

app.get('/repair-shop/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'repair-shop-profile.html'));
});

// Fallback to homepage for any unmatched non-API route
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Authentiqo server running at http://localhost:${PORT}`);
});
