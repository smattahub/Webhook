# DevOps Process

How changes to this project get from your editor to a running server.

```
feature branch ──► pull request ──► CI (tests + Docker build) ──► review ──► merge to main
                                                                                 │
                       ghcr.io/smattahub/webhook:latest  ◄── CI publishes image ─┘
                                                                                 │
                                  tag vX.Y.Z ──► CI publishes :X.Y.Z ──► deploy ──► verify
```

## 1. Branch

Never commit directly to `main`. Start each change on its own branch:

```bash
git switch main && git pull
git switch -c feature/short-description
```

Name branches by type: `feature/…`, `fix/…`, `devops/…`, `docs/…`.

## 2. Develop and test locally

```bash
npm test            # unit + HTTP tests (Node's built-in runner, no installs)
npm run check       # syntax check
./start.sh          # run the server with your saved secret
```

Then send a test delivery from a second terminal:

```bash
node send-webhook.js push
```

When you add a handler or change request handling, add a test for it in `test/webhook-server.test.js`.

## 3. Open a pull request

```bash
git push -u origin feature/short-description
```

Open the pull request on GitHub. CI runs automatically.

## 4. Continuous integration

The workflow is defined in `.github/workflows/ci.yml`.

| Trigger | What runs |
| --- | --- |
| Pull request | Tests on Node 20 and 22, then a Docker build and smoke test. Nothing is published. |
| Push to `main` | The same, then the image is published as `ghcr.io/smattahub/webhook:latest` and `:sha-<commit>`. |
| Tag `v1.2.3` | The same, then the image is published as `:1.2.3`. |

The smoke test starts the container and waits for `GET /health` to return 200.

A pull request is only merged when CI is green.

## 5. Review and merge

- At least one review, even if it's a self-review of the diff on GitHub.
- Use **Squash and merge**, so `main` has one commit per change.
- Delete the branch after merging.

### Recommended: protect `main`

In **Settings → Branches → Add branch ruleset** (or **Add rule**) for `main`, turn on:

- Require a pull request before merging
- Require status checks to pass: `Test (Node 20)`, `Test (Node 22)` and `Docker image`
- Block force pushes

## 6. Release

When `main` has changes you want to deploy, tag a version using [semantic versioning](https://semver.org): patch for fixes, minor for new handlers, major for breaking changes.

```bash
git switch main && git pull
git tag v1.0.0
git push origin v1.0.0
```

CI publishes `ghcr.io/smattahub/webhook:1.0.0`. Deploy version tags, not `latest`, so you always know what is running.

## 7. Deploy

The image runs anywhere that runs containers. It needs two things:

| Setting | Value |
| --- | --- |
| `WEBHOOK_SECRET` | Your webhook secret, set in the host's secret store. Never put it in the image or in git. |
| Port | `3000`, or set `PORT`. Expose it over HTTPS. |

On any Docker host:

```bash
docker pull ghcr.io/smattahub/webhook:1.0.0
docker run -d --name webhook --restart unless-stopped -p 3000:3000 -e WEBHOOK_SECRET="$WEBHOOK_SECRET" ghcr.io/smattahub/webhook:1.0.0
```

Put an HTTPS reverse proxy or load balancer in front of it. Then set the GitHub webhook's **Payload URL** to `https://<your-domain>/webhook`. This replaces the cloudflared tunnel, which is only for local testing.

If the repository is private, the image is private too. The host needs to log in to `ghcr.io` with a token that has `read:packages`. Alternatively, make the package public under **Your profile → Packages → webhook → Package settings**.

## 8. Verify after deploying

1. `curl https://<your-domain>/health` returns `{"status":"ok"}`.
2. In GitHub, go to **Settings → Webhooks → your webhook → Recent Deliveries**, open the latest delivery, and click **Redeliver**. It should return `202`.
3. Check the container logs (`docker logs webhook`) for the delivery line.

## 9. Roll back

Redeploy the previous version tag:

```bash
docker rm -f webhook
docker run -d --name webhook --restart unless-stopped -p 3000:3000 -e WEBHOOK_SECRET="$WEBHOOK_SECRET" ghcr.io/smattahub/webhook:<previous-version>
```

Then redeliver any deliveries that failed while the bad version was running, from **Recent Deliveries**.

## 10. Operate

- **Health:** the container has a built-in health check on `/health`. Point your host's uptime monitor at the same endpoint.
- **Failed deliveries:** GitHub does not retry automatically. Check **Recent Deliveries** after any outage and redeliver anything that failed.
- **Rotating the secret:** generate a new one (`openssl rand -hex 32`), update it in the host's secret store and restart the container. Then update the webhook's **Secret** in GitHub straight away, because deliveries fail with `401` until both sides match.
- **Shutdown:** the server finishes in-flight requests when it receives `SIGTERM`, so restarts and deploys don't drop deliveries.
- **Dependency updates:** Dependabot opens weekly pull requests for the GitHub Actions and the Node base image. Merge them when CI passes.
