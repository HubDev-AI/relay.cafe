.PHONY: dev up down logs clean test db-push db-reset start

# Start postgres + redis for local development (run API natively with bun)
dev:
	docker compose up -d postgres redis

# Start full stack (postgres + redis + API container)
up:
	docker compose up --build -d

# Stop all services
down:
	docker compose down

# View logs (pass SVC=api to filter, e.g. make logs SVC=api)
logs:
	docker compose logs -f $(SVC)

# Remove containers, volumes, and images
clean:
	docker compose down -v --rmi local

# Run tests
test:
	bun test

# Push schema to database
db-push:
	bunx drizzle-kit push

# Reset test data (messages + daily tokens)
db-reset:
	docker compose exec postgres psql -U relay -d relaycafe -c "DELETE FROM messages; DELETE FROM daily_tokens;"

# Start API server (native, not in container)
start:
	bun run src/index.ts
