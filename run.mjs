#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import getPort from "get-port";

const configPath = join(process.cwd(), "portless.json");

// Parse arguments: [--ns <namespace>] <command> [args...]
const rawArgs = process.argv.slice(2);
let namespace = null;
const nsIndex = rawArgs.indexOf("--ns");
if (nsIndex !== -1) {
  namespace = rawArgs[nsIndex + 1];
  rawArgs.splice(nsIndex, 2);
}

const requested = rawArgs[0];

const PORT_RANGE_START = 4000;
const PORT_RANGE_END = 4999;

// --- init command (no config needed) ---
if (requested === "init") {
  if (existsSync(configPath)) {
    console.error("portless.json already exists in this directory.");
    process.exit(1);
  }
  const template = {
    proxyPort: 80,
    proxyPortRange: [8001, 8099],
    services: {
      web: {
        cwd: "./packages/web",
        command: "npm start",
        env: { PORT: "{port}" },
      },
      api: {
        cwd: "./packages/api",
        command: "npm start",
        env: { PORT: "{port}" },
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(template, null, 2) + "\n");
  console.log("Created portless.json — edit it to match your project.");
  process.exit(0);
}

// --- Load config ---
if (!existsSync(configPath)) {
  console.error("No portless.json found in the current directory.");
  console.error("Run `portless init` to create one.");
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));

// Resolve proxy port — from namespace port file or default
let PROXY_PORT;
if (namespace) {
  const portFilePath = join(process.cwd(), ".portless", `${namespace}.json`);
  try {
    const portFile = JSON.parse(readFileSync(portFilePath, "utf8"));
    PROXY_PORT = portFile.port;
  } catch {
    console.error(`No proxy found for namespace "${namespace}".`);
    console.error(`Start it first: portless-proxy ${namespace}`);
    process.exit(1);
  }
} else {
  PROXY_PORT = config.proxyPort || 80;
}

const PROXY_HOST = `http://127.0.0.1:${PROXY_PORT}`;

// --- No args: show help ---
if (!requested) {
  console.log("Usage:");
  console.log("  portless [--ns <name>] <service> Start a single service");
  console.log("  portless [--ns <name>] all       Start all services");
  console.log("  portless [--ns <name>] list       Show active services");
  console.log("  portless init                     Create a portless.json template");
  console.log();
  console.log("Options:");
  console.log("  --ns <name>  Run under a namespace (requires: portless-proxy <name>)");
  console.log("               Allows multiple branches to run side-by-side.");
  console.log();
  console.log("Available services:");
  for (const name of Object.keys(config.services)) {
    const svc = config.services[name];
    console.log(`  ${name.padEnd(10)} ${svc.command}  (${svc.cwd})`);
  }
  process.exit(0);
}

// --- list command ---
if (requested === "list") {
  try {
    const res = await fetch(`${PROXY_HOST}/_routes`);
    const routes = await res.json();
    const names = Object.keys(routes);
    if (names.length === 0) {
      console.log("No active services.");
    } else {
      const label = namespace ? ` [${namespace}]` : "";
      console.log(`Active services${label}:`);
      for (const [name, target] of Object.entries(routes)) {
        console.log(`  http://${name}.localhost:${PROXY_PORT} -> ${target}`);
      }
    }
  } catch {
    if (namespace) {
      console.log(`Proxy for namespace "${namespace}" is not running. Start it first: portless-proxy ${namespace}`);
    } else {
      console.log("Proxy is not running. Start it first: portless-proxy");
    }
  }
  process.exit(0);
}

// --- Resolve which services to start ---
const toStart =
  requested === "all"
    ? Object.entries(config.services)
    : [[requested, config.services[requested]]];

if (requested !== "all" && !config.services[requested]) {
  console.error(`Unknown service: "${requested}"`);
  console.error(`Available: ${Object.keys(config.services).join(", ")}`);
  process.exit(1);
}

// Verify proxy is running
try {
  await fetch(`${PROXY_HOST}/_routes`);
} catch {
  if (namespace) {
    console.error(`Proxy for namespace "${namespace}" is not running. Start it first:`);
    console.error(`  portless-proxy ${namespace}`);
  } else {
    console.error("Proxy is not running. Start it first:");
    console.error("  portless-proxy");
  }
  process.exit(1);
}

// Build service discovery env vars (PORTLESS_URL_<NAME>=http://<name>.localhost:<port>)
const discoveryEnv = {};
for (const svcName of Object.keys(config.services)) {
  discoveryEnv[`PORTLESS_URL_${svcName.toUpperCase()}`] = `http://${svcName}.localhost:${PROXY_PORT}`;
}

const children = [];

for (const [name, svc] of toStart) {
  const port = await getPort({
    port: Array.from({ length: PORT_RANGE_END - PORT_RANGE_START + 1 }, (_, i) => PORT_RANGE_START + i),
  });

  // Register with proxy
  await fetch(`${PROXY_HOST}/_register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, port }),
  });

  const cwd = resolve(process.cwd(), svc.cwd);

  // Build service-specific env vars, replacing {port} and {proxyPort} placeholders
  const svcEnv = {};
  const envConfig = svc.env || { PORT: "{port}" };
  for (const [key, value] of Object.entries(envConfig)) {
    svcEnv[key] = String(value)
      .replace(/\{port\}/g, port)
      .replace(/\{proxyPort\}/g, PROXY_PORT)
      .replace(/\{name\}/g, name);
  }

  const label = namespace ? ` [${namespace}]` : "";
  console.log(`${name}.localhost:${PROXY_PORT} -> :${port}  (${svc.command})${label}`);

  const child = spawn(svc.command, [], {
    stdio: "inherit",
    shell: true,
    cwd,
    env: {
      ...process.env,
      ...discoveryEnv,
      ...svcEnv,
    },
  });

  child.on("exit", async (code) => {
    console.log(`${name} exited (code ${code})`);
    try {
      await fetch(`${PROXY_HOST}/_unregister`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } catch {
      // proxy may already be stopped
    }
  });

  children.push(child);
}

// Graceful shutdown — unregister all and kill children
function shutdown() {
  console.log("\nShutting down...");
  for (const child of children) {
    child.kill();
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
