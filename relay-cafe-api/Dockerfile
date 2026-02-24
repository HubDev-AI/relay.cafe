FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY src/ src/
COPY drizzle/ drizzle/
COPY drizzle.config.ts tsconfig.json index.ts ./

EXPOSE 3000

CMD ["sh", "-c", "bun run drizzle-kit push && bun run src/index.ts"]
