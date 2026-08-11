const express = require('express');
const { Pool } = require('pg');
const cron = require('node-cron');

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon.tech')
    ? { rejectUnauthorized: false }
    : false
});

// Add a new site to monitor
app.post('/sites', async (req, res) => {
  const { url, name } = req.body;
  const result = await pool.query(
    'INSERT INTO sites (url, name) VALUES ($1, $2) RETURNING *',
    [url, name]
  );
  res.json(result.rows[0]);
});

// Get all sites with their latest check
app.get('/sites', async (req, res) => {
  const result = await pool.query('SELECT * FROM sites ORDER BY id');
  res.json(result.rows);
});

// Get check history for one site
app.get('/sites/:id/checks', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM checks WHERE site_id = $1 ORDER BY checked_at DESC LIMIT 50',
    [req.params.id]
  );
  res.json(result.rows);
});

// The actual check logic
async function checkUrlOnce(url) {
  const start = Date.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const responseTime = Date.now() - start;
  return { statusCode: response.status, responseTime, isUp: response.ok };
}

async function checkSite(site) {
  const maxRetries = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await checkUrlOnce(site.url);
      await pool.query(
        'INSERT INTO checks (site_id, status_code, response_time_ms, is_up) VALUES ($1, $2, $3, $4)',
        [site.id, result.statusCode, result.responseTime, result.isUp]
      );
      console.log(`Checked ${site.name}: ${result.statusCode} (${result.responseTime}ms)${attempt > 1 ? ` [succeeded on retry ${attempt}]` : ''}`);
      return; // success — stop here, don't retry further
    } catch (err) {
      lastError = err;
      console.log(`Checked ${site.name}: attempt ${attempt} failed (${err.message})`);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // wait 2s before retrying
      }
    }
  }

  // Only reaches here if ALL attempts failed
  await pool.query(
    'INSERT INTO checks (site_id, status_code, response_time_ms, is_up) VALUES ($1, $2, $3, $4)',
    [site.id, 0, 0, false]
  );
  console.log(`Checked ${site.name}: FAILED after ${maxRetries} attempts (${lastError.message})`);
}

// Run checks every 2 minutes
cron.schedule('*/2 * * * *', async () => {
  const { rows: sites } = await pool.query('SELECT * FROM sites');
  for (const site of sites) {
    await checkSite(site);
  }
});

app.listen(6000, '0.0.0.0', () => console.log('Monitor service running on port 6000'));
