FROM golang:1.26-alpine AS build
WORKDIR /app
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /proxy .

FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /proxy /proxy
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/proxy"]
