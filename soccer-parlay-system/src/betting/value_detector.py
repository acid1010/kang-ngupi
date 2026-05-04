"""Value bet detection — compare model probabilities vs bookmaker implied probabilities.

Implements edge detection based on:
- Dmochowski (2023): Quantile-based edge estimation using median
- Standard: model_prob - implied_prob > threshold
"""

from typing import Optional

from src.utils.helpers import load_config, implied_probability, remove_vig, format_pct
from src.utils.logger import get_logger

log = get_logger("value_detector")


class ValueDetector:
    """Detect value bets by comparing model vs. market probabilities."""

    def __init__(self):
        cfg = load_config()
        betting = cfg.get("betting", {})
        self.min_edge = betting.get("min_edge", 0.05)
        self.min_odds = betting.get("abs_min_odds", 1.20)
        self.max_odds = betting.get("abs_max_odds", 4.00)
        self.sweet_min = betting.get("min_odds_per_leg", 1.50)
        self.sweet_max = betting.get("max_odds_per_leg", 2.50)

    def detect_value(self, match: dict) -> list[dict]:
        """Find value bets in a single match.

        Checks all available markets (1X2, over/under) for edges.

        Args:
            match: Enriched match dict with model_predictions and best_odds.

        Returns:
            List of value bet dicts, each containing:
            - match info, market, selection
            - model_prob, implied_prob, edge
            - odds, bookmaker
            - in_sweet_spot flag
        """
        predictions = match.get("model_predictions", {})
        probs = predictions.get("probabilities", {})
        best_odds = match.get("best_odds", {})
        ou_data = predictions.get("over_under", {})
        ou_odds = match.get("over_under")

        value_bets = []

        # Check 1X2 markets (draw excluded — Phase 2 strategy)
        markets = [
            ("home_win", "home", probs.get("home_win", 0), best_odds.get("home", {})),
            ("away_win", "away", probs.get("away_win", 0), best_odds.get("away", {})),
        ]

        for market_name, selection, model_prob, odds_info in markets:
            odds = odds_info.get("odds", 0)
            bookmaker = odds_info.get("bookmaker", "")

            if odds < self.min_odds or odds > self.max_odds:
                continue

            implied = implied_probability(odds)
            edge = model_prob - implied

            if edge >= self.min_edge:
                value_bets.append(self._build_value_bet(
                    match, market_name, selection, model_prob,
                    implied, edge, odds, bookmaker
                ))

        # Check Over/Under 2.5
        if ou_odds and ou_data:
            over_prob = ou_data.get("over_2.5", 0)
            under_prob = ou_data.get("under_2.5", 0)
            over_odds = ou_odds.get("over_odds", 0)
            under_odds = ou_odds.get("under_odds", 0)
            ou_book = ou_odds.get("bookmaker", "")

            # Over 2.5
            if over_odds >= self.min_odds and over_odds <= self.max_odds:
                implied = implied_probability(over_odds)
                edge = over_prob - implied
                if edge >= self.min_edge:
                    value_bets.append(self._build_value_bet(
                        match, "over_2.5", "Over 2.5", over_prob,
                        implied, edge, over_odds, ou_book
                    ))

            # Under 2.5
            if under_odds >= self.min_odds and under_odds <= self.max_odds:
                implied = implied_probability(under_odds)
                edge = under_prob - implied
                if edge >= self.min_edge:
                    value_bets.append(self._build_value_bet(
                        match, "under_2.5", "Under 2.5", under_prob,
                        implied, edge, under_odds, ou_book
                    ))

        return value_bets

    def _build_value_bet(self, match: dict, market: str, selection: str,
                         model_prob: float, implied_prob: float, edge: float,
                         odds: float, bookmaker: str) -> dict:
        """Build a standardized value bet record."""
        in_sweet = self.sweet_min <= odds <= self.sweet_max

        # Confidence level based on edge size
        if edge >= 0.15:
            confidence = "HIGH"
        elif edge >= 0.10:
            confidence = "MEDIUM"
        else:
            confidence = "LOW"

        # Expected value of a $1 bet
        ev = model_prob * odds - 1.0

        return {
            "match_id": match.get("match_id", ""),
            "home_team": match.get("home_team", ""),
            "away_team": match.get("away_team", ""),
            "league": match.get("league", ""),
            "league_code": match.get("league_code", ""),
            "commence_time": match.get("commence_time", ""),
            "sport_key": match.get("sport_key", ""),
            "market": market,
            "selection": selection,
            "model_prob": round(model_prob, 4),
            "implied_prob": round(implied_prob, 4),
            "edge": round(edge, 4),
            "odds": odds,
            "bookmaker": bookmaker,
            "expected_value": round(ev, 4),
            "confidence": confidence,
            "in_sweet_spot": in_sweet,
        }

    def detect_all_value(self, predicted_matches: list[dict]) -> list[dict]:
        """Find all value bets across all predicted matches.

        Returns sorted by edge (descending).
        """
        all_value = []

        for match in predicted_matches:
            value_bets = self.detect_value(match)
            all_value.extend(value_bets)

        # Sort by edge descending
        all_value.sort(key=lambda x: x["edge"], reverse=True)

        total_matches = len(predicted_matches)
        matches_with_value = len(set(v["match_id"] for v in all_value))
        skip_pct = (total_matches - matches_with_value) / total_matches * 100 if total_matches > 0 else 0

        log.info(f"Value detection: {len(all_value)} value bets found "
                 f"in {matches_with_value}/{total_matches} matches "
                 f"({skip_pct:.0f}% skipped)")

        return all_value
