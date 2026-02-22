import http from "node:http";

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(`Hello from test service on port ${PORT}\nRequested: ${req.method} ${req.url}`);
});

server.listen(PORT, () => {
  console.log(`Test service listening on :${PORT}`);
});
