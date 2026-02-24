FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY src/ src/
COPY drizzle/ drizzle/
COPY drizzle.config.ts tsconfig.json index.ts ./

EXPOSE 3000

CMD ["sh", "-c", "if [ -n \"$GCP_CREDENTIALS_B64\" ]; then echo \"$GCP_CREDENTIALS_B64\" | base64 -d > /app/gcp-credentials.json; fi && bun run drizzle-kit push && bun run src/index.ts"]
