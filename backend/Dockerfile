FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S nova && adduser -S nova -G nova
COPY --from=build --chown=nova:nova /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=build --chown=nova:nova /app/dist ./dist
COPY --from=build --chown=nova:nova /app/migrations ./migrations
USER nova
EXPOSE 3000
CMD ["node", "dist/index.js"]
