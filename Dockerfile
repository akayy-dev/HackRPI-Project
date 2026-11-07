FROM golang:1.26-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /proxy .

FROM scratch
WORKDIR /app
COPY --from=build /app/classifier/weights.json /app/classifier/weights.json
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /proxy /proxy
USER 65532:65532
EXPOSE 8080 8081
ENTRYPOINT ["/proxy"]
