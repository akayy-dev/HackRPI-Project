# Task

Fine-tune the HTTP threat-classifier head so live requests through this reverse proxy classify the same way the author's original fixtures do. The proxy wiring is already correct. Do not replace EmbeddingGemma. Do not rewrite live timestamps or addresses back to the 2020 lab values.

Project root: `/Users/cooperhaas/Projects/cybersecurity/HackRPI-Project`

Compose project name: `vivian-demo`. Containers already running: `vivian-demo-proxy-1`, `vivian-demo-classifier-1`, `vivian-demo-mongodb-1`, `vivian-demo-target-web-app-1`. The published head is loaded. `HF_TOKEN` is already available to Docker and must stay unprinted.

## Why this retrain exists

The service at `classifier/app.py` serializes each proxied request and scores it with frozen `google/embeddinggemma-300m` plus `valendra/threat-classifier-13082026`. That head was trained on a July 2020 packet capture. On the author's original SQL fixture, SQL Injection scores about 0.883. The same path through the proxy, with today's timestamp, Docker source address `192.168.65.1`, destination port `8080`, and `Accept: */*`, scores about 0.10 and the top class becomes Normal. Changing only the timestamp cuts the SQL score to about 0.469. Removing the timestamp and addresses also fails, so do not drop those fields from the proxy. Train a new head on rows that already look like proxy traffic.

Measured cost on this Mac, inside the classifier container, CPU: one batch of 64 short requests embeds in 6.6 seconds. Budget about 35 minutes to embed 20,000 rows and about 1.5 hours for 50,000. Head training is a few minutes. The full 908,000-row file is about 26 hours on that CPU. Use a 30,000-row stratified sample.

## Dataset

Source CSV: Kaggle dataset `natasa213/data-capec-multilabel`, file `data_capec_multilabel.csv`.

There is no Kaggle credential on this machine. If `~/.kaggle/kaggle.json` is missing, stop and ask the user to create one. Do not invent a token, do not print a token, and do not commit the CSV.

Download to `data/data_capec_multilabel.csv`. Add `data/` and `artifacts/` to `.gitignore` if they are not already ignored. Do not commit the CSV, the rewritten CSV, embeddings, or head weights.

The author's trainer is `https://github.com/valendra-tech/valendra-labs-threat-classifier`. Clone it outside this repo, for example `~/Projects/cybersecurity/valendra-labs-threat-classifier`. Install it with `uv`. The fine-tune command reads request columns and the 14 label columns, serializes with its own code, embeds with EmbeddingGemma, and trains the linear head.

Label columns, in this order:

```
000 - Normal
272 - Protocol Manipulation
242 - Code Injection
88 - OS Command Injection
126 - Path Traversal
66 - SQL Injection
16 - Dictionary-based Password Attack
310 - Scanning for Vulnerable Software
153 - Input Data Manipulation
248 - Command Injection
274 - HTTP Verb Tampering
194 - Fake the Source of Data
34 - HTTP Response Splitting
33 - HTTP Request Smuggling
```

Every label value must be `0` or `1`. Every row must have at least one `1`. The trainer stratifies on the first active label and will fail if a class has fewer than two rows. Drop every row whose only positive label is `248 - Command Injection`. After sampling, drop any primary label that still has fewer than 10 rows.

## Rewrite script

Add `scripts/rewrite_proxy_dataset.py` in this project. It reads the Kaggle CSV and writes two files:

- `data/proxy_shaped.csv`, about 30,000 rows, used for training
- `data/proxy_shaped_holdout.csv`, about 500 rows from the same transform, disjoint from the training sample

Use a fixed random seed of `42`. Sample stratifying on the first active label so common and rare classes both remain.

On every output row, replace these columns with values drawn independently of the label:

- `timestamp`: a random time in the last 30 days, formatted like `07/Nov/2026:16:04:05 +0000`
- `src_ip`: a random address in `192.168.65.0/24` or `10.0.0.0/8`
- `src_port`: a random port from 1024 through 65535
- `dst_ip`: `172.18.0.4`
- `dst_port`: `8080`
- `request_accept`: if empty, set it to `*/*`

Do not modify method, path, protocol, user agent, host, body, content type, referer, cookie, or any label column. Do not set every row to one shared timestamp. Preserve URL encoding in `request_http_request` and `request_body`.

Print the row counts and the primary-label counts for both output files. Fail if either file is empty or if a label column is missing.

## Train

From the cloned author repo, with `HF_TOKEN` set and the EmbeddingGemma license already accepted:

```bash
uv run threat-classifier fine-tune \
  --csv /Users/cooperhaas/Projects/cybersecurity/HackRPI-Project/data/proxy_shaped.csv \
  --out /Users/cooperhaas/Projects/cybersecurity/HackRPI-Project/artifacts/proxy-head \
  --device auto \
  --epochs 20
```

Run this on the Mac, outside the Docker container, so `--device auto` can use the M2 GPU. Do not pass `--from-scratch`. Do not pass `--max-rows`, because that flag keeps the first rows of each split and can drop rare classes. The training sample is already limited.

The new head is `artifacts/proxy-head/head/model.safetensors` plus `meta.json`. Confirm `meta.json` labels exactly match the 14 labels above before loading it.

## Serve the new head

`classifier/app.py` always downloads `HEAD_REPO`. Add a `HEAD_DIR` environment variable. When `HEAD_DIR` is set, load `model.safetensors` and `meta.json` from that directory and skip `snapshot_download`. Keep the existing label-order check and the backbone download. The backbone still needs `HF_TOKEN`.

Mount the head into the classifier service in `docker-compose.yml`:

```yaml
HEAD_DIR: /models/head
volumes:
  - ./artifacts/proxy-head/head:/models/head:ro
  - huggingface-cache:/cache/huggingface
```

Leave `CLASSIFIER_DEVICE` as `cpu` for the Docker service. Rebuild and restart only the classifier, then start the proxy if it is stopped:

```bash
docker compose up -d --build classifier
docker compose up -d proxy
```

Wait until `docker logs vivian-demo-classifier-1` prints `classifier ready` and `docker compose ps` shows the proxy publishing `0.0.0.0:8080->8080/tcp`.

## Test

Score two versions of each case below.

1. The author's original field values, posted as serialized text straight to `http://127.0.0.1:8000/classify` inside `vivian-demo-classifier-1`.
2. The same path and body through `http://127.0.0.1:8080`, which adds a current timestamp and the live connection fields.

Cases:

- Normal: `GET /` with the Chrome user agent and `Host: test-site.com`. Expect top class `000 - Normal`.
- Normal path: `GET /go/to/sleep` with the same browser headers. Expect `000 - Normal`.
- SQL: `GET /blog/wp-content/uploads/2020/04/b476e717-efec-3b0d-80e9-13c6400a7702-300x240.png%27%3Bsleep+15%3B%27` with the Firefox 70 user agent and `Host: test-site.com`. Expect top class `66 - SQL Injection` on both the original text and the proxy request.
- SQL v2: `GET /search.php?q=abc%27%2f%2a%2a%2foR%2f%2a%2a%2f%271%27%3d%271`. Expect `66 - SQL Injection` on both.
- Path traversal: `GET /blog/index.php/my-account/user-logout/?_wpnonce=%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C..%5C`. Expect `126 - Path Traversal` on both.
- Command injection: `POST /test.php` with content type `application/x-www-form-urlencoded` and body `user_login=amazedMeerkat9%60sleep+15%60&redirect_to=&wp-submit=Get+New+Password`. Expect the top class to be `88 - OS Command Injection` or a higher attack score than Normal on both.

Use `curl --globoff` so the encoded characters are preserved. Read proxy decisions from `docker logs vivian-demo-proxy-1` lines whose message is `Classified request`. Also score 20 rows from `data/proxy_shaped_holdout.csv` by serializing them with the author field order and posting them to the classifier. Report top-class accuracy on that holdout.

Do not lower `RISK_THRESHOLD` to hide a wrong top class. Report both the top class and the attack risk. The proxy blocks when attack risk is at least 0.5.

## Done when

- The proxy SQL request and the original SQL fixture have the same top class, `66 - SQL Injection`.
- The proxy normal `GET /` request has top class `000 - Normal`.
- Holdout top-class accuracy is reported.
- No dataset file, token, or head weight is committed.

If the live SQL request is still Normal after this training run, say so and stop. Do not chase it by writing the 2020 timestamp back into the proxy.
