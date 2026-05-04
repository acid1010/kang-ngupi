"""Calibrated Poisson regression model for soccer match outcome prediction.

Based on:
- Dixon & Coles (1997) — Poisson model for soccer
- Dmochowski (2023) — Median estimation for edge detection
- Walsh & Joshi (2024) — Calibration > accuracy
"""

import math
from typing import Optional

import numpy as np
from scipy.stats import poisson

from src.utils.helpers import load_config
from src.utils.logger import get_logger

log = get_logger("poisson_model")


class PoissonMatchModel:
    """Predict match outcomes using a Poisson regression approach.

    The model estimates expected goals for each team based on:
    - Home team's home attack strength × Away team's away defense strength × league avg home goals
    - Away team's away attack strength × Home team's home defense strength × league avg away goals
    - Home advantage adjustment

    Then converts goal expectations to match outcome probabilities via
    the Poisson distribution.
    """

    def __init__(self):
        cfg = load_config()
        model_cfg = cfg.get("model", {})
        self.home_advantage = model_cfg.get("home_advantage", 0.30)
        self.max_goals = model_cfg.get("max_goals", 8)

    def predict_expected_goals(self, home_stats: dict, away_stats: dict) -> dict:
        """Predict expected goals for home and away teams.

        Uses the standard Poisson model:
        - λ_home = home_attack × away_defense × avg_home_goals × (1 + home_advantage)
        - λ_away = away_attack × home_defense × avg_away_goals

        Args:
            home_stats: Home team stats dict (from FootballDataClient.build_team_stats)
            away_stats: Away team stats dict

        Returns:
            Dict with expected goals and related metrics.
        """
        # Get league averages (should be same for both teams in same league)
        avg_home = home_stats.get("avg_home_goals_league", 1.3)
        avg_away = home_stats.get("avg_away_goals_league", 1.1)

        # Base goals-based estimates
        home_attack = home_stats.get("home_attack", 1.0)
        away_defense = away_stats.get("away_defense", 1.0)
        away_attack = away_stats.get("away_attack", 1.0)
        home_defense = home_stats.get("home_defense", 1.0)

        lambda_home_goals = home_attack * away_defense * avg_home * (1 + self.home_advantage)
        lambda_away_goals = away_attack * home_defense * avg_away

        # xG-based blend if available (60% xG, 40% goals-based)
        home_xg = home_stats.get("xg_per90")
        away_xga = away_stats.get("xga_per90")
        away_xg = away_stats.get("xg_per90")
        home_xga = home_stats.get("xga_per90")

        if all(v is not None for v in [home_xg, away_xga, away_xg, home_xga]):
            lambda_home_xg = ((float(home_xg) + float(away_xga)) / 2.0) * (1 + self.home_advantage * 0.5)
            lambda_away_xg = (float(away_xg) + float(home_xga)) / 2.0
            lambda_home = 0.6 * lambda_home_xg + 0.4 * lambda_home_goals
            lambda_away = 0.6 * lambda_away_xg + 0.4 * lambda_away_goals
        else:
            lambda_home = lambda_home_goals
            lambda_away = lambda_away_goals

        # Clamp to reasonable range
        lambda_home = max(0.3, min(lambda_home, 4.5))
        lambda_away = max(0.2, min(lambda_away, 4.0))

        return {
            "lambda_home": round(lambda_home, 3),
            "lambda_away": round(lambda_away, 3),
            "total_expected_goals": round(lambda_home + lambda_away, 3),
        }

    def predict_score_matrix(self, lambda_home: float, lambda_away: float) -> np.ndarray:
        """Compute the probability matrix for all score combinations.

        Returns:
            (max_goals+1) × (max_goals+1) matrix where [i][j] = P(home=i, away=j)
        """
        n = self.max_goals + 1
        matrix = np.zeros((n, n))

        for i in range(n):
            for j in range(n):
                matrix[i][j] = (poisson.pmf(i, lambda_home) *
                                poisson.pmf(j, lambda_away))

        return matrix

    def predict_match_probabilities(self, home_stats: dict,
                                    away_stats: dict) -> dict:
        """Predict full match outcome probabilities.

        Returns:
            Dict with home/draw/away probabilities, expected goals,
            over/under probabilities, and correct score probabilities.
        """
        xg = self.predict_expected_goals(home_stats, away_stats)
        matrix = self.predict_score_matrix(xg["lambda_home"], xg["lambda_away"])

        # 1X2 probabilities
        home_win = 0.0
        draw = 0.0
        away_win = 0.0

        n = self.max_goals + 1
        for i in range(n):
            for j in range(n):
                if i > j:
                    home_win += matrix[i][j]
                elif i == j:
                    draw += matrix[i][j]
                else:
                    away_win += matrix[i][j]

        # Normalize (should be ~1.0 already, but ensure)
        total = home_win + draw + away_win
        if total > 0:
            home_win /= total
            draw /= total
            away_win /= total

        # Over/Under probabilities
        over_15 = 1.0 - sum(matrix[i][j] for i in range(n) for j in range(n) if i + j < 2)
        over_25 = 1.0 - sum(matrix[i][j] for i in range(n) for j in range(n) if i + j < 3)
        over_35 = 1.0 - sum(matrix[i][j] for i in range(n) for j in range(n) if i + j < 4)

        # Both Teams To Score (BTTS)
        btts_yes = 1.0 - sum(matrix[0][j] for j in range(n)) - sum(matrix[i][0] for i in range(1, n))

        # Most likely scores
        scores = []
        for i in range(min(5, n)):
            for j in range(min(5, n)):
                scores.append({
                    "score": f"{i}-{j}",
                    "probability": round(matrix[i][j], 4),
                })
        scores.sort(key=lambda x: x["probability"], reverse=True)

        # Median goals estimation (Dmochowski 2023)
        # Use the CDF to find the median total goals
        total_lambda = xg["lambda_home"] + xg["lambda_away"]
        median_goals = self._estimate_median_goals(total_lambda)

        return {
            "expected_goals": xg,
            "probabilities": {
                "home_win": round(home_win, 4),
                "draw": round(draw, 4),
                "away_win": round(away_win, 4),
            },
            "over_under": {
                "over_1.5": round(over_15, 4),
                "over_2.5": round(over_25, 4),
                "over_3.5": round(over_35, 4),
                "under_2.5": round(1 - over_25, 4),
            },
            "btts": {
                "yes": round(btts_yes, 4),
                "no": round(1 - btts_yes, 4),
            },
            "median_total_goals": median_goals,
            "top_scores": scores[:5],
        }

    def _estimate_median_goals(self, lambda_total: float) -> float:
        """Estimate median total goals using Dmochowski's approach.

        For Poisson distribution, median ≈ floor(λ + 1/3 - 0.02/λ)
        This is more robust than mean for edge detection.
        """
        if lambda_total <= 0:
            return 0.0
        # Choi (1994) approximation for Poisson median
        median = math.floor(lambda_total + 1/3 - 0.02/lambda_total)
        return max(0, median)

    def predict_match(self, match_data: dict) -> Optional[dict]:
        """Predict outcomes for a merged match record.

        Args:
            match_data: Dict from DataPipeline.fetch_and_merge()

        Returns:
            Match data enriched with model predictions.
        """
        home_stats = match_data.get("home_stats")
        away_stats = match_data.get("away_stats")

        if not home_stats or not away_stats:
            return None

        predictions = self.predict_match_probabilities(home_stats, away_stats)

        return {
            **match_data,
            "model_predictions": predictions,
        }

    def predict_all(self, matches: list[dict]) -> list[dict]:
        """Run predictions on all merged matches."""
        results = []
        for match in matches:
            predicted = self.predict_match(match)
            if predicted:
                results.append(predicted)

        log.info(f"Generated predictions for {len(results)} matches")
        return results
