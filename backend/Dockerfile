# --- build stage: install production dependencies ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# --- runtime stage ---
FROM node:20-alpine AS runtime
LABEL org.opencontainers.image.title="SheDrive backend" \
      org.opencontainers.image.description="Express API and Socket.IO server for SheDrive"
ENV NODE_ENV=production \
    PORT=5000 \
    STORAGE_DIR=/app/storage
WORKDIR /app

# Run as the unprivileged user that ships with the node image
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node src ./src

RUN mkdir -p /app/storage && chown -R node:node /app/storage

USER node
EXPOSE 5000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
