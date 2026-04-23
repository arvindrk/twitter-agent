FROM oven/bun:1-alpine
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src/ ./src/

EXPOSE 3010
CMD ["bun", "src/index.ts"]
