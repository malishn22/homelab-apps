FROM node:22-alpine AS builder
WORKDIR /app
COPY apps/minecraft/frontend/package*.json ./
RUN npm ci
COPY apps/minecraft/frontend .
ARG VITE_API_BASE_URL=""
RUN VITE_API_BASE_URL="$VITE_API_BASE_URL" npm run build

FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY apps/minecraft/frontend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
CMD ["/docker-entrypoint.sh"]
