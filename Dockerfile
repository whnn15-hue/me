FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY server ./server
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production APP_DATA_DIR=/data PORT=3001 APP_LOCAL_MODE=false
USER node
EXPOSE 3001
CMD ["node", "server/index.mjs"]
