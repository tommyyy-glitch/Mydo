import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL(".", import.meta.url));
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
http
  .createServer(async (req, res) => {
    try {
      const name = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      const file = path.resolve(
        root,
        "." + (name === "/" ? "/index.html" : name),
      );
      if (
        !file.startsWith(root) ||
        name.split("/").some((x) => x.startsWith("."))
      )
        throw Error();
      res.setHeader("Content-Type", types[path.extname(file)] || "text/plain");
      res.setHeader("Cache-Control", "no-store");
      res.end(await readFile(file));
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(Number(process.env.PORT || 4175), "127.0.0.1", () =>
    console.log("Mydo: http://127.0.0.1:" + (process.env.PORT || 4175)),
  );
