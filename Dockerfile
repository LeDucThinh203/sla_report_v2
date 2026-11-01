FROM node:22-slim AS builder
WORKDIR /w

# Build frontend
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Build backend
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci
COPY backend/ ./backend/
RUN cd backend && npm run build

# Production runtime image
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /w/backend/dist ./dist
COPY --from=builder /w/frontend/dist ./public
COPY app/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["sh", "./entrypoint.sh"]
CMD ["start"]
