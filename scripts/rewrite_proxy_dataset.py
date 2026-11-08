"""Stream CAPEC data into disjoint, stratified proxy-shaped CSV samples."""

from __future__ import annotations

import argparse
import csv
import ipaddress
import json
import random
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "classifier"))
from scoring import LABELS

csv.field_size_limit(sys.maxsize)
CONNECTION_FIELDS = ("timestamp", "src_ip", "src_port", "dst_ip", "dst_port", "request_accept")


def primary_label(row: dict[str, str], line: int) -> str | None:
    values = [row[label] for label in LABELS]
    if any(value not in ("0", "1") for value in values):
        raise ValueError(f"row {line}: labels must be 0 or 1")
    active = [label for label, value in zip(LABELS, values) if value == "1"]
    if not active:
        raise ValueError(f"row {line}: no positive label")
    return None if active == ["248 - Command Injection"] else active[0]


def read_rows(source: Path):
    with source.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        missing = [name for name in [*LABELS, *CONNECTION_FIELDS]
                   if name not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"missing required columns: {missing}")
        for index, row in enumerate(reader):
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"row {index + 2}: malformed CSV")
            yield index, row, primary_label(row, index + 2)


def quotas(counts: dict[str, int], total: int, minimum: int) -> dict[str, int]:
    """Allocate proportionally, with a floor to retain rare primary classes."""
    total = min(total, sum(counts.values()))
    result = {label: min(minimum, count) for label, count in counts.items()}
    if total < sum(result.values()):
        raise ValueError("sample size is too small to preserve primary classes")
    remaining = total - sum(result.values())
    capacity = {label: counts[label] - result[label] for label in counts}
    if remaining:
        capacity_total = sum(capacity.values())
        shares = {label: remaining * capacity[label] / capacity_total for label in counts}
        for label in counts:
            result[label] += int(shares[label])
        for label in sorted(counts, key=lambda label: -(shares[label] % 1))[:total - sum(result.values())]:
            result[label] += 1
    return result


def rewrite(row: dict[str, str], rng: random.Random, now: datetime) -> dict[str, str]:
    row = row.copy()
    stamp = now - timedelta(seconds=rng.randrange(30 * 24 * 60 * 60))
    months = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    row["timestamp"] = f"{stamp.day:02d}/{months[stamp.month-1]}/{stamp.year}:{stamp:%H:%M:%S} +0000"
    network, size = ("192.168.65.0", 256) if rng.randrange(2) else ("10.0.0.0", 1 << 24)
    row["src_ip"] = str(ipaddress.IPv4Address(int(ipaddress.IPv4Address(network)) + rng.randrange(size)))
    row["src_port"] = str(rng.randint(1024, 65535))
    row["dst_ip"] = "172.18.0.4"
    row["dst_port"] = "8080"
    if not row["request_accept"]:
        row["request_accept"] = "*/*"
    return row


def prepare(source: Path, train_path: Path, holdout_path: Path, train_size: int = 30000,
            holdout_size: int = 500, seed: int = 42, now: datetime | None = None) -> dict:
    if train_size <= 0 or holdout_size <= 0:
        raise ValueError("both output sizes must be positive")
    if len({source.resolve(), train_path.resolve(), holdout_path.resolve()}) != 3:
        raise ValueError("source and output paths must be distinct")
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    counts = Counter()
    dropped = 0
    for _, _, label in read_rows(source):
        if label is None:
            dropped += 1
        else:
            counts[label] += 1
    # Keep at least ten trainer rows and one external holdout row per class.
    eligible = {label: counts[label] for label in LABELS if counts[label] >= 11}
    if not eligible:
        raise ValueError("no primary classes have enough rows for training and holdout")
    train_quota = quotas({label: count - 1 for label, count in eligible.items()}, train_size, 10)
    holdout_quota = quotas({label: eligible[label] - train_quota[label] for label in eligible}, holdout_size, 1)
    capacity = {label: train_quota[label] + holdout_quota[label] for label in eligible}
    reservoirs = {label: [] for label in eligible}
    seen = Counter()
    rng = random.Random(seed)
    fields = None
    for index, row, label in read_rows(source):
        fields = list(row)
        if label not in eligible:
            continue
        seen[label] += 1
        sample = reservoirs[label]
        if len(sample) < capacity[label]:
            sample.append((index, row))
        else:
            slot = rng.randrange(seen[label])
            if slot < capacity[label]:
                sample[slot] = (index, row)
    train, holdout = [], []
    for label, sample in reservoirs.items():
        rng.shuffle(sample)
        train.extend(sample[:train_quota[label]])
        holdout.extend(sample[train_quota[label]:])
    rng.shuffle(train)
    rng.shuffle(holdout)
    # Separate RNG: metadata generation never branches on the label.
    metadata_rng = random.Random(seed + 1)
    report = {"seed": seed, "as_of": now.isoformat(), "source_counts": dict(counts),
              "dropped_command_only": dropped,
              "dropped_rare_primary": {label: count for label, count in counts.items() if label not in eligible}}
    for name, path, sample in [("training", train_path, train), ("holdout", holdout_path, holdout)]:
        if not sample:
            raise ValueError(f"{name} output is empty")
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            for _, row in sample:
                writer.writerow(rewrite(row, metadata_rng, now))
        label_counts = Counter(primary_label(row, index + 2) for index, row in sample)
        report[name] = {"path": str(path), "rows": len(sample), "primary_counts": dict(label_counts),
                        "source_row_indices": [index for index, _ in sample]}
        print(f"{name}: {len(sample)} rows -> {path}")
        for label in LABELS:
            print(f"  {label}: {label_counts[label]}")
    assert not set(report["training"]["source_row_indices"]) & set(report["holdout"]["source_row_indices"])
    train_path.with_suffix(".manifest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("data/data_capec_multilabel.csv"))
    parser.add_argument("--train", type=Path, default=Path("data/proxy_shaped.csv"))
    parser.add_argument("--holdout", type=Path, default=Path("data/proxy_shaped_holdout.csv"))
    parser.add_argument("--train-size", type=int, default=30000)
    parser.add_argument("--holdout-size", type=int, default=500)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--as-of", type=datetime.fromisoformat, help="ISO timestamp for reproducible reruns")
    args = parser.parse_args()
    prepare(args.input, args.train, args.holdout, args.train_size, args.holdout_size, args.seed, args.as_of)


if __name__ == "__main__":
    main()
