"""Verify local-head loading and the published-head fallback without model downloads."""

import json
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import torch

import app


class HeadLoadingTests(unittest.TestCase):
    def load(self, local: bool, labels=None):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            Path(directory, "meta.json").write_text(json.dumps({"labels": app.LABELS if labels is None else labels}))
            stack.enter_context(patch.dict(app.os.environ, {"HF_TOKEN": "test-token", "CLASSIFIER_DEVICE": "cpu"}))
            stack.enter_context(patch.object(app, "HEAD_DIR", directory if local else ""))
            backbone = stack.enter_context(patch.object(app, "SentenceTransformer"))
            download = stack.enter_context(patch.object(app, "snapshot_download", return_value=directory))
            weights = stack.enter_context(patch.object(app, "load_file", return_value={
                "head.head.weight": torch.zeros(len(app.LABELS), 768),
                "head.head.bias": torch.zeros(len(app.LABELS)),
            }))
            stack.enter_context(patch.object(app, "classify_text", return_value={"risk": 0.1, "top_label": app.LABELS[0]}))
            app.load_models()
            backbone.assert_called_once()
            weights.assert_called_once_with(str(Path(directory, "model.safetensors")))
            if local:
                download.assert_not_called()
            else:
                download.assert_called_once()

    def test_local_head_skips_head_download(self):
        self.load(local=True)

    def test_published_head_remains_default(self):
        self.load(local=False)

    def test_reordered_labels_are_rejected(self):
        with self.assertRaisesRegex(SystemExit, "label order"):
            self.load(local=True, labels=list(reversed(app.LABELS)))


if __name__ == "__main__":
    unittest.main()


class TrainedHeadTests(unittest.TestCase):
    def test_missing_export_clears_previous_head(self):
        with patch.object(app, "TRAINED_HEAD_DIR", "/missing/export"), patch.object(app, "_trained_head", object()):
            with self.assertRaises(FileNotFoundError):
                app.reload_trained_head()
            self.assertIsNone(app._trained_head)

    def test_trained_head_is_separate_and_has_weight_fingerprint(self):
        from safetensors.torch import save_file
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "meta.json").write_text(json.dumps({"labels": app.LABELS}))
            save_file({"head.head.weight": torch.zeros(len(app.LABELS), 768),
                       "head.head.bias": torch.zeros(len(app.LABELS))}, str(Path(directory, "model.safetensors")))
            original = object()
            with patch.object(app, "TRAINED_HEAD_DIR", directory), patch.object(app, "_head", original):
                identity = app.reload_trained_head()
                self.assertEqual(len(identity["sha256"]), 64)
                self.assertIs(app._head, original)
                self.assertIsNotNone(app._trained_head)

    def test_nonfinite_weights_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "meta.json").write_text(json.dumps({"labels": app.LABELS}))
            with patch.object(app, "load_file", return_value={
                "head.head.weight": torch.full((len(app.LABELS), 768), float("nan")),
                "head.head.bias": torch.zeros(len(app.LABELS))}):
                with self.assertRaisesRegex(ValueError, "non-finite"):
                    app.read_head(directory)
