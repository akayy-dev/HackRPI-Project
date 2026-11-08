import unittest

from scoring import LABELS, NORMAL_LABEL, attack_risk, top_label


def probabilities(**overrides: float) -> list[float]:
    scores = dict.fromkeys(LABELS, 0.0)
    scores.update(overrides)
    return [scores[label] for label in LABELS]


class AttackRiskTest(unittest.TestCase):
    def test_highest_attack_score_ignores_a_higher_normal_score(self):
        scores = probabilities(**{NORMAL_LABEL: 0.25, "66 - SQL Injection": 0.75})
        self.assertEqual(attack_risk(LABELS, scores), 0.75)
        self.assertEqual(top_label(LABELS, scores), "66 - SQL Injection")

    def test_normal_can_be_the_top_label_while_risk_stays_low(self):
        scores = probabilities(**{NORMAL_LABEL: 1.0, "126 - Path Traversal": 0.25})
        self.assertEqual(attack_risk(LABELS, scores), 0.25)
        self.assertEqual(top_label(LABELS, scores), NORMAL_LABEL)

    def test_rejects_a_different_label_order(self):
        with self.assertRaises(ValueError):
            attack_risk(list(reversed(LABELS)), probabilities())

    def test_rejects_non_finite_scores(self):
        scores = probabilities()
        scores[0] = float("nan")
        with self.assertRaises(ValueError):
            attack_risk(LABELS, scores)


if __name__ == "__main__":
    unittest.main()
