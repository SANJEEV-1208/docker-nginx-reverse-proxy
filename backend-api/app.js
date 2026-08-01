const express = require('express');
const app = express();
const PORT = 5000;

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
