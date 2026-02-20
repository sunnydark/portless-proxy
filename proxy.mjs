#!/usr/bin/env node

import http from "node:http";
import httpProxy from "http-proxy";
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import getPort from "get-port";

const configPath = join(process.cwd(), "portless.json");
const config = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, "utf8"))
  : {};

const namespace = process.argv[2];
const portDir = join(process.cwd(), ".portless");

let PROXY_PORT;

if (namespace) {
  const [rangeStart, rangeEnd] = config.proxyPortRange || [8001, 8099];
  PROXY_PORT = await getPort({
    port: Array.from({ length: rangeEnd - rangeStart + 1 }, (_, i) => rangeStart + i),
  });
  mkdirSync(portDir, { recursive: true });
  writeFileSync(
    join(portDir, `${namespace}.json`),
    JSON.stringify({ port: PROXY_PORT, pid: process.pid })
  );
} else {
  PROXY_PORT = config.proxyPort || 80;
}

const serviceNames = config.services ? Object.keys(config.services) : [];

const routes = new Map();
const proxy = httpProxy.createProxyServer({ ws: true });

proxy.on("error", (err, req, res) => {
  if (!res.headersSent) {
    res.writeHead(502, { "Content-Type": "text/plain" });
  }
  res.end(`Proxy error: ${err.message}`);
});

const server = http.createServer((req, res) => {
  const host = req.headers.host?.replace(/:\d+$/, "");
  const name = host?.replace(/\.localhost$/, "");

  // Registration endpoint — called by run.mjs
  if (host === "localhost" || host === "127.0.0.1") {
    if (req.url === "/_register" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const { name: svcName, port } = JSON.parse(body);
        routes.set(svcName, `http://127.0.0.1:${port}`);
        console.log(`  + ${svcName}.localhost:${PROXY_PORT} -> :${port}`);
        res.end("ok");
      });
      return;
    }

    if (req.url === "/_unregister" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const { name: svcName } = JSON.parse(body);
        routes.delete(svcName);
        console.log(`  - ${svcName}.localhost removed`);
        res.end("ok");
      });
      return;
    }

    if (req.url === "/_routes") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(Object.fromEntries(routes)));
      return;
    }
  }

  // Reverse proxy
  const target = routes.get(name);
  if (target) {
    proxy.web(req, res, { target });
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    const available = [...routes.keys()].map((n) => `  http://${n}.localhost:${PROXY_PORT}`).join("\n");
    res.end(`No route for "${name}"\n\nActive services:\n${available || "  (none)"}`);
  }
});

// WebSocket upgrade support
server.on("upgrade", (req, socket, head) => {
  const host = req.headers.host?.replace(/:\d+$/, "");
  const name = host?.replace(/\.localhost$/, "");
  const target = routes.get(name);
  if (target) {
    proxy.ws(req, socket, head, { target });
  } else {
    socket.destroy();
  }
});

function cleanup() {
  if (namespace) {
    try { unlinkSync(join(portDir, `${namespace}.json`)); } catch {}
  }
}

process.on("SIGINT", () => { cleanup(); process.exit(); });
process.on("SIGTERM", () => { cleanup(); process.exit(); });
process.on("exit", cleanup);

server.listen(PROXY_PORT, () => {
  const label = namespace ? ` [${namespace}]` : "";
  console.log(`Portless proxy${label} listening on :${PROXY_PORT}`);
  if (serviceNames.length > 0) {
    console.log(`Known services: ${serviceNames.join(", ")}`);
  }
  if (namespace) {
    console.log(`Port file: .portless/${namespace}.json`);
  }
  console.log();
});
