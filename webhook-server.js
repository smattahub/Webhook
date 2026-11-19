// GitHub webhook receiver — Node.js, no dependencies.
// Run:  WEBHOOK_SECRET=<same secret as in GitHub settings> node webhook-server.js
// Listens on POST /webhook, verifies X-Hub-Signature-256, and dispatches on X-GitHub-Event.

const http = require("http");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const SECRET = process.env.WEBHOOK_SECRET;
if (!SECRET) {
  console.error("Set WEBHOOK_SECRET to the secret configured on the GitHub webhook.");
  process.exit(1);
}

// GitHub sends X-Hub-Signature-256: "sha256=<hex HMAC of the raw body>".
function isValidSignature(rawBody, header) {
  if (typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from(crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex"), "hex");
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

// GitHub can deliver as application/json or application/x-www-form-urlencoded (payload=<json>).
function parsePayload(rawBody, contentType = "") {
  const text = rawBody.toString("utf8");
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return JSON.parse(new URLSearchParams(text).get("payload"));
  }
  return JSON.parse(text);
}

// One handler per GitHub event (X-GitHub-Event). Add more as needed:
// https://docs.github.com/webhooks/webhook-events-and-payloads
const handlers = {
  ping: (p) => console.log(`Ping from hook ${p.hook_id}: "${p.zen}"`),

  push: (p) => {
    const branch = p.ref.replace("refs/heads/", "");
    console.log(`Push to ${p.repository.full_name}@${branch} by ${p.pusher.name}: ${p.commits.length} commit(s)`);
    for (const c of p.commits) console.log(`  ${c.id.slice(0, 7)} ${c.message.split("\n")[0]}`);
  },

  pull_request: (p) =>
    console.log(`PR #${p.number} ${p.action} in ${p.repository.full_name}: "${p.pull_request.title}" by ${p.sender.login}`),

  issues: (p) =>
    console.log(`Issue #${p.issue.number} ${p.action} in ${p.repository.full_name}: "${p.issue.title}"`),

  issue_comment: (p) =>
    console.log(`Comment on #${p.issue.number} by ${p.comment.user.login}: ${p.comment.body.slice(0, 80)}`),

  release: (p) => console.log(`Release ${p.release.tag_name} ${p.action} in ${p.repository.full_name}`),
};

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404).end("Not found");
    return;
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const rawBody = Buffer.concat(chunks);
    const event = req.headers["x-github-event"];
    const delivery = req.headers["x-github-delivery"];

    if (!isValidSignature(rawBody, req.headers["x-hub-signature-256"])) {
      console.warn(`Rejected delivery ${delivery || "?"}: bad signature`);
      res.writeHead(401).end("Invalid signature");
      return;
    }
    if (!event) {
      res.writeHead(400).end("Missing X-GitHub-Event");
      return;
    }

    let payload;
    try {
      payload = parsePayload(rawBody, req.headers["content-type"]);
    } catch {
      res.writeHead(400).end("Invalid payload");
      return;
    }

    // GitHub expects a 2xx within 10 seconds; reply first, then do the work.
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ received: true, event, delivery }));

    console.log(`[${delivery}] ${event}${payload.action ? "." + payload.action : ""}`);
    const handler = handlers[event];
    try {
      if (handler) handler(payload);
      else console.log(`  (no handler for "${event}")`);
    } catch (err) {
      console.error(`  handler for "${event}" failed:`, err.message);
    }
  });
});

server.listen(PORT, () => console.log(`GitHub webhook server listening on http://localhost:${PORT}/webhook`));
