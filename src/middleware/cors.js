import cors from "cors";

// Permissive by design: the API is a stateless, unauthenticated JSON service, so every
// origin is allowed. `origin: "*"` is a literal wildcard, which the Fetch spec forbids
// together with credentials — hence no `Access-Control-Allow-Credentials` header is sent.
// Mounted before the body parser so preflight OPTIONS requests short-circuit without
// being parsed, and so error responses from later middleware still carry CORS headers.
export const corsMiddleware = cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
});
