FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY apps/bot/package.json apps/bot/package.json
RUN npm install --prefix apps/bot
COPY apps/bot apps/bot
RUN npm --prefix apps/bot run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/bot/package.json ./apps/bot/package.json
COPY --from=build /app/apps/bot/node_modules ./apps/bot/node_modules
COPY --from=build /app/apps/bot/dist ./apps/bot/dist
EXPOSE 3000
CMD ["node", "apps/bot/dist/index.js"]
