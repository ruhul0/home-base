FROM golang:1.24-alpine AS build
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/*.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /home-base .

FROM alpine:3.21
RUN adduser -D -H app
WORKDIR /app
COPY --from=build /home-base ./home-base
COPY index.html landing.css landing.js newtab.html newtab.css newtab.js admin.html admin.css admin.js privacy.html privacy.css ./public/
COPY icons ./public/icons
COPY assets/store/screenshot-*.png ./public/screens/
USER app
CMD ["./home-base"]
