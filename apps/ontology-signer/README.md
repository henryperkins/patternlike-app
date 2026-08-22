# Ontology signer

This Worker has no public route. The API reaches its single `signOntology` RPC
method through the `ONTOLOGY_SIGNER` service binding. Cloudflare requires a
registered handler on the default entrypoint, so its `fetch` method always
returns an empty 404. `workers_dev` and preview URLs are disabled, and the
Worker declares no provider, corpus, D1, R2, queue, or other data binding.

`PATTERN_ONTOLOGY_SIGNING_KEY` is the Worker's only secret. Set it with
`wrangler secret put PATTERN_ONTOLOGY_SIGNING_KEY --env production`. Its value
is closed, versioned JSON:

```json
{
  "version": 1,
  "keys": {
    "ontology-key-2026": {
      "alg": "Ed25519",
      "private_key_pkcs8": "<unpadded base64url PKCS#8 bytes>"
    }
  }
}
```

The only accepted algorithms are `Ed25519` and `ES256`; `ES256` imports a P-256
PKCS#8 private key and emits the 64-byte WebCrypto/JWS `r||s` signature the API
verifier expects. Key ids use 1–128 characters from `[A-Za-z0-9._-]`, starting
alphanumeric. At most eight keys may coexist for rotation. Extra JSON fields,
padding or non-base64url key bytes, unsupported algorithms, empty keyrings, and
unimportable keys fail closed.

Canonical candidate payloads are capped at 256 KiB; larger requests fail closed
with `payload_too_large`.

Never place this secret in API configuration, `.dev.vars` outside this
workspace, logs, responses, D1, R2, corpus material, or provider requests.

## Deploy

The API's `ONTOLOGY_SIGNER` service binding fails upload until this Worker
exists. Deploy it first:

```bash
npm run deploy:signer
npx wrangler secret put PATTERN_ONTOLOGY_SIGNING_KEY \
  --config apps/ontology-signer/wrangler.toml --env production
```

Locally, resolve the binding by running both configs together from the
repository root:

```bash
npx wrangler dev -c apps/api/wrangler.toml -c apps/ontology-signer/wrangler.toml
```
