const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
// Порт должен быть постоянным: данные лежат в localStorage, а он привязан к адресу вместе с портом
const PORT = Number(process.env.PORT) || 3000;
const files = {
  "/": "index.html",
  "/index.html": "index.html",
  "/app.js": "app.js",
  "/style.css": "style.css",
};
const server = http.createServer((req, res) => {
  const name = files[req.url.split("?")[0]];
  if (!name) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader(
    "Content-Type",
    name.endsWith(".js")
      ? "text/javascript; charset=utf-8"
      : name.endsWith(".css")
        ? "text/css; charset=utf-8"
        : "text/html; charset=utf-8",
  );
  fs.createReadStream(path.join(__dirname, name)).pipe(res);
});
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(
      `Порт ${PORT} уже занят другим приложением. Освободите его или запустите на другом порту, например: set PORT=3001 && npm start`,
    );
    process.exit(1);
  }
  throw e;
});
server.listen(PORT, "127.0.0.1", () =>
  console.log(`Темп: http://localhost:${PORT}`),
);
