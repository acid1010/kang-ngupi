#!/usr/bin/env python3
"""Tests for the soccer parlay betting system.

Run: python -m pytest tests/test_system.py -v
"""

import os
import sys
import math

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.utils.helpers import (
    implied_probability, remove_vig, decimal_to_american,
    format_currency, format_pct
)
from src.models.poisson_model import PoissonMatchModel
from src.models.calibration import PlattScaler, compute_calibration_stats
from src.betting.value_detector import ValueDetector
from src.betting.parlay_optimizer import ParlayOptimizer
from src.betting.kelly import KellyCriterion


# ─── Helpers ───────────────────────────────────────────────

class TestHelpers:
    def test_implied_probability(self):
        assert abs(implied_probability(2.0) - 0.5) < 1e-6
        assert abs(implied_probability(4.0) - 0.25) < 1e-6
        assert abs(implied_probability(1.5) - 0.6667) < 1e-3
        assert implied_probability(1.0) == 1.0

    def test_remove_vig(self):
        # Typical 1X2 with ~5% overround
        probs = [0.45, 0.28, 0.32]  # sum = 1.05
        fair = remove_vig(probs)
        assert abs(sum(fair) - 1.0) < 1e-6
        assert all(f < p for f, p in zip(fair, probs))

    def test_decimal_to_american(self):
        assert decimal_to_american(2.0) == "+100"
        assert decimal_to_american(1.5) == "-200"
        assert decimal_to_american(3.0) == "+200"

    def test_format_currency(self):
        assert format_currency(1000) == "$1,000.00"
        assert format_currency(15.5) == "$15.50"

    def test_format_pct(self):
        assert format_pct(0.5) == "50.0%"
        assert format_pct(0.123, 2) == "12.30%"


# ─── Poisson Model ────────────────────────────────────────

class TestPoissonModel:
    def setup_method(self):
        self.model = PoissonMatchModel()

    def _make_stats(self, home_att=1.0, home_def=1.0, away_att=1.0, away_def=1.0):
        """Create minimal team stats dicts."""
        return (
            {
                "home_attack": home_att,
                "home_defense": home_def,
                "away_attack": home_att * 0.9,
                "away_defense": home_def * 1.1,
                "avg_home_goals_league": 1.35,
                "avg_away_goals_league": 1.10,
            },
            {
                "home_attack": away_att,
                "home_defense": away_def,
                "away_attack": away_att * 0.9,
                "away_defense": away_def * 1.1,
                "avg_home_goals_league": 1.35,
                "avg_away_goals_league": 1.10,
            },
        )

    def test_expected_goals_positive(self):
        home_stats, away_stats = self._make_stats()
        xg = self.model.predict_expected_goals(home_stats, away_stats)
        assert xg["lambda_home"] > 0
        assert xg["lambda_away"] > 0
        assert xg["total_expected_goals"] > 0

    def test_home_advantage(self):
        """Home team should have higher expected goals (all else equal)."""
        home_stats, away_stats = self._make_stats()
        xg = self.model.predict_expected_goals(home_stats, away_stats)
        assert xg["lambda_home"] > xg["lambda_away"]

    def test_strong_team_higher_xg(self):
        """Stronger attack should produce higher expected goals."""
        home_stats, away_stats = self._make_stats(home_att=1.5, away_att=0.8)
        xg = self.model.predict_expected_goals(home_stats, away_stats)
        assert xg["lambda_home"] > xg["lambda_away"]

    def test_probabilities_sum_to_one(self):
        home_stats, away_stats = self._make_stats()
        result = self.model.predict_match_probabilities(home_stats, away_stats)
        probs = result["probabilities"]
        total = probs["home_win"] + probs["draw"] + probs["away_win"]
        assert abs(total - 1.0) < 0.01

    def test_over_under_consistency(self):
        home_stats, away_stats = self._make_stats()
        result = self.model.predict_match_probabilities(home_stats, away_stats)
        ou = result["over_under"]
        assert abs(ou["over_2.5"] + ou["under_2.5"] - 1.0) < 0.01

    def test_score_matrix_shape(self):
        matrix = self.model.predict_score_matrix(1.5, 1.2)
        assert matrix.shape == (9, 9)  # max_goals + 1
        assert abs(matrix.sum() - 1.0) < 0.01

    def test_median_goals(self):
        median = self.model._estimate_median_goals(2.5)
        assert isinstance(median, (int, float))
        assert median >= 0


# ─── Calibration ──────────────────────────────────────────

class TestCalibration:
    def test_platt_passthrough_unfitted(self):
        scaler = PlattScaler()
        assert scaler.calibrate(0.5) == 0.5
        assert scaler.calibrate(0.3) == 0.3

    def test_platt_fit_and_calibrate(self):
        scaler = PlattScaler()
        # Create well-calibrated synthetic data
        np.random.seed(42)
        n = 200
        predicted = np.random.uniform(0.1, 0.9, n)
        actual = (np.random.random(n) < predicted).astype(float)

        scaler.fit(predicted, actual)
        assert scaler.fitted

        # Calibrated values should be in [0, 1]
        cal = scaler.calibrate(0.5)
        assert 0 < cal < 1

    def test_calibration_stats(self):
        np.random.seed(42)
        n = 100
        predicted = np.random.uniform(0.1, 0.9, n)
        actual = (np.random.random(n) < predicted).astype(float)

        stats = compute_calibration_stats(predicted, actual)
        assert "ece" in stats
        assert "brier_score" in stats
        assert stats["ece"] >= 0
        assert 0 <= stats["brier_score"] <= 1


# ─── Kelly Criterion ─────────────────────────────────────

class TestKelly:
    def setup_method(self):
        self.kelly = KellyCriterion(bankroll=1000.0)

    def test_full_kelly_positive_edge(self):
        # 60% chance at 2.0 odds → positive edge
        f = self.kelly.full_kelly(0.6, 2.0)
        assert f > 0
        assert f < 1

    def test_full_kelly_no_edge(self):
        # 50% chance at 2.0 odds → no edge (fair bet)
        f = self.kelly.full_kelly(0.5, 2.0)
        assert abs(f) < 0.01

    def test_full_kelly_negative_edge(self):
        # 40% chance at 2.0 odds → negative edge
        f = self.kelly.full_kelly(0.4, 2.0)
        assert f == 0  # Clamped to 0

    def test_fractional_kelly_smaller(self):
        full = self.kelly.full_kelly(0.6, 2.0)
        frac = self.kelly.fractional_kelly(0.6, 2.0)
        assert frac < full
        assert abs(frac - full * 0.25) < 1e-6

    def test_stake_calculation(self):
        result = self.kelly.calculate_stake(0.65, 2.0)
        assert result["stake"] > 0
        assert result["reason"] == "OK"
        assert result["pct_of_bankroll"] <= 2.0  # Max 2% cap

    def test_stake_capped(self):
        # Very high edge should still be capped
        result = self.kelly.calculate_stake(0.9, 2.0)
        assert result["stake"] <= 1000 * 0.02  # 2% cap
        assert result["capped"]

    def test_parlay_stake(self):
        legs = [
            {"model_prob": 0.6, "odds": 2.0},
            {"model_prob": 0.7, "odds": 1.8},
        ]
        result = self.kelly.calculate_parlay_stake(legs)
        assert result["combined_prob"] == pytest.approx(0.42, abs=0.01)
        assert result["combined_odds"] == pytest.approx(3.6, abs=0.01)
        assert result["num_legs"] == 2


# ─── Value Detector ──────────────────────────────────────

class TestValueDetector:
    def setup_method(self):
        self.detector = ValueDetector()

    def _make_match(self, model_home=0.6, odds_home=2.0,
                    model_draw=0.25, odds_draw=3.5,
                    model_away=0.15, odds_away=5.0):
        return {
            "match_id": "TEST-001",
            "home_team": "Team A",
            "away_team": "Team B",
            "league": "Test League",
            "league_code": "TL",
            "sport_key": "test",
            "commence_time": "2024-01-01T15:00:00Z",
            "best_odds": {
                "home": {"odds": odds_home, "bookmaker": "TestBook"},
                "draw": {"odds": odds_draw, "bookmaker": "TestBook"},
                "away": {"odds": odds_away, "bookmaker": "TestBook"},
            },
            "over_under": {
                "line": 2.5,
                "over_odds": 1.9,
                "under_odds": 2.0,
                "bookmaker": "TestBook",
            },
            "model_predictions": {
                "probabilities": {
                    "home_win": model_home,
                    "draw": model_draw,
                    "away_win": model_away,
                },
                "over_under": {
                    "over_2.5": 0.55,
                    "under_2.5": 0.45,
                },
            },
        }

    def test_detect_value_with_edge(self):
        # Model says 60% home win, odds imply 50% → 10% edge
        match = self._make_match(model_home=0.60, odds_home=2.0)
        value_bets = self.detector.detect_value(match)
        assert len(value_bets) >= 1
        home_bet = [v for v in value_bets if v["market"] == "home_win"]
        assert len(home_bet) == 1
        assert home_bet[0]["edge"] >= 0.05

    def test_no_value_without_edge(self):
        # Model agrees with odds → no edge
        match = self._make_match(model_home=0.50, odds_home=2.0)
        value_bets = self.detector.detect_value(match)
        home_bets = [v for v in value_bets if v["market"] == "home_win"]
        assert len(home_bets) == 0

    def test_confidence_levels(self):
        match = self._make_match(model_home=0.70, odds_home=2.0)
        value_bets = self.detector.detect_value(match)
        home_bet = [v for v in value_bets if v["market"] == "home_win"][0]
        assert home_bet["confidence"] in ("HIGH", "MEDIUM", "LOW")

    def test_sweet_spot_flag(self):
        match = self._make_match(model_home=0.60, odds_home=2.0)
        value_bets = self.detector.detect_value(match)
        home_bet = [v for v in value_bets if v["market"] == "home_win"][0]
        assert home_bet["in_sweet_spot"] is True  # 2.0 is in 1.50-2.50


# ─── Parlay Optimizer ────────────────────────────────────

class TestParlayOptimizer:
    def setup_method(self):
        self.optimizer = ParlayOptimizer()

    def _make_value_bets(self, n=5):
        bets = []
        leagues = ["PL", "BL1", "SA", "PD", "FL1"]
        for i in range(n):
            bets.append({
                "match_id": f"M-{i:03d}",
                "home_team": f"Home {i}",
                "away_team": f"Away {i}",
                "league": f"League {i}",
                "league_code": leagues[i % len(leagues)],
                "commence_time": f"2024-01-01T{14+i}:00:00Z",
                "market": "home_win",
                "selection": "Home Win",
                "model_prob": 0.60 - i * 0.02,
                "implied_prob": 0.50,
                "edge": 0.10 - i * 0.01,
                "odds": 1.80 + i * 0.15,
                "bookmaker": "TestBook",
                "expected_value": 0.08,
                "confidence": "MEDIUM",
                "in_sweet_spot": True,
            })
        return bets

    def test_finds_parlays(self):
        bets = self._make_value_bets(5)
        parlays = self.optimizer.find_optimal_parlays(bets)
        assert len(parlays) > 0

    def test_parlay_leg_count(self):
        bets = self._make_value_bets(5)
        parlays = self.optimizer.find_optimal_parlays(bets)
        for p in parlays:
            assert 2 <= p["num_legs"] <= 3

    def test_no_same_match_in_parlay(self):
        bets = self._make_value_bets(5)
        parlays = self.optimizer.find_optimal_parlays(bets)
        for p in parlays:
            match_ids = [l["match_id"] for l in p["legs"]]
            assert len(set(match_ids)) == len(match_ids)

    def test_different_leagues_preferred(self):
        bets = self._make_value_bets(5)
        parlays = self.optimizer.find_optimal_parlays(bets)
        if parlays:
            top = parlays[0]
            leagues = [l["league_code"] for l in top["legs"]]
            # Top parlay should prefer different leagues
            assert len(set(leagues)) >= 2 or len(top["legs"]) == 2

    def test_insufficient_bets(self):
        bets = self._make_value_bets(1)
        parlays = self.optimizer.find_optimal_parlays(bets)
        assert len(parlays) == 0

    def test_positive_ev_only(self):
        bets = self._make_value_bets(5)
        parlays = self.optimizer.find_optimal_parlays(bets)
        for p in parlays:
            assert p["expected_value"] > 0


# ─── Integration ──────────────────────────────────────────

class TestIntegration:
    """End-to-end integration tests with synthetic data."""

    def test_full_pipeline_synthetic(self):
        """Test the complete pipeline with synthetic match data."""
        from backtest import generate_synthetic_data, run_backtest

        matches = generate_synthetic_data(n_matches=100, seed=42)
        assert len(matches) == 100

        results = run_backtest(matches, initial_bankroll=1000.0)

        assert "final_bankroll" in results
        assert "total_bets" in results
        assert "roi_pct" in results
        assert "max_drawdown" in results
        assert "sharpe_ratio" in results
        assert results["total_bets"] >= 0
        assert results["final_bankroll"] > 0

    def test_model_to_value_pipeline(self):
        """Test model prediction → value detection flow."""
        model = PoissonMatchModel()
        detector = ValueDetector()

        home_stats = {
            "home_attack": 1.3, "home_defense": 0.8,
            "away_attack": 1.1, "away_defense": 0.9,
            "avg_home_goals_league": 1.35, "avg_away_goals_league": 1.10,
        }
        away_stats = {
            "home_attack": 0.9, "home_defense": 1.1,
            "away_attack": 0.8, "away_defense": 1.2,
            "avg_home_goals_league": 1.35, "avg_away_goals_league": 1.10,
        }

        match = {
            "match_id": "INT-001",
            "home_team": "Strong FC",
            "away_team": "Weak FC",
            "league": "Test",
            "league_code": "TL",
            "sport_key": "test",
            "commence_time": "2024-01-01T15:00:00Z",
            "best_odds": {
                "home": {"odds": 2.10, "bookmaker": "Test"},
                "draw": {"odds": 3.50, "bookmaker": "Test"},
                "away": {"odds": 3.80, "bookmaker": "Test"},
            },
            "over_under": {
                "line": 2.5, "over_odds": 1.85,
                "under_odds": 2.05, "bookmaker": "Test",
            },
            "implied_probs": {"home": 0.476, "draw": 0.286, "away": 0.263},
            "home_stats": home_stats,
            "away_stats": away_stats,
        }

        predicted = model.predict_match(match)
        assert predicted is not None
        assert "model_predictions" in predicted

        probs = predicted["model_predictions"]["probabilities"]
        assert probs["home_win"] > probs["away_win"]  # Strong team at home

        value_bets = detector.detect_value(predicted)
        # May or may not find value depending on odds vs model
        assert isinstance(value_bets, list)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
