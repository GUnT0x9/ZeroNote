FROM node:24-bookworm-slim
RUN npm install -g pnpm@11.9.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && chown -R node:node /app
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "start"]
