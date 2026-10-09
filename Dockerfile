# Node version must match .nvmrc (checked by scripts/check-consistency.cjs).
ARG NODE_VERSION=22
# Build stage
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Serve stage — static SPA, no backend
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# SPA fallback: deep links and the PWA service worker resolve to index.html
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n  # immutable hashed assets\n  location /assets/ {\n    expires 1y;\n    add_header Cache-Control "public, immutable";\n  }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
