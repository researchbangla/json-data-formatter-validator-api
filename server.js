const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

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
    return res.status(400).json({ success: false, error: { message: 'Invalid JSON input', details: err.message } });
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
    return res.status(400).json({ success: false, error: { message: 'Invalid JSON input', details: err.message } });
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
