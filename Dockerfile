FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Instalar herramientas para compilar módulos nativos (bcrypt, etc.)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Instalar dependencias con fallback seguro
COPY package*.json ./
RUN npm ci || npm install

# Copiar el código fuente y compilar NestJS
COPY . .
RUN npm run build

# Remover devDependencies para dejar solo dependencias de producción
RUN npm prune --omit=dev

# Imagen final ligera de ejecución
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main"]
