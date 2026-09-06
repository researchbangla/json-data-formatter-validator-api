# JSON Data Formatter & Validator API

Minimal, lightweight Node/Express API for formatting, validating, and minifying JSON.

This service provides a small set of JSON utilities via HTTP endpoints:

- Format / beautify JSON (pretty-print)
- Minify JSON (compact string)
- Validate JSON strings/values
- Health check and root information

Production Base URL
- https://json-data-formatter-validator-api.onrender.com

Local development
- When running locally use: http://localhost:3000 (or set PORT)

Main features
- Accepts either a JSON string (`json` field) or an already-parsed value (`data` field).
- Returns consistent JSON responses with success/error payloads.
- Enforces a 1 MB request body size limit.
- Rate limiting: 100 requests per 15 minutes per IP. The root (`/`) and health (`/health`) endpoints are excluded from rate limiting so probes and uptime checks are not throttled.
- Standard security headers are enabled via Helmet.

Available endpoints
- GET /  
  - Description: API information (name, version, available endpoints)  
  - Response: 200 application/json

- GET /health  
  - Description: Health check; returns { status: 'ok', uptime: <seconds> }  
  - Response: 200 application/json

- POST /api/format  
  - Description: Format / beautify JSON with 2-space indentation  
  - Request body: application/json — object with either:
    - `json`: string containing JSON text (e.g. '{"a":1}') OR
    - `data`: already-parsed JSON value (object, array, primitive, or null)
  - Success response: 200 application/json — { success: true, operation: 'format', data: "<pretty JSON string>" }
  - Error responses: 400 Bad Request (missing/invalid input), 413 Payload Too Large (exceeds 1 MB)

- POST /api/minify  
  - Description: Return compact/minified JSON string  
  - Request body: same shape as /api/format  
  - Success response: 200 application/json — { success: true, operation: 'minify', data: "<minified JSON string>" }  
  - Error responses: 400, 413

- POST /api/validate  
  - Description: Validate JSON content — accepts `json` (string) or `data` (parsed)  
  - Request body: same shape as /api/format  
  - Success response: 200 application/json — { success: true, operation: 'validate', valid: true }  
  - If parse fails: 200 application/json — { success: true, operation: 'validate', valid: false, error: { message: "<parser message>", position: null } }
    - Note: The current implementation intentionally returns HTTP 200 for validation results whether valid or invalid — inspect the `valid` field to determine validity.
  - Error response: 400 Bad Request (missing or malformed request body)

Request format
- Content-Type: application/json
- Body must be a JSON object
- Provide either `json` (string) or `data` (value)
  - Example JSON string body: { "json": "{\"name\":\"John\",\"age\":30}" }
  - Example data body: { "data": { "name": "John", "age": 30 } }

Examples (production)

1) Format (curl)
- Request:
  curl -s -X POST "https://json-data-formatter-validator-api.onrender.com/api/format" \
    -H "Content-Type: application/json" \
    -d '{"json":"{\"name\":\"John\",\"age\":30}"}'

- Example success response (200):
  {
    "success": true,
    "operation": "format",
    "data": "{\n  \"name\": \"John\",\n  \"age\": 30\n}"
  }

2) Minify (curl)
- Request:
  curl -s -X POST "https://json-data-formatter-validator-api.onrender.com/api/minify" \
    -H "Content-Type: application/json" \
    -d '{"data":{"a":1,"b":[1,2,3]}}'

- Example success response (200):
  {
    "success": true,
    "operation": "minify",
    "data": "{\"a\":1,\"b\":[1,2,3]}"
  }

3) Validate (curl)
- Valid JSON:
  curl -s -X POST "https://json-data-formatter-validator-api.onrender.com/api/validate" \
    -H "Content-Type: application/json" \
    -d '{"json":"{\"x\":1}"}'

  Response (200):
  {
    "success": true,
    "operation": "validate",
    "valid": true
  }

- Invalid JSON:
  curl -s -X POST "https://json-data-formatter-validator-api.onrender.com/api/validate" \
    -H "Content-Type: application/json" \
    -d '{"json":"{x:1,"}'

  Response (200):
  {
    "success": true,
    "operation": "validate",
    "valid": false,
    "error": {
      "message": "Unexpected token x in JSON at position 1",
      "position": null
    }
  }

Local development examples
- For local development and testing use http://localhost:3000 in the curl/fetch examples above.

Error responses (examples)
- Missing body or wrong shape (400):
  {
    "success": false,
    "error": {
      "message": "Request must include either \"json\" (string) or \"data\" (object/value) in the body"
    }
  }

- Invalid JSON parse (400) for format/minify:
  {
    "success": false,
    "error": {
      "message": "Invalid JSON input"
    }
  }

- Payload too large (413):
  {
    "success": false,
    "error": { "message": "Payload too large" }
  }

HTTP status codes used by the API
- 200 OK — successful responses, including /api/validate results for both valid and invalid JSON strings
- 400 Bad Request — malformed HTTP request body or missing/invalid required request fields; for /api/format and /api/minify, an invalid JSON string inside the "json" field also returns 400
- 413 Payload Too Large — request body exceeds 1 MB
- 404 Not Found — unknown routes
- 429 Too Many Requests — rate limit exceeded
- 500 Internal Server Error — unexpected server error

Notes (explicit behavior)
- /api/validate with an invalid JSON string returns HTTP 200 with { "valid": false } and an error message (position may be null).
- A malformed HTTP request JSON body (invalid JSON or wrong shape) returns HTTP 400.

Content-Type requirements
- Request Content-Type must be `application/json` for POST endpoints.
- Responses are returned as `application/json`.

Example JavaScript (fetch) usage (production)
- Format example:
  const res = await fetch('https://json-data-formatter-validator-api.onrender.com/api/format', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: '{"name":"John","age":30}' })
  });
  const body = await res.json();
  console.log(body);

- Validate example:
  const res = await fetch('https://json-data-formatter-validator-api.onrender.com/api/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: '{x:1,' })
  });
  console.log(await res.json());

Detailed endpoint explanation (concise)
- GET / — Returns API name/version and lists available endpoints. Use for quick info.
- GET /health — Lightweight liveness check. Useful for load balancers or service monitors.
- POST /api/format — Pretty-prints JSON into a string; accepts `json` (string) or `data` (value). Default indentation: 2 spaces. Use when you need human-readable formatting.
- POST /api/minify — Produces compact stringified JSON. Use when you require compact transport or storage.
- POST /api/validate — Validates that a JSON string is parseable. Returns `valid: true` or `valid: false` plus an error message when invalid. Note: returns HTTP 200 in either case; inspect the `valid` field.

Link to OpenAPI specification
- The project includes an OpenAPI 3.0.3 specification at: `openapi.yaml` (root of the repository). The OpenAPI document reflects the current implementation and lists the production server URL.

Installation & local development
1. Requirements
   - Node.js (v16+ recommended)
   - npm

2. Install
   git clone <repo-url>
   cd json-data-formatter-validator-api
   npm install

3. Run locally
   PORT=3000 npm start
   - By default the server listens on process.env.PORT || 3000
   - Confirm endpoints with curl or inspect openapi.yaml

Testing
- There are no unit tests included in the current minimal project.
- Test manually with curl or fetch examples above.
- Example health check:
  curl https://json-data-formatter-validator-api.onrender.com/health

Limitations / important notes
- Payload limit: 1 MB enforced by the server.
- Rate limiting: 100 requests per 15 minutes per IP. The `/` and `/health` endpoints are excluded from rate limiting to support monitoring and probes.
- Standard security headers are enabled via Helmet.
- The `validate` endpoint returns HTTP 200 for invalid JSON parse attempts; check the `valid` property to detect invalid input.
- No authentication, database persistence, or premium features are implemented — the project is intentionally minimal.

Contributing & contact
- Contributions are welcome. Please open issues or PRs on the repository.
- For direct questions, use the repository issue tracker.

License
- MIT
