import contextlib
import csv
import io
import ipaddress
import random
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from rewrite_proxy_dataset import CONNECTION_FIELDS, LABELS, prepare, rewrite


class RewriteDatasetTests(unittest.TestCase):
    def test_disjoint_samples_preserve_payload_and_labels(self):
        now = datetime(2026, 11, 7, 22, tzinfo=timezone.utc)
        rows = []
        for label, count in [(LABELS[0], 100), (LABELS[5], 30), (LABELS[9], 5), (LABELS[13], 3)]:
            for _ in range(count):
                row = {name: "" for name in CONNECTION_FIELDS}
                row.update({name: str(int(name == label)) for name in LABELS})
                row.update(request_http_request=f"/search?q=%27%2f+{len(rows)}",
                           request_body=f"value=%60sleep+15%60&id={len(rows)}",
                           request_http_method="POST", request_host="test-site.com")
                rows.append(row)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.csv"
            with source.open("w", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
                writer.writeheader()
                writer.writerows(rows)
            with contextlib.redirect_stdout(io.StringIO()):
                report = prepare(source, root / "train.csv", root / "holdout.csv", 60, 20, now=now)
            train_indices = report["training"]["source_row_indices"]
            holdout_indices = report["holdout"]["source_row_indices"]
            self.assertEqual(len(train_indices), 60)
            self.assertEqual(len(holdout_indices), 20)
            self.assertFalse(set(train_indices) & set(holdout_indices))
            self.assertEqual(report["dropped_command_only"], 5)
            for name, indices in [("train", train_indices), ("holdout", holdout_indices)]:
                with (root / f"{name}.csv").open(newline="") as stream:
                    output = list(csv.DictReader(stream))
                for row, index in zip(output, indices):
                    for column in row:
                        if column not in CONNECTION_FIELDS:
                            self.assertEqual(row[column], rows[index][column])
                    stamp = datetime.strptime(row["timestamp"], "%d/%b/%Y:%H:%M:%S %z")
                    self.assertTrue(now - timedelta(days=30) <= stamp <= now)
                    address = ipaddress.ip_address(row["src_ip"])
                    self.assertTrue(address in ipaddress.ip_network("192.168.65.0/24")
                                    or address in ipaddress.ip_network("10.0.0.0/8"))
                    self.assertTrue(1024 <= int(row["src_port"]) <= 65535)
                    self.assertEqual((row["dst_ip"], row["dst_port"], row["request_accept"]),
                                     ("172.18.0.4", "8080", "*/*"))
                self.assertGreater(len({row["timestamp"] for row in output}), 1)
            original = (root / "train.csv").read_bytes()
            with contextlib.redirect_stdout(io.StringIO()):
                prepare(source, root / "train.csv", root / "holdout.csv", 60, 20, now=now)
            self.assertEqual((root / "train.csv").read_bytes(), original)

    def test_existing_accept_is_preserved(self):
        row = {name: "" for name in CONNECTION_FIELDS}
        row["request_accept"] = "text/html"
        self.assertEqual(rewrite(row, random.Random(42), datetime.now(timezone.utc))["request_accept"], "text/html")

    def test_rejects_missing_labels_and_invalid_values(self):
        from rewrite_proxy_dataset import primary_label
        for value in ["2", "", "nan"]:
            row = {name: "0" for name in LABELS}
            row[LABELS[0]] = value
            with self.assertRaises(ValueError):
                primary_label(row, 2)
        with self.assertRaises(ValueError):
            primary_label({name: "0" for name in LABELS}, 2)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "source.csv").write_text("timestamp\nnow\n")
            with self.assertRaisesRegex(ValueError, "missing required columns"):
                prepare(root / "source.csv", root / "train.csv", root / "holdout.csv")


if __name__ == "__main__":
    unittest.main()
