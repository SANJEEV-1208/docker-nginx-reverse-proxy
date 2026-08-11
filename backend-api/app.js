const express = require('express');
const app = express();
const PORT = 5000;

const LOG_ANALYZER_URL = process.env.LOG_ANALYZER_URL;

app.use((req, res, next) => {
  res.on('finish', () => {
    if (!LOG_ANALYZER_URL) return;
    fetch(`${LOG_ANALYZER_URL}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ip: req.ip,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        userAgent: req.headers['user-agent']
      })
    }).catch(() => {});
  });
  next();
});

app.get('/api/status', (req, res) => {
  res.json({
    status: "running",
    message: "You are a genius Claude!",
    time: new Date().toISOString()
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`);
});