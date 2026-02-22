# Testing Portless on Non-Privileged Port (8080)

## Setup

All files are in this `test/` directory. The `portless.json` here
configures the proxy on port 8080 and defines a single `api` service.

## Steps

### 1. Start the proxy

Open a terminal in this directory and run:

    node ../proxy.mjs

Expected output:

    Portless proxy listening on :8080
    Known services: api

### 2. Start the service

Open a second terminal in this directory and run:

    node ../run.mjs api

Expected output (port may vary):

    api.localhost:8080 -> :4xxx  (node server.js)
    Test service listening on :4xxx

### 3. Verify

From a third terminal, or the same one after backgrounding:

    # Check registered routes
    curl http://127.0.0.1:8080/_routes

    # Access through subdomain (simulates browser Host header)
    curl -H "Host: api.localhost:8080" http://127.0.0.1:8080/

    # Or open in a browser (Chrome/Firefox resolve *.localhost automatically)
    # http://api.localhost:8080

Expected response from curl:

    Hello from test service on port 4xxx
    Requested: GET /

### 4. Clean up

Press Ctrl+C in both terminals to stop the service and proxy.
