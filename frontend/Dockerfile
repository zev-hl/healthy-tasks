# Dev-oriented image for the frontend Vite dev server. Build context is the
# repo ROOT so the npm workspace (frontend + @healthy-tasks/shared) installs
# together.
FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm install

COPY packages/shared ./packages/shared
COPY frontend ./frontend

# The SPA imports types from the shared package, so build it once.
RUN npm run build --workspace @healthy-tasks/shared

WORKDIR /app/frontend
EXPOSE 5173

CMD ["npm", "run", "dev"]
