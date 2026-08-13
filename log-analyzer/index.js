const express = require('express');
const { Pool } = require('pg');
const fs = require('fs');
const readline = require('readline');

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon.tech')
    ? { rejectUnauthorized: false }
    : false
});

const LOG_PATH = '/var/log/nginx/access.log';
let lastReadPosition = 0;

const logLineRegex = /^(\S+) - - \[.*?\] "(\S+) (\S+) [^"]*" (\d+) (\d+) "[^"]*" "([^"]*)"/;

function maskIp(ip) {
  if (!ip) return 'unknown';
  if (ip.includes(':')) {
    // IPv6 — keep first 3 groups, mask the rest
    const parts = ip.split(':');
    return parts.slice(0, 3).join(':') + ':xxxx';
  }
  // IPv4 — keep first 3 octets, mask the last
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
  }
  return 'unknown';
}

async function parseNewLogLines() {
  try {
    if (!fs.existsSync(LOG_PATH)) {
      console.log('Log file not found yet, waiting...');
      return;
    }

    const stats = fs.statSync(LOG_PATH);
    if (stats.size === 0) {
      return;
    }
    if (stats.size < lastReadPosition) {
      lastReadPosition = 0;
    }
    if (stats.size === lastReadPosition) {
      return;
    }

    const fileHandle = fs.readFileSync(LOG_PATH, 'utf-8');
    const newContent = fileHandle.slice(lastReadPosition);
    const lines = newContent.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const match = line.match(logLineRegex);
      if (match) {
        const [, ip, method, path, status, size, userAgent] = match;
        await pool.query(
          'INSERT INTO log_entries (ip_address, method, path, status_code, response_size, user_agent) VALUES ($1, $2, $3, $4, $5, $6)',
          [maskIp(ip), method, path, parseInt(status), parseInt(size), userAgent]
        );
      }
    }

    lastReadPosition = stats.size;
  } catch (err) {
    console.error('Error parsing log file:', err.message);
  }
}

setInterval(parseNewLogLines, 30000);
parseNewLogLines();

app.get('/', async (req, res) => {
  const result = await pool.query('SELECT * FROM log_entries ORDER BY logged_at DESC LIMIT 100');
  res.json(result.rows);
});

app.get('/top-ips', async (req, res) => {
  const result = await pool.query(
    `SELECT ip_address, COUNT(*) as request_count 
     FROM log_entries 
     GROUP BY ip_address 
     ORDER BY request_count DESC 
     LIMIT 10`
  );
  res.json(result.rows);
});

app.get('/status-summary', async (req, res) => {
  const result = await pool.query(
    `SELECT status_code, COUNT(*) as count 
     FROM log_entries 
     GROUP BY status_code 
     ORDER BY status_code`
  );
  res.json(result.rows);
});

app.post('/ingest', async (req, res) => {
  const { ip, method, path, statusCode, userAgent } = req.body;
  try {
    await pool.query(
      'INSERT INTO log_entries (ip_address, method, path, status_code, response_size, user_agent) VALUES ($1, $2, $3, $4, $5, $6)',
      [maskIp(ip), method, path, statusCode, 0, userAgent || '']
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Ingest error:', err.message);
    res.status(500).json({ ok: false });
  }
});

app.listen(7000, '0.0.0.0', () => console.log('Log analyzer running on port 7000'));