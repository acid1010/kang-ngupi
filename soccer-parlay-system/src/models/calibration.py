"""Model calibration utilities.

Implements Platt scaling and calibration diagnostics per Walsh & Joshi (2024):
"Calibration is more important than accuracy for profitable betting."
"""

import json
import os
from typing import Optional

import numpy as np

from src.utils.helpers import get_project_root
from src.utils.logger import get_logger

log = get_logger("calibration")


class PlattScaler:
    """Platt scaling (logistic calibration) for probability estimates.

    Maps raw model probabilities to calibrated probabilities using:
    P_calibrated = 1 / (1 + exp(A * p_raw + B))

    Parameters A and B are fitted on historical data.
    """

    def __init__(self):
        self.A = -1.0  # Default: identity-ish mapping
        self.B = 0.0
        self.fitted = False

    def fit(self, predicted_probs: np.ndarray, actual_outcomes: np.ndarray,
            max_iter: int = 100, lr: float = 0.01) -> None:
        """Fit Platt scaling parameters using gradient descent.

        Args:
            predicted_probs: Array of model's predicted probabilities
            actual_outcomes: Array of binary outcomes (1 = event occurred)
        """
        if len(predicted_probs) < 20:
            log.warning("Too few samples for reliable calibration fitting")
            return

        # Initialize
        A, B = -1.0, 0.0
        n = len(predicted_probs)

        for iteration in range(max_iter):
            # Forward pass
            logits = A * predicted_probs + B
            calibrated = 1.0 / (1.0 + np.exp(-logits))
            calibrated = np.clip(calibrated, 1e-7, 1 - 1e-7)

            # Log loss gradient
            error = calibrated - actual_outcomes
            grad_A = np.mean(error * predicted_probs)
            grad_B = np.mean(error)

            A -= lr * grad_A
            B -= lr * grad_B

            # Log loss
            if iteration % 20 == 0:
                loss = -np.mean(
                    actual_outcomes * np.log(calibrated) +
                    (1 - actual_outcomes) * np.log(1 - calibrated)
                )
                log.debug(f"Platt fit iter {iteration}: loss={loss:.4f}, A={A:.4f}, B={B:.4f}")

        self.A = A
        self.B = B
        self.fitted = True
        log.info(f"Platt scaling fitted: A={A:.4f}, B={B:.4f}")

    def calibrate(self, prob: float) -> float:
        """Apply Platt scaling to a single probability."""
        if not self.fitted:
            return prob  # Pass through if not fitted

        logit = self.A * prob + self.B
        return 1.0 / (1.0 + np.exp(-logit))

    def calibrate_array(self, probs: np.ndarray) -> np.ndarray:
        """Apply Platt scaling to an array of probabilities."""
        if not self.fitted:
            return probs

        logits = self.A * probs + self.B
        return 1.0 / (1.0 + np.exp(-logits))

    def save(self, path: str = None) -> None:
        """Save calibration parameters."""
        if path is None:
            path = str(get_project_root() / "models" / "platt_params.json")

        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump({"A": self.A, "B": self.B, "fitted": self.fitted}, f)
        log.info(f"Saved Platt parameters to {path}")

    def load(self, path: str = None) -> bool:
        """Load calibration parameters."""
        if path is None:
            path = str(get_project_root() / "models" / "platt_params.json")

        if not os.path.exists(path):
            log.info("No saved Platt parameters found")
            return False

        with open(path, "r") as f:
            params = json.load(f)

        self.A = params.get("A", -1.0)
        self.B = params.get("B", 0.0)
        self.fitted = params.get("fitted", False)
        log.info(f"Loaded Platt parameters: A={self.A:.4f}, B={self.B:.4f}")
        return True


def compute_calibration_stats(predicted: np.ndarray, actual: np.ndarray,
                              n_bins: int = 10) -> dict:
    """Compute calibration statistics (reliability diagram data).

    Args:
        predicted: Predicted probabilities
        actual: Binary outcomes

    Returns:
        Dict with bin data for reliability diagram and summary metrics.
    """
    bins = np.linspace(0, 1, n_bins + 1)
    bin_data = []

    for i in range(n_bins):
        mask = (predicted >= bins[i]) & (predicted < bins[i + 1])
        if mask.sum() == 0:
            continue

        bin_pred = predicted[mask].mean()
        bin_actual = actual[mask].mean()
        bin_count = mask.sum()

        bin_data.append({
            "bin_center": round((bins[i] + bins[i + 1]) / 2, 3),
            "predicted_mean": round(float(bin_pred), 4),
            "actual_mean": round(float(bin_actual), 4),
            "count": int(bin_count),
            "gap": round(abs(float(bin_pred) - float(bin_actual)), 4),
        })

    # Expected Calibration Error (ECE)
    total = len(predicted)
    ece = sum(b["count"] / total * b["gap"] for b in bin_data) if total > 0 else 0

    # Brier score
    brier = float(np.mean((predicted - actual) ** 2))

    return {
        "bins": bin_data,
        "ece": round(ece, 4),
        "brier_score": round(brier, 4),
        "n_samples": total,
    }
