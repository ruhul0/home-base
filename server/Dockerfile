FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.24-alpine AS server
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/*.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /home-base .

FROM alpine:3.21
RUN adduser -D -H app
WORKDIR /app
COPY --from=server /home-base ./home-base
COPY --from=web /web/out ./public
USER app
CMD ["./home-base"]
