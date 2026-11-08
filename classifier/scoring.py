"""Score reduction for the Valendra HTTP threat classifier.

The published head emits 14 independent sigmoid scores. Riskiness for the
reverse proxy is the highest score among the attack classes. "000 - Normal"
stays available as the top label, and it does not lower an attack score.
"""

from __future__ import annotations

NORMAL_LABEL = "000 - Normal"

# Label order from valendra/threat-classifier-13082026 meta.json.
LABELS = [
    "000 - Normal",
    "272 - Protocol Manipulation",
    "242 - Code Injection",
    "88 - OS Command Injection",
    "126 - Path Traversal",
    "66 - SQL Injection",
    "16 - Dictionary-based Password Attack",
    "310 - Scanning for Vulnerable Software",
    "153 - Input Data Manipulation",
    "248 - Command Injection",
    "274 - HTTP Verb Tampering",
    "194 - Fake the Source of Data",
    "34 - HTTP Response Splitting",
    "33 - HTTP Request Smuggling",
]

PROMPT = "task: classification | query: "


def attack_risk(labels: list[str], probabilities: list[float]) -> float:
    """Return the highest finite attack-class probability in [0, 1]."""
    if len(labels) != len(probabilities):
        raise ValueError("label and probability counts differ")
    if labels != LABELS:
        raise ValueError("label order does not match the published head")
    scores = []
    for label, probability in zip(labels, probabilities):
        score = float(probability)
        if score != score or score in (float("inf"), float("-inf")):
            raise ValueError(f"non-finite score for {label}")
        if label != NORMAL_LABEL:
            scores.append(score)
    if not scores:
        raise ValueError("no attack-class scores")
    risk = max(scores)
    if risk < 0:
        risk = 0.0
    if risk > 1:
        risk = 1.0
    return risk


def top_label(labels: list[str], probabilities: list[float]) -> str:
    """Return the class with the highest score, including Normal."""
    if len(labels) != len(probabilities) or not labels:
        raise ValueError("label and probability counts differ")
    best = max(range(len(labels)), key=lambda index: float(probabilities[index]))
    return labels[best]


def label_map(labels: list[str], probabilities: list[float]) -> dict[str, float]:
    """Pair each class with its sigmoid score."""
    if len(labels) != len(probabilities):
        raise ValueError("label and probability counts differ")
    return {label: float(probability) for label, probability in zip(labels, probabilities)}
