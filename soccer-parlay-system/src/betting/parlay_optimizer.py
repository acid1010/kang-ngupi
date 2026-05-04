"""Parlay (accumulator) optimizer — select optimal 2-3 leg combinations.

Key principles:
- Maximize expected value while controlling correlation risk
- Prefer uncorrelated legs (different leagues, different kickoff times)
- Prefer odds in sweet spot (1.50-2.50 per leg)
- Max 3 legs per parlay
"""

from itertools import combinations
from datetime import datetime, timedelta
from typing import Optional

from src.utils.helpers import load_config
from src.utils.logger import get_logger

log = get_logger("parlay_optimizer")


class ParlayOptimizer:
    """Find optimal parlay combinations from value bets."""

    def __init__(self):
        cfg = load_config()
        parlay_cfg = cfg.get("parlay", {})
        betting_cfg = cfg.get("betting", {})

        self.min_legs = betting_cfg.get("min_parlay_legs", 2)
        self.max_legs = betting_cfg.get("max_parlay_legs", 3)
        self.max_parlay_odds = betting_cfg.get("max_parlay_odds", 10.0)
        self.same_league_penalty = parlay_cfg.get("same_league_penalty", 0.30)
        self.close_time_hours = parlay_cfg.get("close_time_hours", 3)
        self.close_time_penalty = parlay_cfg.get("close_time_penalty", 0.15)
        self.sweet_spot_bonus = parlay_cfg.get("sweet_spot_bonus", 0.10)
        self.max_daily = parlay_cfg.get("max_daily_parlays", 3)
        self.top_n = parlay_cfg.get("top_n_value_bets", 15)
        self.sweet_min = betting_cfg.get("min_odds_per_leg", 1.50)
        self.sweet_max = betting_cfg.get("max_odds_per_leg", 2.50)

    def _parse_time(self, time_str: str) -> Optional[datetime]:
        """Parse ISO time string."""
        if not time_str:
            return None
        try:
            # Handle various ISO formats
            time_str = time_str.replace("Z", "+00:00")
            return datetime.fromisoformat(time_str)
        except (ValueError, TypeError):
            return None

    def _correlation_penalty(self, legs: list[dict]) -> float:
        """Calculate correlation penalty for a set of legs.

        Penalizes:
        - Same league (correlated outcomes)
        - Close kickoff times (market correlation)
        - Same match (can't have two bets on same match)

        Returns penalty value (0 = no penalty, higher = worse).
        """
        penalty = 0.0

        # Check for same match (instant disqualification)
        match_ids = [leg.get("match_id", "") for leg in legs]
        if len(set(match_ids)) < len(match_ids):
            return 999.0  # Disqualify

        # Same league penalty
        leagues = [leg.get("league_code", "") for leg in legs]
        for i in range(len(leagues)):
            for j in range(i + 1, len(leagues)):
                if leagues[i] == leagues[j] and leagues[i]:
                    penalty += self.same_league_penalty

        # Close time penalty
        times = [self._parse_time(leg.get("commence_time", "")) for leg in legs]
        for i in range(len(times)):
            for j in range(i + 1, len(times)):
                if times[i] and times[j]:
                    diff = abs((times[i] - times[j]).total_seconds()) / 3600
                    if diff < self.close_time_hours:
                        penalty += self.close_time_penalty

        return penalty

    def _sweet_spot_bonus(self, legs: list[dict]) -> float:
        """Bonus for legs with odds in the sweet spot range."""
        bonus = 0.0
        for leg in legs:
            odds = leg.get("odds", 0)
            if self.sweet_min <= odds <= self.sweet_max:
                bonus += self.sweet_spot_bonus
        return bonus

    def _score_parlay(self, legs: list[dict]) -> dict:
        """Score a parlay combination.

        Score = combined_EV + sweet_spot_bonus - correlation_penalty

        Returns dict with score breakdown.
        """
        # Combined probability and odds
        combined_prob = 1.0
        combined_odds = 1.0
        total_edge = 0.0

        for leg in legs:
            combined_prob *= leg["model_prob"]
            combined_odds *= leg["odds"]
            total_edge += leg["edge"]

        # Check max odds
        if combined_odds > self.max_parlay_odds:
            return {"score": -999, "reason": "ODDS_TOO_HIGH"}

        # Expected value of the parlay
        ev = combined_prob * combined_odds - 1.0

        # Penalties and bonuses
        corr_penalty = self._correlation_penalty(legs)
        sweet_bonus = self._sweet_spot_bonus(legs)

        # Composite score
        score = ev + sweet_bonus - corr_penalty

        # Average confidence
        confidences = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}
        avg_conf = sum(confidences.get(l.get("confidence", "LOW"), 1) for l in legs) / len(legs)

        if avg_conf >= 2.5:
            conf_label = "HIGH"
        elif avg_conf >= 1.5:
            conf_label = "MEDIUM"
        else:
            conf_label = "LOW"

        return {
            "score": round(score, 4),
            "combined_prob": round(combined_prob, 6),
            "combined_odds": round(combined_odds, 3),
            "expected_value": round(ev, 4),
            "ev_pct": round(ev * 100, 1),
            "total_edge": round(total_edge, 4),
            "correlation_penalty": round(corr_penalty, 4),
            "sweet_spot_bonus": round(sweet_bonus, 4),
            "confidence": conf_label,
            "num_legs": len(legs),
        }

    def find_optimal_parlays(self, value_bets: list[dict],
                             max_results: int = None) -> list[dict]:
        """Find the best parlay combinations from value bets.

        Args:
            value_bets: List of value bet dicts from ValueDetector
            max_results: Max parlays to return (default: config max_daily_parlays)

        Returns:
            List of parlay dicts, sorted by score descending.
        """
        if max_results is None:
            max_results = self.max_daily

        if len(value_bets) < self.min_legs:
            log.info(f"Only {len(value_bets)} value bets — need at least {self.min_legs} for parlays")
            return []

        # Phase 2: Only HIGH confidence bets qualify for parlays
        high_conf = [vb for vb in value_bets if vb.get("confidence") == "HIGH"]
        log.info(f"Phase 2 filter: {len(high_conf)}/{len(value_bets)} value bets are HIGH confidence")

        # Take top N from high-confidence pool
        candidates = high_conf[:self.top_n]

        # Deduplicate: only one bet per match
        seen_matches = {}
        deduped = []
        for vb in candidates:
            mid = vb.get("match_id", "")
            if mid not in seen_matches:
                seen_matches[mid] = True
                deduped.append(vb)
            else:
                # Keep the one with higher edge
                existing_idx = next(i for i, d in enumerate(deduped) if d.get("match_id") == mid)
                if vb["edge"] > deduped[existing_idx]["edge"]:
                    deduped[existing_idx] = vb

        candidates = deduped
        log.info(f"Evaluating parlays from {len(candidates)} unique match value bets")

        all_parlays = []

        # Generate all valid combinations of 2 and 3 legs
        for n_legs in range(self.min_legs, self.max_legs + 1):
            if len(candidates) < n_legs:
                continue

            for combo in combinations(candidates, n_legs):
                legs = list(combo)
                scoring = self._score_parlay(legs)

                if scoring["score"] <= 0:
                    continue

                parlay = {
                    "legs": legs,
                    **scoring,
                }
                all_parlays.append(parlay)

        # Sort by score
        all_parlays.sort(key=lambda x: x["score"], reverse=True)

        # Deduplicate: don't reuse the same match across selected parlays
        selected = []
        used_matches = set()

        for parlay in all_parlays:
            parlay_matches = {leg["match_id"] for leg in parlay["legs"]}

            # Allow some overlap but not complete
            overlap = parlay_matches & used_matches
            if len(overlap) > 0:
                continue

            selected.append(parlay)
            used_matches.update(parlay_matches)

            if len(selected) >= max_results:
                break

        log.info(f"Selected {len(selected)} optimal parlays from "
                 f"{len(all_parlays)} valid combinations")

        return selected
