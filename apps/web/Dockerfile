# syntax=docker/dockerfile:1
# Build context is the repo root (npm workspaces): see fly.toml.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN npm ci -w apps/web -w packages/core --include-workspace-root
COPY packages/core packages/core
COPY apps/web apps/web
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
RUN npm run build -w apps/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

ENV NGINX_ENVSUBST_FILTER=API_UPSTREAM
ENV API_UPSTREAM=politmus-api.flycast:80

EXPOSE 8080
