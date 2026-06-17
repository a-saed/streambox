FROM mcr.microsoft.com/playwright:v1.51.1-noble

WORKDIR /app
COPY server/package*.json ./
RUN npm ci
# Playwright browsers are pre-installed in this image; register them
RUN npx playwright install chromium
COPY server/ .
RUN npm run build
RUN npm prune --production
EXPOSE 3001
CMD ["node", "dist/index.js"]
