"""Compare the author's fixtures with live proxy decisions and an external holdout."""

from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "classifier"))
from scoring import LABELS


def command(args: list[str], **kwargs) -> str:
    return subprocess.run(args, text=True, capture_output=True, check=True, **kwargs).stdout


def classify(text: str) -> dict:
    client = (
        "import sys,urllib.request; "
        "data=sys.stdin.buffer.read(); "
        "request=urllib.request.Request('http://127.0.0.1:8000/classify',data=data,"
        "headers={'Content-Type':'application/json'}); "
        "print(urllib.request.urlopen(request,timeout=120).read().decode())"
    )
    return json.loads(command(["docker", "exec", "-i", "vivian-demo-classifier-1", "python", "-c", client],
                              input=json.dumps({"text": text})))


def proxy_request(row: dict[str, str]) -> dict:
    since = datetime.now(timezone.utc).isoformat()
    path = row["request_http_request"]
    if not path.startswith("/"):
        path = "/" + path
    args = ["curl", "--globoff", "--path-as-is", "--silent", "--show-error", "--max-time", "120",
            "--output", "/dev/null", "--write-out", "%{http_code}",
            "--request", row["request_http_method"], "http://127.0.0.1:8080" + path]
    headers = {"request_user_agent": "User-Agent", "request_host": "Host", "request_referer": "Referer",
               "request_origin": "Origin", "request_cookie": "Cookie", "request_content_type": "Content-Type",
               "request_accept": "Accept", "request_accept_language": "Accept-Language",
               "request_accept_encoding": "Accept-Encoding", "request_do_not_track": "DNT",
               "request_connection": "Connection"}
    for field, header in headers.items():
        if row.get(field):
            args.extend(["--header", f"{header}: {row[field]}"])
    if row.get("request_body"):
        args.extend(["--data-binary", row["request_body"]])
    status = int(command(args))
    logs = subprocess.run(["docker", "logs", "--since", since, "vivian-demo-proxy-1"],
                          text=True, capture_output=True, check=True)
    decisions = [line for line in (logs.stdout + logs.stderr).splitlines() if 'msg="Classified request"' in line]
    decisions = [line for line in decisions if f"method={row['request_http_method']}" in line]
    if len(decisions) != 1:
        raise RuntimeError(f"expected exactly one proxy decision, found {len(decisions)}")
    line = decisions[0]
    risk = float(re.search(r"\brisk=([^ ]+)", line).group(1))
    top = re.search(r'\btop_label="([^"]+)"', line).group(1)
    return {"top_label": top, "risk": risk, "http_status": status, "decision_log": line}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trainer", type=Path, default=Path("/private/tmp/hackrpi-valendra-trainer"))
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/proxy-head/verification.json")
    parser.add_argument("--holdout-count", type=int, default=20)
    args = parser.parse_args()
    sys.path.insert(0, str(args.trainer / "src"))
    from threat_classifier.constants import LABELS as AUTHOR_LABELS
    from threat_classifier.serialize import serialize_request
    assert AUTHOR_LABELS == LABELS
    report = {"tested_at": datetime.now(timezone.utc).isoformat(), "cases": [], "holdout": []}
    cases = [("normal", [LABELS[0]]), ("normal_v2", [LABELS[0]]),
             ("sql_injection", [LABELS[5]]), ("sql_injection_v2", [LABELS[5]]),
             ("path_traversal", [LABELS[4]]), ("command_injection", [LABELS[3]])]
    for name, expected in cases:
        row = json.loads((args.trainer / "examples_request" / f"{name}.json").read_text())
        original = classify(serialize_request(row))
        proxy = proxy_request(row)
        for result in [original, proxy]:
            result["meets_expectation"] = result["top_label"] in expected
            if name == "command_injection":
                result["meets_expectation"] |= result["top_label"] != LABELS[0]
        report["cases"].append({"case": name, "expected": expected, "original": original, "proxy": proxy})
        for kind, result in [("original", original), ("proxy", proxy)]:
            print(f"{name} {kind}: top={result['top_label']} risk={result['risk']:.6f}", flush=True)
    with (ROOT / "data/proxy_shaped_holdout.csv").open(newline="") as stream:
        for index, row in enumerate(csv.DictReader(stream)):
            if index >= args.holdout_count:
                break
            expected = next(label for label in LABELS if row[label] == "1")
            result = classify(serialize_request(row))
            report["holdout"].append({"row": index, "expected_primary": expected,
                                      "top_label": result["top_label"], "risk": result["risk"],
                                      "primary_correct": result["top_label"] == expected,
                                      "any_positive_correct": row[result["top_label"]] == "1"})
            print(f"holdout {index + 1}: expected={expected} top={result['top_label']} risk={result['risk']:.6f}", flush=True)
    if report["holdout"]:
        count = len(report["holdout"])
        correct = sum(row["primary_correct"] for row in report["holdout"])
        report["holdout_summary"] = {"rows": count, "primary_correct": correct,
                                     "top_class_accuracy": correct / count,
                                     "any_positive_accuracy": sum(row["any_positive_correct"] for row in report["holdout"]) / count}
        print(f"holdout top-class accuracy: {correct}/{count} = {correct / count:.1%}", flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"results saved to {args.output}", flush=True)


if __name__ == "__main__":
    main()
