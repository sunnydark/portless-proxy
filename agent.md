# Portless — Internal Notes

## What This Is

An npm package that runs a local reverse proxy for dev services. Users access services via `<name>.localhost` subdomains instead of tracking port numbers. Framework-agnostic — works with Node.js, .NET, Python, Go, or anything that can bind to a port.

## Architecture

```
Browser -> http://api.localhost:8080 -> proxy.mjs (:8080) -> user's service (:4xxx)
           http://web.localhost:8080 ----^                    user's service (:4xxx)
```

With namespaces (parallel branches):

```
Branch A: http://api.localhost:8001 -> proxy.mjs (:8001) -> service (:4xxx)
Branch B: http://api.localhost:8002 -> proxy.mjs (:8002) -> service (:4xxx)
```

## Files

- **proxy.mjs** — HTTP reverse proxy (`http-proxy`). Routes by subdomain. Supports WebSocket upgrades. Dynamic `/_register`, `/_unregister`, `/_routes` API. Accepts optional namespace arg for parallel environments.
- **run.mjs** — Service launcher. Picks a free port (4000–4999) via `get-port`, registers with the proxy, spawns the user's command, and unregisters on exit. Supports `--ns` for namespaces. Injects `PORTLESS_URL_*` env vars for service discovery.
- **portless.json** — User-created config. Maps service names to their command, working directory, and env vars. Also configures proxy ports.
- **.portless/** — Runtime directory for namespace port files (auto-created, auto-cleaned).

## Config Format (portless.json)

```json
{
  "proxyPort": 8080,
  "proxyPortRange": [8001, 8099],
  "services": {
    "<name>": {
      "cwd": "<path relative to portless.json>",
      "command": "<shell command to start the service>",
      "env": {
        "<ENV_VAR>": "{port}",
        "<ENV_VAR>": "{proxyPort}",
        "<ENV_VAR>": "{name}"
      }
    }
  }
}
```

`env` defaults to `{ "PORT": "{port}" }` if omitted.

## CLI

```bash
portless-proxy [namespace]                  # start proxy
portless [--ns <namespace>] <service|all>   # start services
portless [--ns <namespace>] list            # show active services
portless init                               # create template portless.json
```

## Key Details

- **Runtime:** Node.js, ESM modules (`"type": "module"`)
- **Dependencies:** `get-port`, `http-proxy`
- **Port range:** 4000–4999 for services, 8080 for default proxy, 8001–8099 for namespaced proxies
- **Config location:** `portless.json` in the current working directory
- **Service discovery:** `PORTLESS_URL_<NAME>` env vars injected into all services
- **Graceful shutdown:** SIGINT/SIGTERM kills child processes and unregisters from proxy

## Internal API (proxy.mjs)

On `localhost` / `127.0.0.1` only:

- `POST /_register` — `{ "name": "api", "port": 4001 }` — add a route
- `POST /_unregister` — `{ "name": "api" }` — remove a route
- `GET /_routes` — returns JSON map of all active routes
