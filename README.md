# VGE LiteLLM Connector

Thin HTTP adapter that integrates [LiteLLM Proxy](https://docs.litellm.ai/) with [Vigil Guard Enterprise](https://github.com/vigilguard/enterprise). It translates LiteLLM's `generic_guardrail_api` payloads into Vigil Guard `POST /v1/guard/analyze` requests and maps decisions back to LiteLLM guardrail actions.

```
Client
  |
  v
LiteLLM Proxy (OpenAI-compatible)
  |
  +--> Guardrail call (generic_guardrail_api)
          |
          v
      VGE LiteLLM Connector         <-- this service
          |
          +--> POST /v1/guard/analyze (Vigil Guard)
          |
          +--> map decision -> LiteLLM action
  |
  +--> if allowed: route to model provider
  |
  v
Client response
```

## Quick Start

### With local Vigil Guard stack

```bash
cp .env.example .env
# Edit .env: set VIGIL_API_KEY to your Vigil Guard API key

docker compose up -d
```

The adapter joins VGE's `vigil-public` network and reaches the API at `http://api:8787`.

### Standalone (remote Vigil Guard)

```bash
VIGIL_API_URL=https://your-vigil-api.example.com \
VIGIL_API_KEY=vg_live_your_key \
docker compose -f docker-compose.yml -f docker-compose.standalone.yml up -d
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VIGIL_API_URL` | Yes | - | Vigil Guard API base URL |
| `VIGIL_API_KEY` | Yes | - | API key (Bearer token) |
| `ADAPTER_PORT` | No | `8081` | Listen port |
| `VIGIL_TIMEOUT_MS` | No | `3000` | Per-call timeout to Vigil (ms) |
| `ADAPTER_FAIL_MODE` | No | `closed` | `closed` = block on error, `open` = allow |
| `LOG_LEVEL` | No | `info` | pino log level |

## LiteLLM Configuration

Add to your `litellm_config.yaml`:

```yaml
litellm_settings:
  guardrails:
    - guardrail_name: vigil-guard
      litellm_params:
        guardrail: generic_guardrail_api
        mode: [pre_call, post_call]
        api_base: http://vigil-litellm-adapter:8081
        default_on: true
```

See [litellm-config.yaml](litellm-config.yaml) for a full example.

## Decision Mapping

| Vigil Guard | LiteLLM | Behavior |
|-------------|---------|----------|
| `ALLOWED` | `NONE` | Request proceeds unchanged |
| `BLOCKED` | `BLOCKED` | Request rejected with reason |
| `SANITIZED` | `GUARDRAIL_INTERVENED` | Request proceeds with modified text |

## Development

```bash
pnpm install
pnpm dev          # Start with hot reload (requires VIGIL_API_URL and VIGIL_API_KEY)
pnpm test         # Run unit + integration tests
pnpm typecheck    # TypeScript check
pnpm build        # Compile to dist/
```

## Fail Mode

**Closed (default)**: When Vigil Guard is unavailable, the adapter blocks all requests. Use in production for security.

**Open**: When Vigil Guard is unavailable, the adapter allows all requests through. Use only in development or non-critical environments.

Set via `ADAPTER_FAIL_MODE=open` or `ADAPTER_FAIL_MODE=closed`.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/beta/litellm_basic_guardrail_api` | POST | Main guardrail endpoint (called by LiteLLM) |
| `/health/live` | GET | Liveness probe |
| `/health/ready` | GET | Readiness probe (checks Vigil connectivity) |
| `/metrics` | GET | Prometheus metrics |

## Troubleshooting

**Adapter returns BLOCKED for everything**: Check `VIGIL_API_URL` and `VIGIL_API_KEY`. Verify Vigil Guard is reachable from the adapter container. Check `/health/ready` endpoint.

**LiteLLM doesn't call the adapter**: Verify `guardrail: generic_guardrail_api` and `api_base` in LiteLLM config. Ensure `default_on: true` is set.

**High latency**: Reduce `VIGIL_TIMEOUT_MS`. Check Vigil Guard API performance. The adapter adds 1 retry with jitter on transient failures, so worst case is ~2x the timeout.

## License

MIT
