FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY views ./views
COPY public ./public
COPY scripts ./scripts
COPY migrations ./migrations
COPY schema.sql ./schema.sql
COPY package.json ./
EXPOSE 8080
CMD ["npm", "start"]
