FROM golang:1.24-alpine AS tools
RUN CGO_ENABLED=0 GOBIN=/out go install -trimpath -ldflags="-s -w" filippo.io/age/cmd/...@v1.2.1

FROM mysql:8.4
COPY --from=tools /out/age /out/age-keygen /usr/local/bin/
COPY backup.sh /usr/local/bin/backup.sh
ENTRYPOINT ["bash", "/usr/local/bin/backup.sh"]
