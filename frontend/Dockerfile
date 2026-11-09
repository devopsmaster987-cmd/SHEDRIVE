# --- build stage: Vite production build ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force
COPY . .
RUN npm run build

# --- runtime stage: static files served by nginx ---
FROM nginx:1.27-alpine AS runtime
LABEL org.opencontainers.image.title="SheDrive frontend" \
      org.opencontainers.image.description="Vite static build served by nginx for SheDrive"
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health || exit 1
CMD ["nginx", "-g", "daemon off;"]
