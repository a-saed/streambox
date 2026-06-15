FROM node:22-alpine
WORKDIR /app
COPY server/package*.json ./
RUN npm ci
COPY server/ .
RUN npm run build
RUN npm prune --production
EXPOSE 3001
CMD ["node", "dist/index.js"]
