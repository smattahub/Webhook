# GitHub Webhook Receiver

A small Node.js server that receives GitHub webhooks, checks their signatures, and runs a handler for each event type. It has no dependencies.

| File | Purpose |
| --- | --- |
| `start.sh` | Starts the server. Creates and saves a secret on first run. |
| `webhook-server.js` | The receiver. Listens on `POST /webhook`. |
| `send-webhook.js` | Sends fake GitHub deliveries so you can test locally. |
| `.env` | Created by `start.sh`; holds your secret. Git ignores it — never commit it. |
| `test/` | Automated tests. Run with `npm test`. |
| `Dockerfile` | Production container image. |
| `.github/workflows/ci.yml` | CI: tests, Docker build, image publishing. |
| `DEVOPS.md` | How changes are tested, reviewed, released and deployed. |

For the branch → pull request → CI → release → deploy workflow, see [DEVOPS.md](DEVOPS.md).

## Requirements

- Node.js 20 or newer
- To receive real deliveries on your own machine: [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), so GitHub can reach it (`brew install cloudflared`, no account needed)

## 1. Start the server

```bash
./start.sh
```

GitHub signs each delivery with a secret, and the server uses the same secret to reject requests that didn't come from GitHub. The first time you run `start.sh`, it generates a random secret, saves it in `.env`, and prints it. Copy it — you'll paste it into GitHub in step 4. Later runs reuse the saved secret.

To see the secret again at any time:

```bash
./start.sh secret
```

The server listens on `http://localhost:3000/webhook`. To use a different port, add a line like `PORT=4000` to `.env`. To start over with a new secret, delete `.env` and run `./start.sh` again (then update the secret in GitHub too).

## 2. Test locally

With the server running, open a second terminal in this folder and send a fake delivery signed with your saved secret:

```bash
WEBHOOK_SECRET=$(./start.sh secret) node send-webhook.js ping
```

Other sample events: `push`, `pull_request`, `issues`. Each one should return `202` and print a line in the server log. If you send with the wrong secret, the server returns `401`.

If the server runs somewhere else, set `WEBHOOK_URL` to point the sender at it.

## 3. Expose the server to GitHub

GitHub can't deliver to `localhost` — it rejects the webhook with "isn't reachable over the public Internet". If the server runs on your own machine, use a tunnel, which gives it a temporary public `https://` address.

Install cloudflared once:

```bash
brew install cloudflared
```

Then, with the server running, start the tunnel in a second terminal:

```bash
cloudflared tunnel --url http://localhost:3000
```

After a few seconds it prints an address like `https://random-words.trycloudflare.com`. Your Payload URL is that address plus `/webhook`.

Keep both terminals open while testing. The address changes every time you restart cloudflared, so update the Payload URL in GitHub when it does. For an address that stays the same, run the server on a machine with a public address, or set up a named Cloudflare tunnel (needs a Cloudflare account).

## 4. Add the webhook in GitHub

In your repository (or organization), go to **Settings → Webhooks → Add webhook** and fill in:

| Field | Value |
| --- | --- |
| Payload URL | Your tunnel address plus `/webhook`, e.g. `https://random-words.trycloudflare.com/webhook` |
| Content type | `application/json` (form-encoded also works) |
| Secret | The output of `./start.sh secret` |
| Events | "Just the push event", "Send me everything", or pick individual events |

Click **Add webhook**. GitHub immediately sends a `ping`, and the server log should show something like:

```
[<delivery-id>] ping
Ping from hook 12345: "Keep it logically awesome."
```

To resend any delivery for debugging, open the webhook's **Recent Deliveries** tab and click **Redeliver**.

## Handling events

The server picks a handler from the `X-GitHub-Event` header. It comes with handlers for `ping`, `push`, `pull_request`, `issues`, `issue_comment` and `release`. Other event types are logged and still acknowledged.

To handle a new event type, add a function to `handlers` in `webhook-server.js`, named after the event:

```js
const handlers = {
  // ...
  star: (p) => console.log(`${p.sender.login} ${p.action} a star on ${p.repository.full_name}`),
};
```

GitHub's [webhook events and payloads](https://docs.github.com/webhooks/webhook-events-and-payloads) reference lists every event type and the fields its payload contains.

## Running tests

```bash
npm test
```

The tests use Node's built-in test runner, so there's nothing to install. CI runs them on every push and pull request.

## Notes

- **Reply time:** GitHub expects a reply within 10 seconds. The server replies `202` first and then runs the handler. For slow work, such as builds or API calls, put the job on a queue instead of running it in the handler.
- **Duplicate deliveries:** GitHub may send the same delivery more than once. Use the `X-GitHub-Delivery` ID to skip deliveries you've already processed.
- **Response codes:** `401` means the signature was bad, `400` means a header was missing or the payload was invalid, and `404` means the request used the wrong path or method.
