FROM node:24.19.0-bookworm-slim

WORKDIR /app

ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV HOST=0.0.0.0

CMD ["npm", "start"]
