# CreatorForge AI — full-stack single container (API + built web client).
# Build:  docker build -t creatorforge-ai .
# Run:    docker run -p 4000:4000 -v creatorforge-data:/data \
#           -e DATA_DIR=/data -e JWT_SECRET='<long-random-string>' creatorforge-ai
# Then open http://localhost:4000 (add -e ADMIN_EMAIL/-e ADMIN_PASSWORD to override defaults)

# ── Stage 1: build the web client ──────────────────────────────────────────
FROM node:20-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install --no-audit --no-fund
COPY client/ ./
RUN npm run build

# ── Stage 2: production server ─────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server/src ./src
COPY server/package.json ./
COPY --from=client-build /app/client/dist /app/client/dist
ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data
VOLUME /data
EXPOSE 4000
CMD ["node", "src/index.js"]
