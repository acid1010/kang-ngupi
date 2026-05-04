#!/usr/bin/env python3
"""Train Platt scaling calibrator from historical backtest data."""

import os, sys, json, pickle
from pathlib import Path

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

DATA_DIR = Path(__file__).parent / "data" / "historical"
MODEL_DIR = Path(__file__).parent / "data" / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)


def sigmoid(x, a, b):
    return 1.0 / (1.0 + np.exp(-(a * x + b)))


def train():
    cal_file = DATA_DIR / "calibration_pairs.json"
    if not cal_file.exists():
        print("Run historical_backtest.py first!")
        return

    with open(cal_file) as f:
        pairs = json.load(f)

    preds = np.array([p[0] for p in pairs])
    actuals = np.array([p[1] for p in pairs])

    # Split 80/20
    n = len(preds)
    idx = np.random.RandomState(42).permutation(n)
    split = int(n * 0.8)
    train_idx, val_idx = idx[:split], idx[split:]

    train_p, train_a = preds[train_idx], actuals[train_idx]
    val_p, val_a = preds[val_idx], actuals[val_idx]

    # Before calibration metrics
    brier_before = np.mean((val_p - val_a) ** 2)
    ece_before = calc_ece(val_p, val_a)

    # Fit Platt scaling: logistic regression on log-odds
    from scipy.optimize import minimize

    def neg_log_likelihood(params):
        a, b = params
        calibrated = sigmoid(train_p, a, b)
        calibrated = np.clip(calibrated, 1e-7, 1 - 1e-7)
        return -np.mean(train_a * np.log(calibrated) + (1 - train_a) * np.log(1 - calibrated))

    result = minimize(neg_log_likelihood, [1.0, 0.0], method="Nelder-Mead")
    a_opt, b_opt = result.x

    # After calibration metrics
    val_calibrated = sigmoid(val_p, a_opt, b_opt)
    brier_after = np.mean((val_calibrated - val_a) ** 2)
    ece_after = calc_ece(val_calibrated, val_a)

    print("\n" + "=" * 50)
    print("  CALIBRATION TRAINING RESULTS")
    print("=" * 50)
    print(f"  Training samples: {len(train_p)}")
    print(f"  Validation samples: {len(val_p)}")
    print(f"  Platt params: a={a_opt:.4f}, b={b_opt:.4f}")
    print(f"\n  {'Metric':<20} {'Before':>10} {'After':>10} {'Change':>10}")
    print(f"  {'Brier Score':<20} {brier_before:>10.4f} {brier_after:>10.4f} {brier_after-brier_before:>+10.4f}")
    print(f"  {'ECE':<20} {ece_before:>10.4f} {ece_after:>10.4f} {ece_after-ece_before:>+10.4f}")

    # Reliability diagram
    print(f"\n  Reliability Diagram (validation set):")
    print(f"  {'Bin':>8} {'Predicted':>10} {'Actual':>10} {'Count':>8} {'Gap':>8}")
    bins = np.linspace(0, 1, 11)
    for i in range(10):
        mask = (val_calibrated >= bins[i]) & (val_calibrated < bins[i+1])
        if mask.sum() > 0:
            avg_p = val_calibrated[mask].mean()
            avg_a = val_a[mask].mean()
            print(f"  {bins[i]:.1f}-{bins[i+1]:.1f} {avg_p:>10.3f} {avg_a:>10.3f} {mask.sum():>8} {abs(avg_p-avg_a):>8.3f}")

    # Save calibrator
    calibrator = {"a": float(a_opt), "b": float(b_opt), "type": "platt"}
    cal_path = MODEL_DIR / "calibrator.pkl"
    with open(cal_path, "wb") as f:
        pickle.dump(calibrator, f)
    print(f"\n  Calibrator saved to {cal_path}")

    # Also save as JSON for portability
    with open(MODEL_DIR / "calibrator.json", "w") as f:
        json.dump(calibrator, f, indent=2)

    print("=" * 50)
    return calibrator


def calc_ece(preds, actuals, n_bins=10):
    bins = np.linspace(0, 1, n_bins + 1)
    ece = 0
    for i in range(n_bins):
        mask = (preds >= bins[i]) & (preds < bins[i+1])
        if mask.sum() > 0:
            ece += abs(preds[mask].mean() - actuals[mask].mean()) * mask.sum() / len(preds)
    return ece


if __name__ == "__main__":
    train()
