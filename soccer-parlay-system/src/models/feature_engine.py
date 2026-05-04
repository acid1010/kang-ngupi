"""Feature engineering helpers for richer match modeling.

Combines multiple data sources into a unified feature vector:
- Standings-derived attack/defense strengths
- Recent form (last 5 matches, weighted)
- xG/xGA from FBref when available
- Home/away performance splits
- Goal-scoring patterns
"""

from __future__ import annotations

from typing import Any


def form_to_score(form: str) -> float:
    """Convert form string (e.g. 'WWDLW') to 0-1 score.
    W=3, D=1, L=0. Recent results weighted more (1.5x for last 2).
    """
    if not form:
        return 0.5
    weights = {"W": 3, "D": 1, "L": 0}
    vals = [weights.get(ch.upper(), 0) for ch in form if ch.upper() in weights]
    if not vals:
        return 0.5
    # Weight recent results more heavily
    multipliers = [1.0] * len(vals)
    for i in range(min(2, len(vals))):
        multipliers[-(i + 1)] = 1.5  # last 2 matches weighted 1.5x
    weighted_sum = sum(v * m for v, m in zip(vals, multipliers))
    max_score = sum(3 * m for m in multipliers)
    return weighted_sum / max_score if max_score else 0.5


def form_momentum(form: str) -> float:
    """Calculate momentum: positive = improving, negative = declining.
    Compares last 2 matches vs first 3.
    Returns value between -1.0 and +1.0.
    """
    if not form or len(form) < 3:
        return 0.0
    weights = {"W": 3, "D": 1, "L": 0}
    vals = [weights.get(ch.upper(), 0) for ch in form if ch.upper() in weights]
    if len(vals) < 3:
        return 0.0
    recent = sum(vals[-2:]) / (2 * 3)  # last 2
    earlier = sum(vals[:-2]) / (len(vals[:-2]) * 3) if vals[:-2] else 0.5
    return recent - earlier  # positive = improving


def goals_per_game(stats: dict[str, Any]) -> float:
    """Calculate goals per game from stats."""
    played = stats.get("played", 0) or 1
    gf = stats.get("goals_for", 0) or 0
    return gf / played


def conceded_per_game(stats: dict[str, Any]) -> float:
    """Calculate goals conceded per game."""
    played = stats.get("played", 0) or 1
    ga = stats.get("goals_against", 0) or 0
    return ga / played


class FeatureEngine:
    """Build rich feature vectors for match prediction."""

    def build_match_features(
        self,
        home_stats: dict[str, Any],
        away_stats: dict[str, Any],
    ) -> dict[str, Any]:
        """Build comprehensive feature vector for a match.

        Returns dict with all available features. Missing features = None.
        """
        home_form = home_stats.get("form", "")
        away_form = away_stats.get("form", "")

        return {
            # Core strengths
            "home_attack": home_stats.get("home_attack", 1.0),
            "home_defense": home_stats.get("home_defense", 1.0),
            "away_attack": away_stats.get("away_attack", 1.0),
            "away_defense": away_stats.get("away_defense", 1.0),
            # Overall strengths
            "home_overall_attack": home_stats.get("attack_strength", 1.0),
            "home_overall_defense": home_stats.get("defense_strength", 1.0),
            "away_overall_attack": away_stats.get("attack_strength", 1.0),
            "away_overall_defense": away_stats.get("defense_strength", 1.0),
            # Form
            "home_form_score": form_to_score(home_form),
            "away_form_score": form_to_score(away_form),
            "home_momentum": form_momentum(home_form),
            "away_momentum": form_momentum(away_form),
            # Goals patterns
            "home_goals_per_game": goals_per_game(home_stats),
            "home_conceded_per_game": conceded_per_game(home_stats),
            "away_goals_per_game": goals_per_game(away_stats),
            "away_conceded_per_game": conceded_per_game(away_stats),
            # xG (None if unavailable)
            "home_xg_per90": home_stats.get("xg_per90"),
            "home_xga_per90": home_stats.get("xga_per90"),
            "away_xg_per90": away_stats.get("xg_per90"),
            "away_xga_per90": away_stats.get("xga_per90"),
            "home_npxg": home_stats.get("npxg"),
            "away_npxg": away_stats.get("npxg"),
            # Points / position
            "home_points": home_stats.get("points", 0),
            "away_points": away_stats.get("points", 0),
            "home_position": home_stats.get("position", 10),
            "away_position": away_stats.get("position", 10),
        }
