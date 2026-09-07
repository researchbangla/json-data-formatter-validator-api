const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Security: standard HTTP headers
app.use(helmet());
// Explicitly disable x-powered-by (helmet already does this, but be explicit)
app.disable('x-powered-by');

// Rate limiting: 100 requests per 15 minutes per IP, skip health and root
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  // Do not apply rate limiting to health or root endpoints
  skip: (req) => req.path === '/health' || req.path === '/',
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        message: 'Too many requests, please try again later.'
      }
    });
  }
});
// Apply the rate limiter globally (with skip above to preserve health)
app.use(limiter);

// Parse JSON bodies up to 1 MB
app.use(express.json({ limit: '1mb' }));

// Body parser error handler (must come after express.json)
app.use((err, req, res, next) => {
  if (!err) return next();
  // Payload too large
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ success: false, error: { message: 'Payload too large' } });
  }
  // Syntax error in JSON
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, error: { message: 'Invalid JSON payload' } });
  }
  // Pass through other errors
  return next(err);
});

// Root - API info/status
app.get('/', (req, res) => {
  res.json({
    name: 'JSON Data Formatter & Validator API',
    version: '0.1.0',
    endpoints: {
      health: '/health (GET)',
      format: '/api/format (POST)',
      validate: '/api/validate (POST)',
      minify: '/api/minify (POST)'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Helper: normalize input - accept either { json: "..." } or { data: ... }
function normalizeInput(body) {
  if (!body || typeof body !== 'object') return { error: 'Request body must be a JSON object' };
  if (body.data !== undefined) return { type: 'data', value: body.data };
  if (body.json !== undefined) {
    if (typeof body.json === 'string') return { type: 'string', raw: body.json };
    // Already-parsed object/primitive in json field
    return { type: 'data', value: body.json };
  }
  return { error: 'Request must include either "json" (string) or "data" (object/value) in the body' };
}

// POST /api/format - pretty-print JSON (default indent 2)
app.post('/api/format', (req, res) => {
  const input = normalizeInput(req.body);
  if (input.error) return res.status(400).json({ success: false, error: { message: input.error } });

  try {
    const value = input.type === 'data' ? input.value : JSON.parse(input.raw);
    const formatted = JSON.stringify(value, null, 2);
    return res.json({ success: true, operation: 'format', data: formatted });
  } catch (err) {
    // Keep response generic for security
    return res.status(400).json({ success: false, error: { message: 'Invalid JSON input' } });
  }
});

// POST /api/minify - compact JSON
app.post('/api/minify', (req, res) => {
  const input = normalizeInput(req.body);
  if (input.error) return res.status(400).json({ success: false, error: { message: input.error } });

  try {
    const value = input.type === 'data' ? input.value : JSON.parse(input.raw);
    const minified = JSON.stringify(value);
    return res.json({ success: true, operation: 'minify', data: minified });
  } catch (err) {
    // Keep response generic for security
    return res.status(400).json({ success: false, error: { message: 'Invalid JSON input' } });
  }
});

// POST /api/validate - returns whether JSON is valid and helpful error when invalid
app.post('/api/validate', (req, res) => {
  const input = normalizeInput(req.body);
  if (input.error) return res.status(400).json({ success: false, error: { message: input.error } });

  if (input.type === 'data') {
    // Already a parsed value
    return res.json({ success: true, operation: 'validate', valid: true });
  }

  try {
    JSON.parse(input.raw);
    return res.json({ success: true, operation: 'validate', valid: true });
  } catch (err) {
    const message = err && err.message ? err.message : 'Invalid JSON';
    // Position extraction is engine-specific; leave null when not available
    return res.json({ success: true, operation: 'validate', valid: false, error: { message, position: null } });
  }
});

// POST /api/transform/json-to-csv - convert an array of objects to CSV
app.post('/api/transform/json-to-csv', (req, res) => {
  const input = normalizeInput(req.body);
  if (input.error) return res.status(400).json({ success: false, error: { message: input.error } });

  let arr;
  try {
    const value = input.type === 'data' ? input.value : JSON.parse(input.raw);
    if (!Array.isArray(value)) {
      return res.status(400).json({ success: false, error: { message: 'Input must be a JSON array of objects' } });
    }
    arr = value;
  } catch (err) {
    return res.status(400).json({ success: false, error: { message: 'Invalid JSON input' } });
  }

  // Validate that each element is a plain object
  for (let i = 0; i < arr.length; i++) {
    const el = arr[i];
    if (el === null || typeof el !== 'object' || Array.isArray(el)) {
      return res.status(400).json({ success: false, error: { message: `Array element at index ${i} is not an object` } });
    }
  }

  // Collect headers in order encountered across objects
  const headers = [];
  const seen = new Set();
  for (const obj of arr) {
    for (const key of Object.keys(obj)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }

  // CSV escape according to RFC4180: double quotes are escaped by doubling, and fields
  // containing commas, quotes, or CR/LF are enclosed in double quotes.
  function csvEscape(val) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') {
      try { val = JSON.stringify(val); } catch (e) { val = String(val); }
    } else {
      val = String(val);
    }
    const mustQuote = /[",\r\n,]/.test(val);
    // escape double quotes by doubling
    val = val.replace(/"/g, '""');
    return mustQuote ? `"${val}"` : val;
  }

  // Build CSV lines: header row then each object row
  const csvLines = [];
  csvLines.push(headers.map(csvEscape).join(','));
  for (const obj of arr) {
    const row = headers.map(h => csvEscape(obj[h] === undefined ? '' : obj[h]));
    csvLines.push(row.join(','));
  }
  const csv = csvLines.join('\r\n');

  return res.json({ success: true, operation: 'json-to-csv', data: csv });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: { message: 'Not Found' } });
});

// Global error handler
app.use((err, req, res, next) => {
  // Log minimally
  // Do not leak stack traces in responses
  console.error('Unhandled error:', err && err.message ? err.message : err);
  res.status(500).json({ success: false, error: { message: 'Internal Server Error' } });
});

// Start server if run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`JSON Data Formatter & Validator API listening on port ${PORT}`);
  });
}

module.exports = app;
