FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock index.ts tsconfig.json ./
COPY src ./src

RUN bun install --frozen-lockfile
RUN bun build --compile --outfile /out/w ./index.ts

FROM gcr.io/distroless/base-debian12:nonroot AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build --chown=65532:65532 /out/w /app/w

# Run as the conventional non-root distroless-style UID/GID.
USER 65532:65532

EXPOSE 8080

ENTRYPOINT ["/app/w"]
CMD ["serve", "--port", "8080"]
