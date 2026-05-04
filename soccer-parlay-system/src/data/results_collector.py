"""Prediction/result persistence helpers.

Stores daily predictions to disk so they can be evaluated later against
finished match results.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from src.utils.helpers import get_project_root
from src.utils.logger import get_logger

log = get_logger("results_collector")


class ResultsCollector:
    """Persist prediction snapshots for later evaluation."""

    def __init__(self):
        self.root = get_project_root() / "data"
        self.predictions_dir = self.root / "predictions"
        self.results_dir = self.root / "results"
        self.predictions_dir.mkdir(parents=True, exist_ok=True)
        self.results_dir.mkdir(parents=True, exist_ok=True)

    def save_predictions(
        self,
        matches: list[dict[str, Any]],
        value_bets: list[dict[str, Any]],
        parlays: list[dict[str, Any]],
        run_meta: dict[str, Any] | None = None,
        date_str: str | None = None,
    ) -> Path:
        """Save a daily prediction snapshot.

        Args:
            matches: model-enriched matches from daily run
            value_bets: detected value bets
            parlays: suggested parlays
            run_meta: extra metadata (bankroll, totals, etc.)
            date_str: YYYY-MM-DD override
        """
        stamp = datetime.now()
        day = date_str or stamp.strftime("%Y-%m-%d")
        path = self.predictions_dir / f"{day}.json"

        payload = {
            "saved_at": stamp.isoformat(),
            "meta": run_meta or {},
            "matches": matches,
            "value_bets": value_bets,
            "parlays": parlays,
        }

        with open(path, "w") as f:
            json.dump(payload, f, indent=2, default=str)

        log.info(f"Predictions saved to {path}")
        return path

    def load_predictions(self, date_str: str) -> dict[str, Any] | None:
        path = self.predictions_dir / f"{date_str}.json"
        if not path.exists():
            return None
        with open(path, "r") as f:
            return json.load(f)

    def save_results(self, date_str: str, results_payload: dict[str, Any]) -> Path:
        path = self.results_dir / f"{date_str}.json"
        with open(path, "w") as f:
            json.dump(results_payload, f, indent=2, default=str)
        log.info(f"Results saved to {path}")
        return path
