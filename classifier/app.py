"""Keep the threat classifier loaded and score one serialized request at a time.

The Go proxy POSTs {"text": "<serialized request>"} to /classify. Request text
is not written to the log. /health stays closed until EmbeddingGemma and the
published classification head have both loaded and scored a warmup request.
"""

from __future__ import annotations

import json
import hashlib
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
from huggingface_hub import snapshot_download
from safetensors.torch import load_file
from sentence_transformers import SentenceTransformer

from scoring import LABELS, PROMPT, attack_risk, label_map, top_label

HEAD_REPO = os.environ.get("HEAD_REPO", "valendra/threat-classifier-13082026")
HEAD_DIR = os.environ.get("HEAD_DIR", "")
HEAD_REVISION = os.environ.get("HEAD_REVISION", "1308bba1f05b13e5f5e71b08f55e1486e0019bde")
BACKBONE = os.environ.get("BACKBONE", "google/embeddinggemma-300m")
BACKBONE_REVISION = os.environ.get("BACKBONE_REVISION", "57c266a740f537b4dc058e1b0cda161fd15afa75")
MAX_BODY = int(os.environ.get("CLASSIFIER_MAX_REQUEST", "4000000"))
TRAINED_HEAD_DIR = os.environ.get("TRAINED_HEAD_DIR", "")

_model: SentenceTransformer | None = None
_head: torch.nn.Linear | None = None
_device = "cpu"
_infer_lock = threading.Lock()
_trained_head: torch.nn.Linear | None = None
_trained_identity: dict = {}


def read_head(directory: str) -> torch.nn.Linear:
    """Validate a checkpoint completely before making it available for inference."""
    with open(os.path.join(directory, "meta.json"), encoding="utf-8") as stream:
        meta = json.load(stream)
    if meta.get("labels") != LABELS:
        raise ValueError("head label order does not match the proxy contract")
    weights = load_file(os.path.join(directory, "model.safetensors"))
    weight, bias = weights["head.head.weight"], weights["head.head.bias"]
    if tuple(weight.shape) != (len(LABELS), 768) or tuple(bias.shape) != (len(LABELS),):
        raise ValueError(f"unexpected head shape weight={tuple(weight.shape)} bias={tuple(bias.shape)}")
    if not torch.isfinite(weight).all() or not torch.isfinite(bias).all():
        raise ValueError("head contains non-finite weights")
    head = torch.nn.Linear(768, len(LABELS))
    with torch.no_grad():
        head.weight.copy_(weight)
        head.bias.copy_(bias)
    return head.eval().to(_device)


def reload_trained_head() -> dict:
    """Load a completed export; a failed reload never leaves stale weights active."""
    global _trained_head, _trained_identity
    with _infer_lock:
        _trained_head = None
        _trained_identity = {}
        if not TRAINED_HEAD_DIR:
            raise ValueError("TRAINED_HEAD_DIR is not configured")
        head = read_head(TRAINED_HEAD_DIR)
        with open(os.path.join(TRAINED_HEAD_DIR, "model.safetensors"), "rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        _trained_head = head
        _trained_identity = {"model": TRAINED_HEAD_DIR, "sha256": digest}
        return dict(_trained_identity)


def pick_device(requested: str) -> str:
    if requested != "auto":
        return requested
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load_models() -> None:
    """Load the frozen backbone and the linear head, then warm both of them."""
    global _model, _head, _device
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if not token and os.environ.get("HF_HUB_OFFLINE") != "1":
        raise SystemExit(
            "HF_TOKEN is required. Accept the license at "
            "https://huggingface.co/google/embeddinggemma-300m and export a read token."
        )
    if token:
        os.environ["HF_TOKEN"] = token
        os.environ["HUGGING_FACE_HUB_TOKEN"] = token

    _device = pick_device(os.environ.get("CLASSIFIER_DEVICE", "cpu"))
    print(f"loading backbone {BACKBONE}@{BACKBONE_REVISION} on {_device}", flush=True)
    _model = SentenceTransformer(BACKBONE, device=_device, revision=BACKBONE_REVISION)
    _model.max_seq_length = 2048

    if HEAD_DIR:
        print(f"loading local head {HEAD_DIR}", flush=True)
        head_dir = HEAD_DIR
    else:
        print(f"loading head {HEAD_REPO}@{HEAD_REVISION}", flush=True)
        head_dir = snapshot_download(
            repo_id=HEAD_REPO,
            revision=HEAD_REVISION,
            allow_patterns=["model.safetensors", "meta.json"],
            token=token,
        )
    try:
        _head = read_head(head_dir)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    if TRAINED_HEAD_DIR:
        try:
            reload_trained_head()
        except Exception as exc:
            print(f"trained head pending: {type(exc).__name__}: {exc}", flush=True)

    warmup = classify_text("method: GET\npath: /")
    print(
        f"classifier ready model={HEAD_DIR or HEAD_REPO} risk={warmup['risk']:.4f} top={warmup['top_label']}",
        flush=True,
    )


def classify_text(text: str, *, trained: bool = False) -> dict:
    """Embed one serialized request and return its class scores."""
    if _model is None or _head is None:
        raise RuntimeError("classifier is not loaded")
    with _infer_lock:
        head = _trained_head if trained else _head
        if head is None:
            raise RuntimeError("trained head is not loaded; export it and click Load trained head")
        with torch.inference_mode():
            embedding = _model.encode(
                [text],
                prompt=PROMPT,
                device=_device,
                convert_to_numpy=True,
                normalize_embeddings=False,
                show_progress_bar=False,
            )
            logits = head(torch.as_tensor(embedding, dtype=torch.float32, device=_device))
            probabilities = torch.sigmoid(logits)[0].detach().cpu().tolist()
        identity = dict(_trained_identity) if trained else {"model": HEAD_DIR or HEAD_REPO}
    return {
        "risk": attack_risk(LABELS, probabilities),
        "top_label": top_label(LABELS, probabilities),
        **identity,
        "head_revision": None if trained or HEAD_DIR else HEAD_REVISION,
        "backbone": BACKBONE,
        "backbone_revision": BACKBONE_REVISION,
        "labels": label_map(LABELS, probabilities),
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    timeout = int(os.environ.get("CLASSIFIER_SOCKET_TIMEOUT", "60"))

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] != "/health":
            self._send(404, {"error": "not found"})
            return
        with _infer_lock:
            trained = {"ready": _trained_head is not None, **_trained_identity}
        self._send(200, {"status": "ok", "model": HEAD_DIR or HEAD_REPO, "backbone": BACKBONE,
                         "head_revision": HEAD_REVISION if not HEAD_DIR else None,
                         "trained": trained})

    def do_POST(self) -> None:
        route = self.path.split("?", 1)[0]
        if route == "/reload-trained" and TRAINED_HEAD_DIR:
            try:
                identity = reload_trained_head()
                self._send(200, {"ready": True, **identity})
            except Exception as exc:
                self._send(409, {"error": f"Trained head unavailable: {type(exc).__name__}: {exc}"})
            self.close_connection = True
            return
        if route not in ("/classify", "/classify-trained"):
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send(400, {"error": "invalid content length"})
            return
        if length <= 0 or length > MAX_BODY:
            self._send(400, {"error": "request body is empty or too large"})
            return
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            self._send(400, {"error": "request body must be JSON"})
            return
        text = payload.get("text") if isinstance(payload, dict) else None
        if not isinstance(text, str):
            self._send(400, {"error": "text must be a string"})
            return
        try:
            result = classify_text(text, trained=True) if route == "/classify-trained" else classify_text(text)
        except Exception as exc:
            print(f"classification failed: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
            self._send(503, {"error": "classification failed"})
            return
        print(
            f"classified risk={result['risk']:.4f} top={result['top_label']}",
            flush=True,
        )
        self._send(200, result)

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main() -> None:
    load_models()
    port = int(os.environ.get("CLASSIFIER_PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"listening on {port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
