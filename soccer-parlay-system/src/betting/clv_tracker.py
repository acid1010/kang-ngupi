"""Closing Line Value (CLV) tracking helpers."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from src.utils.helpers import get_project_root, implied_probability
from src.utils.logger import get_logger

log = get_logger("clv_tracker")


class CLVTracker:
    def __init__(self):
        self.root = get_project_root() / "data" / "clv"
        self.root.mkdir(parents=True, exist_ok=True)

    def save_opening_snapshot(self, date_str: str, value_bets: list[dict[str, Any]]) -> Path:
        payload = {
            "saved_at": datetime.now().isoformat(),
            "value_bets": [
                {
                    "match_id": vb.get("match_id"),
                    "home_team": vb.get("home_team"),
                    "away_team": vb.get("away_team"),
                    "selection": vb.get("selection"),
                    "market": vb.get("market"),
                    "opening_odds": vb.get("odds"),
                    "opening_implied_prob": vb.get("implied_prob"),
                    "bookmaker": vb.get("bookmaker"),
                }
                for vb in value_bets
            ],
        }
        path = self.root / f"{date_str}.json"
        with open(path, "w") as f:
            json.dump(payload, f, indent=2, default=str)
        log.info(f"CLV opening snapshot saved to {path}")
        return path

    def load_snapshot(self, date_str: str) -> dict[str, Any] | None:
        path = self.root / f"{date_str}.json"
        if not path.exists():
            return None
        with open(path, "r") as f:
            return json.load(f)

    def compare_with_current(self, snapshot: dict[str, Any], current_value_bets: list[dict[str, Any]]) -> dict[str, Any]:
        current_map = {
            (vb.get("match_id"), vb.get("selection"), vb.get("market")): vb
            for vb in current_value_bets
        }
        rows = []
        for row in snapshot.get("value_bets", []):
            key = (row.get("match_id"), row.get("selection"), row.get("market"))
            now = current_map.get(key)
            if not now:
                continue
            opening_imp = row.get("opening_implied_prob") or implied_probability(row.get("opening_odds") or 0)
            closing_imp = now.get("implied_prob") or implied_probability(now.get("odds") or 0)
            clv = 0.0
            if opening_imp:
                clv = (closing_imp - opening_imp) / opening_imp
            rows.append({
                **row,
                "closing_odds": now.get("odds"),
                "closing_implied_prob": closing_imp,
                "clv": clv,
                "market_moved_toward_us": clv > 0,
            })
        return {
            "checked_at": datetime.now().isoformat(),
            "count": len(rows),
            "items": rows,
            "avg_clv": sum(r["clv"] for r in rows) / len(rows) if rows else 0.0,
        }
