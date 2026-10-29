# syntax=docker/dockerfile:1
# The website: the Expo app's static web export behind nginx. Build context is
# the repo root (npm workspaces): see fly.toml.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/app/package.json apps/app/
COPY packages/core/package.json packages/core/
RUN npm ci -w apps/app -w packages/core --include-workspace-root
COPY packages/core packages/core
COPY apps/app apps/app
ARG EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=$EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
# Same origin: nginx proxies /api to the API, which has no public address.
ENV EXPO_PUBLIC_API_URL=
WORKDIR /app/apps/app
RUN CI=1 npx expo export --platform web --output-dir dist

FROM nginx:1.27-alpine
COPY apps/app/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/app/dist /usr/share/nginx/html

ENV NGINX_ENVSUBST_FILTER=API_UPSTREAM
ENV API_UPSTREAM=politmus-api.flycast:80

EXPOSE 8080
