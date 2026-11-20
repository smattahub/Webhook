# Production image for the webhook server. No dependencies to install.
# Build:  docker build -t github-webhook .
# Run:    docker run -p 3000:3000 -e WEBHOOK_SECRET=<secret> github-webhook

FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY package.json webhook-server.js ./

# Run as the unprivileged user that the Node image provides.
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:' + process.env.PORT + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "webhook-server.js"]
