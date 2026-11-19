// Local-only file server for the browser upload relay. No CORS: only relay.html (same origin) can read the files.
const http = require("http"), fs = require("fs"), path = require("path")
// Usage: node relay/serve.js "<folder with the video>"  (relay.html is served from this script's folder)
const root = process.argv[2], port = 8765
http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, "http://x").pathname.slice(1)) || "index.html"
  const base = path.basename(name)
  const file = base === "relay.html" ? path.join(__dirname, base) : path.join(root, base) // basename: no path traversal out of root
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("not found") }
  res.setHeader("Content-Type", file.endsWith(".html") ? "text/html" : "video/mp4")
  res.setHeader("Content-Length", fs.statSync(file).size)
  fs.createReadStream(file).pipe(res)
}).listen(port, "127.0.0.1", () => console.log("up " + port))
