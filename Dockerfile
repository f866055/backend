FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Instalar dependencias completas para compilar
COPY package*.json ./
RUN npm ci

# Copiar el código fuente y compilar TypeScript con NestJS
COPY . .
RUN npm run build

# Imagen final de ejecución en producción
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Instalar únicamente dependencias de producción
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar el código compilado desde la etapa anterior
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main"]
