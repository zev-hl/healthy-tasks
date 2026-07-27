# Dev-oriented image for the backend. Build context is the repo ROOT so the
# npm workspace (backend + @healthy-tasks/shared) can be installed together.
#
# Debian "slim" (not Alpine): Prisma's query/schema engines need glibc + OpenSSL,
# and Alpine's musl libc trips Prisma's OpenSSL detection. Slim + the openssl
# package is Prisma's recommended setup and "just works".
FROM node:20-slim

# OpenSSL is required by the Prisma engines on Debian slim images.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install root + workspace deps first, using only the manifests so this layer
# is cached until a package.json actually changes. All workspace manifests are
# copied so npm can resolve the workspace graph.
COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm install

# Copy the sources this image actually needs.
COPY packages/shared ./packages/shared
COPY backend ./backend

# Build the shared package and generate the Prisma client.
RUN npm run build --workspace @healthy-tasks/shared \
  && npm run prisma:generate --workspace backend

WORKDIR /app/backend
EXPOSE 4000

# Apply migrations on startup, then run the dev server with hot reload.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run dev"]
