# Portless Proxy

Local dev reverse proxy — access your services via `<name>.localhost` subdomains instead of tracking port numbers.

```
http://api.localhost:8080  ->  your api server on some random port
http://web.localhost:8080  ->  your web server on some random port
http://admin.localhost:8080  ->  your admin server on some random port
```

Inspired by [Vercel's portless](https://github.com/vercel-labs/portless) project.

## Install

```bash
npm install -g portless-proxy
```

Or use with `npx`:

```bash
npx portless-proxy
npx portless api
```

## Quick Start

**1. Create a config file** in your project root:

```bash
portless init
```

This creates `portless.json`:

```json
{
  "proxyPort": 8080,
  "proxyPortRange": [8001, 8099],
  "services": {
    "web": {
      "cwd": "./packages/web",
      "command": "npm start",
      "env": { "PORT": "{port}" }
    },
    "api": {
      "cwd": "./packages/api",
      "command": "npm start",
      "env": { "PORT": "{port}" }
    }
  }
}
```

Edit it to match your project.

**2. Start the proxy:**

```bash
portless-proxy
```

**3. Start services** in another terminal:

```bash
portless api          # start one service
portless all          # start all services
```

**4. Open your browser:**

```
http://api.localhost:8080
http://web.localhost:8080
```

## Configuration

`portless.json` in your project root:

| Field | Default | Description |
|-------|---------|-------------|
| `proxyPort` | `8080` | Port for the default (non-namespaced) proxy |
| `proxyPortRange` | `[8001, 8099]` | Port range for namespaced proxies |
| `services` | — | Map of service name to service config |

### Service config

Each service entry:

| Field | Default | Description |
|-------|---------|-------------|
| `cwd` | — | Working directory for the service (relative to `portless.json`) |
| `command` | — | Shell command to start the service |
| `env` | `{ "PORT": "{port}" }` | Environment variables to set. Supports placeholders. |

### Placeholders

Use these in `env` values:

| Placeholder | Replaced with |
|-------------|---------------|
| `{port}` | The auto-assigned port for this service |
| `{proxyPort}` | The proxy port (useful for constructing URLs) |
| `{name}` | The service name |

### Examples

**Node.js services:**

```json
{
  "services": {
    "api": {
      "cwd": "./services/api",
      "command": "npm start",
      "env": { "PORT": "{port}" }
    }
  }
}
```

**ASP.NET services:**

```json
{
  "services": {
    "api": {
      "cwd": "./src/MyApp.Api",
      "command": "dotnet run --no-launch-profile",
      "env": {
        "ASPNETCORE_URLS": "http://localhost:{port}",
        "ASPNETCORE_ENVIRONMENT": "Development"
      }
    }
  }
}
```

**Python / Flask:**

```json
{
  "services": {
    "api": {
      "cwd": "./backend",
      "command": "flask run",
      "env": {
        "FLASK_RUN_PORT": "{port}",
        "FLASK_ENV": "development"
      }
    }
  }
}
```

## Namespaces — Run Multiple Branches in Parallel

Namespaces let you run multiple isolated environments side-by-side. Each namespace gets its own proxy on its own port, so two branches of the same service don't collide.

```bash
# Terminal group A — working on bug-123
portless-proxy bug-123                  # auto-picks a port, e.g. 8001
portless --ns bug-123 api              # starts api behind that proxy

# Terminal group B — working on feat-456
portless-proxy feat-456                 # auto-picks a port, e.g. 8002
portless --ns feat-456 api             # starts api behind this proxy

# Access in browser
# http://api.localhost:8001   (bug-123)
# http://api.localhost:8002   (feat-456)
```

Each namespace:

- Gets its own proxy on an auto-assigned port from `proxyPortRange`
- Writes a port file to `.portless/<namespace>.json` so `portless` can discover it
- Cleans up on shutdown

List services for a specific namespace:

```bash
portless --ns bug-123 list
```

## Service Discovery

When launching a service, portless injects environment variables for every service defined in your config:

```
PORTLESS_URL_API=http://api.localhost:8080
PORTLESS_URL_WEB=http://web.localhost:8080
```

Pattern: `PORTLESS_URL_<UPPERCASED_NAME>`. These include the correct proxy port, so inter-service calls work in both default and namespaced modes.

Your services can read these to call each other without hardcoding URLs.

## CLI Reference

### `portless-proxy [namespace]`

Start the reverse proxy.

- Without `namespace`: binds to `proxyPort` (default 8080)
- With `namespace`: auto-picks a port from `proxyPortRange`, writes `.portless/<namespace>.json`

### `portless [--ns <namespace>] <service|all>`

Start one or all services.

- `--ns <namespace>`: target a namespaced proxy instead of the default

### `portless [--ns <namespace>] list`

Show active services and their routes.

### `portless init`

Create a template `portless.json` in the current directory.

## How It Works

```
Browser  ->  http://api.localhost:8080  ->  proxy (:8080)  ->  your service (:4xxx)
             http://web.localhost:8080  ----^                   your service (:4xxx)
```

1. **`portless-proxy`** starts an HTTP reverse proxy that routes requests by subdomain
2. **`portless <name>`** picks a free port (4000–4999), registers with the proxy via an internal API, then spawns your service command with the port injected via env vars
3. The proxy forwards `api.localhost` traffic to whichever port the `api` service registered on
4. On shutdown, services unregister and child processes are killed

The proxy exposes these internal endpoints on `localhost` / `127.0.0.1`:

- `POST /_register` — `{ "name": "api", "port": 4001 }`
- `POST /_unregister` — `{ "name": "api" }`
- `GET /_routes` — returns JSON map of active routes

WebSocket connections are supported and proxied automatically.

## License

MIT
