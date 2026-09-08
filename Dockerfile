FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json ./
COPY apps/bot/package.json apps/bot/package.json
RUN npm install --prefix apps/bot --omit=optional

COPY apps/bot apps/bot
RUN npm --prefix apps/bot run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

COPY --from=build /app/apps/bot/package.json ./apps/bot/package.json
COPY --from=build /app/apps/bot/node_modules ./apps/bot/node_modules
COPY --from=build /app/apps/bot/dist ./apps/bot/dist

RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/bot/dist/index.js"]
