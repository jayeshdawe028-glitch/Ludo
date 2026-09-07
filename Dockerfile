FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
COPY apps/activity/package.json apps/activity/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/bot/package.json apps/bot/package.json
RUN npm install
COPY . .
ARG VITE_DISCORD_CLIENT_ID
ARG VITE_SERVER_URL
ENV VITE_DISCORD_CLIENT_ID=$VITE_DISCORD_CLIENT_ID
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/activity/dist apps/activity/dist
COPY --from=build /app/apps/bot/package.json apps/bot/package.json
COPY --from=build /app/apps/bot/src apps/bot/src
EXPOSE 3000
CMD ["npm","start"]
