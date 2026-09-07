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
    const mustQuote = /[\",\r\n,]/.test(val);
    // escape double quotes by doubling
    val = val.replace(/\"/g, '\"\"');
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

// POST /api/transform/csv-to-json - convert CSV string to array of objects
app.post('/api/transform/csv-to-json', (req, res) => {
  // Expecting { "csv": "..." }
  if (!req.body || typeof req.body !== 'object' || typeof req.body.csv !== 'string') {
    return res.status(400).json({ success: false, error: { message: 'Request body must be JSON with a "csv" string field' } });
  }
  let csv = req.body.csv;
  // Remove UTF-8 BOM if present
  if (csv.charCodeAt(0) === 0xFEFF) csv = csv.slice(1);

  // Small CSV parser that handles quoted fields, doubled quotes, commas inside quotes, and CRLF/LF
  function parseCSVToArray(input) {
    const rows = [];
    let cur = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    while (i < input.length) {
      const ch = input[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < input.length && input[i + 1] === '"') {
            // Escaped quote
            field += '"';
            i += 2;
            continue;
          }
          // Closing quote
          inQuotes = false;
          i++;
          continue;
        }
        // Regular char within quotes (including newlines)
        field += ch;
        i++;
        continue;
      }

      // Not in quotes
      if (ch === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (ch === ',') {
        cur.push(field);
        field = '';
        i++;
        continue;
      }
      if (ch === '\r') {
        // CR or CRLF
        if (i + 1 < input.length && input[i + 1] === '\n') i++;
        cur.push(field);
        field = '';
        rows.push(cur);
        cur = [];
        i++;
        continue;
      }
      if (ch === '\n') {
        cur.push(field);
        field = '';
        rows.push(cur);
        cur = [];
        i++;
        continue;
      }
      // Regular char
      field += ch;
      i++;
    }
    if (inQuotes) throw new Error('Malformed CSV: unmatched quote');
    // push last field
    if (field !== '' || cur.length > 0) {
      cur.push(field);
      rows.push(cur);
    }
    return rows;
  }

  try {
    const arr = parseCSVToArray(csv);
    if (arr.length === 0) return res.json({ success: true, operation: 'csv-to-json', data: [] });
    const headers = arr[0].map(h => h);
    const data = arr.slice(1).map((row, idx) => {
      if (row.length > headers.length) {
        throw new Error(`Row ${idx + 2} has more fields than header (${row.length} > ${headers.length})`);
      }
      const padded = row.concat(Array(Math.max(0, headers.length - row.length)).fill(''));
      const obj = {};
      for (let i = 0; i < headers.length; i++) {
        obj[headers[i]] = padded[i];
      }
      return obj;
    });
    return res.json({ success: true, operation: 'csv-to-json', data });
  } catch (err) {
    return res.status(400).json({ success: false, error: { message: err && err.message ? err.message : 'Malformed CSV' } });
  }
});

// POST /api/transform/json-to-yaml - convert JSON to YAML
app.post('/api/transform/json-to-yaml', (req, res) => {
  const input = normalizeInput(req.body);
  if (input.error) return res.status(400).json({ success: false, error: { message: input.error } });

  let value;
  try {
    value = input.type === 'data' ? input.value : JSON.parse(input.raw);
  } catch (err) {
    return res.status(400).json({ success: false, error: { message: 'Invalid JSON input' } });
  }

  // Only accept objects or arrays at top-level
  if (value === null || (typeof value !== 'object')) {
    return res.status(400).json({ success: false, error: { message: 'Input must be a JSON object or array' } });
  }

  // Simple YAML serializer without external deps.
  function isSimpleKey(key) {
    return /^[A-Za-z0-9_-]+$/.test(key);
  }

  function toYAML(val, indentLevel) {
    const indent = '  '.repeat(indentLevel);
    // null
    if (val === null) return 'null';
    const t = typeof val;
    if (t === 'boolean') return val ? 'true' : 'false';
    if (t === 'number') return String(val);
    if (t === 'string') {
      // Use JSON.stringify to produce a safely escaped double-quoted string
      return JSON.stringify(val);
    }
    if (Array.isArray(val)) {
      if (val.length === 0) return '[]';
      const lines = [];
      for (const item of val) {
        if (item === null || typeof item !== 'object') {
          // primitive - put on same line
          lines.push(indent + '- ' + toYAML(item, 0));
        } else {
          // object or array - nested block
          lines.push(indent + '- ' + '\n' + toYAML(item, indentLevel + 1));
        }
      }
      return lines.join('\n');
    }
    // object
    const keys = Object.keys(val);
    if (keys.length === 0) return '{}';
    const lines = [];
    for (const key of keys) {
      const safeKey = isSimpleKey(key) ? key : JSON.stringify(key);
      const v = val[key];
      if (v === null || typeof v !== 'object') {
        lines.push(indent + safeKey + ': ' + toYAML(v, 0));
      } else {
        // object or array
        lines.push(indent + safeKey + ':');
        lines.push(toYAML(v, indentLevel + 1));
      }
    }
    // Ensure nested blocks have proper indentation
    return lines.join('\n');
  }

  try {
    const yaml = toYAML(value, 0);
    return res.json({ success: true, operation: 'json-to-yaml', data: yaml });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to convert JSON to YAML' } });
  }
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
