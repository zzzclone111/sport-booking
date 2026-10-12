FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S nodeapp && adduser -S nodeapp -G nodeapp
COPY --from=deps --chown=nodeapp:nodeapp /app/node_modules ./node_modules
COPY --chown=nodeapp:nodeapp package*.json ./
COPY --chown=nodeapp:nodeapp src ./src
COPY --chown=nodeapp:nodeapp migrations ./migrations
RUN find src migrations -type d -exec chmod 755 {} + && find src migrations -type f -exec chmod 644 {} +
USER nodeapp
EXPOSE 3000
CMD ["node", "src/server.js"]
