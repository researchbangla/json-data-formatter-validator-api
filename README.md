# JSON Data Formatter & Validator API

Minimal Node/Express service for formatting, validating, and minifying JSON.

Prerequisites
- Node.js 16+ recommended

Setup
1. Install dependencies:
   npm install

2. Start:
   npm start

The server listens on PORT environment variable or 3000 by default.

Endpoints
- GET /
  - Returns basic API information and available endpoints.

- GET /health
  - Health check. Example response:
    { "status": "ok", "uptime": 123.45 }

- POST /api/format
  - Request body: either { "json": "{\"a\":1}" } (string) or { "data": { "a": 1 } } (object)
  - Response: { "success": true, "operation": "format", "data": "<formatted JSON string>" }
  - HTTP 400 when input missing or invalid.

- POST /api/minify
  - Same input shapes; returns compact JSON string.
  - Response: { "success": true, "operation": "minify", "data": "<minified JSON string>" }

- POST /api/validate
  - Same input shapes.
  - Response when valid:
    { "success": true, "operation": "validate", "valid": true }
  - Response when invalid:
    { "success": true, "operation": "validate", "valid": false, "error": { "message": "..." } }

Request examples
- Format:
  POST /api/format
  Body: { "json": "{\"name\":\"John\",\"age\":30}" }
  Response: { "success": true, "operation": "format", "data": "{\n  \"name\": \"John\",\n  \"age\": 30\n}" }

Notes
- Payload size limit: 1 MB.
- No authentication, database, or external services are used.
- This is a minimal foundation intended for further expansion.
