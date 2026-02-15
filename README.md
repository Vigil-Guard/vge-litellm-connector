# VGE LiteLLM Connector

HTTP adapter between [LiteLLM Proxy](https://docs.litellm.ai/) and [Vigil Guard Enterprise](https://github.com/vigilguard/enterprise).  
It translates LiteLLM `generic_guardrail_api` payloads to Vigil Guard `POST /v1/guard/analyze`, then maps Vigil decisions back to LiteLLM actions.

```
LiteLLM -> Adapter -> Vigil Guard API (/v1/guard/analyze)
```

## Deployment Model

This service supports both deployment patterns:

1. Single-host Docker setup: LiteLLM + Adapter on the same Docker host/network.
2. Distributed setup: LiteLLM, Adapter, and VGE on separate hosts / separate Docker environments.

Important:

1. Adapter does not need to be in the same Docker network as VGE.
2. Adapter calls VGE using official HTTPS API (`https://...:443`).
3. For distributed deployment, only network reachability is required (no shared Docker network).

## Requirements

1. Node.js `>=24` for local development.
2. A reachable Vigil Guard API endpoint.
3. Valid Vigil Guard API key.
4. LiteLLM configured with `generic_guardrail_api`.

## Security Requirements

1. Use `https://` for `VIGIL_API_URL` in production.
2. Protect adapter ingress so only trusted LiteLLM instances can call it.
3. Use `ADAPTER_INBOUND_BEARER_TOKEN` when exposing adapter outside a private internal network.
4. Keep `ADAPTER_FAIL_MODE=closed` in production.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VIGIL_API_URL` | Yes | - | Vigil Guard API base URL. Production must be `https://...` |
| `VIGIL_API_KEY` | Yes | - | Bearer token used by adapter when calling Vigil |
| `ADAPTER_PORT` | No | `8081` | Adapter listen port |
| `VIGIL_TIMEOUT_MS` | No | `3000` | Per-call timeout to Vigil |
| `ADAPTER_FAIL_MODE` | No | `closed` | `closed` blocks on backend failure, `open` allows |
| `ADAPTER_INBOUND_BEARER_TOKEN` | No | - | If set, adapter requires `Authorization: Bearer <token>` on inbound requests |
| `LOG_LEVEL` | No | `info` | Fastify/Pino log level |
| `VIGIL_ALLOW_INSECURE_HTTP` | No | `false` | Development/testing override to allow `http://` Vigil URL |

## Quick Start (Single Host Docker)

`docker-compose.yml` is a reference setup for one Docker host.

```bash
cp .env.example .env
# edit at minimum:
# VIGIL_API_URL=https://your-vigil-api.example.com
# VIGIL_API_KEY=vg_live_...

docker compose up -d
```

Notes:

1. Adapter is exposed only inside the compose network (`expose`, not host `ports`).
2. LiteLLM calls adapter by internal DNS name `vigil-litellm-adapter:8081`.

## Distributed Setup (Separate Hosts / Separate Docker)

If LiteLLM and Adapter run on different hosts:

1. Publish adapter through controlled ingress (LB/reverse proxy/firewall).
2. Restrict source access to LiteLLM host ranges.
3. Enable `ADAPTER_INBOUND_BEARER_TOKEN` or enforce equivalent auth at ingress.
4. Set LiteLLM `api_base` to reachable adapter URL.
5. Keep adapter egress access to VGE API over `443`.

If VGE runs on another host, adapter still calls only the official API endpoint (`/v1/guard/analyze`) over HTTPS.

## LiteLLM Configuration

Example (`litellm-config.yaml`):

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

See `litellm-config.yaml` in this repository for a full local example.

## Decision Mapping

| Vigil Guard | LiteLLM | Behavior |
|-------------|---------|----------|
| `ALLOWED` | `NONE` | Request proceeds unchanged |
| `BLOCKED` | `BLOCKED` | Request rejected with reason |
| `SANITIZED` | `GUARDRAIL_INTERVENED` | Request proceeds with transformed `texts[]` |

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/beta/litellm_basic_guardrail_api` | POST | Main adapter endpoint used by LiteLLM |
| `/health/live` | GET | Liveness |
| `/health/ready` | GET | Readiness based on recent Vigil connectivity (`ok`, `degraded`, `unknown`) |
| `/metrics` | GET | Prometheus metrics |

## Metrics

In addition to standard Fastify/HTTP metrics, adapter exports:

1. `vge_guardrail_adapter_decisions_total`
2. `vge_guardrail_adapter_backend_errors_total`
3. `vge_guardrail_adapter_vigil_request_duration_seconds`

## Testing and Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm dev
```

## Troubleshooting

1. Adapter returns `BLOCKED` for most requests: check `VIGIL_API_URL`, `VIGIL_API_KEY`, timeout, and `/health/ready`.
2. LiteLLM cannot call adapter: verify network path + `api_base` + firewall/ingress rules.
3. `401 Unauthorized` from adapter: set matching `Authorization: Bearer` token or disable inbound token check.
4. Startup readiness is `unknown`: adapter has not completed any Vigil calls yet.

## License

MIT
