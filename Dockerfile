FROM --platform=$BUILDPLATFORM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM docker:cli AS dockercli

FROM docker/compose-bin:latest AS composebin

FROM node:20-alpine
ARG VERSION=latest
ARG CREATED
ARG REVISION
WORKDIR /app
ENV NODE_ENV=production
LABEL org.opencontainers.image.title="DockObserver" \
      org.opencontainers.image.description="A lightweight container that scans local Docker containers and Compose stacks, and checks for updates." \
      org.opencontainers.image.url="https://github.com/MyDevil94/DockObserver" \
      org.opencontainers.image.documentation="https://github.com/MyDevil94/DockObserver#readme" \
      org.opencontainers.image.source="https://github.com/MyDevil94/DockObserver" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${CREATED}" \
      org.opencontainers.image.revision="${REVISION}"
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=composebin /docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
EXPOSE 8080
CMD ["node", "dist/index.js"]
