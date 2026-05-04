"""Tests for P0 upgrade modules."""

import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_form_to_score():
    from src.models.feature_engine import form_to_score
    assert form_to_score("") == 0.5
    assert form_to_score("WWWWW") > 0.9
    assert form_to_score("LLLLL") < 0.1
    score_mixed = form_to_score("WDLWL")
    assert 0.2 < score_mixed < 0.7


def test_form_momentum():
    from src.models.feature_engine import form_momentum
    assert form_momentum("") == 0.0
    improving = form_momentum("LLDWW")
    declining = form_momentum("WWDLL")
    assert improving > 0
    assert declining < 0


def test_feature_engine_build():
    from src.models.feature_engine import FeatureEngine
    engine = FeatureEngine()
    home = {"home_attack": 1.2, "home_defense": 0.9, "form": "WWDLW", "played": 10, "goals_for": 15}
    away = {"away_attack": 1.1, "away_defense": 1.0, "form": "LDWDL", "played": 10, "goals_for": 10}
    features = engine.build_match_features(home, away)
    assert features["home_attack"] == 1.2
    assert features["home_form_score"] > features["away_form_score"]
    assert features["home_goals_per_game"] == 1.5
    assert "home_xg_per90" in features


def test_results_collector():
    from src.data.results_collector import ResultsCollector
    collector = ResultsCollector()
    path = collector.save_predictions(
        matches=[{"test": True}],
        value_bets=[{"edge": 0.1}],
        parlays=[{"legs": []}],
        date_str="test-2099-01-01",
    )
    assert path.exists()
    loaded = collector.load_predictions("test-2099-01-01")
    assert loaded is not None
    assert len(loaded["matches"]) == 1
    # Cleanup
    path.unlink(missing_ok=True)


def test_clv_tracker():
    from src.betting.clv_tracker import CLVTracker
    tracker = CLVTracker()
    path = tracker.save_opening_snapshot("test-2099-01-01", [
        {"match_id": "m1", "home_team": "A", "away_team": "B",
         "selection": "home", "market": "home_win", "odds": 2.0,
         "implied_prob": 0.5, "bookmaker": "test"}
    ])
    assert path.exists()
    snapshot = tracker.load_snapshot("test-2099-01-01")
    assert snapshot is not None
    assert len(snapshot["value_bets"]) == 1

    # Compare
    current = [{"match_id": "m1", "selection": "home", "market": "home_win",
                "odds": 1.8, "implied_prob": 0.556}]
    result = tracker.compare_with_current(snapshot, current)
    assert result["count"] == 1
    assert result["items"][0]["clv"] > 0  # odds shortened = positive CLV
    # Cleanup
    path.unlink(missing_ok=True)


def test_poisson_xg_blend():
    from src.models.poisson_model import PoissonMatchModel
    model = PoissonMatchModel()
    # With xG data
    home = {"home_attack": 1.0, "home_defense": 1.0,
            "avg_home_goals_league": 1.3, "avg_away_goals_league": 1.1,
            "xg_per90": 1.8, "xga_per90": 0.9}
    away = {"away_attack": 1.0, "away_defense": 1.0,
            "xg_per90": 1.2, "xga_per90": 1.3}
    result_xg = model.predict_expected_goals(home, away)

    # Without xG data
    home_no_xg = {k: v for k, v in home.items() if "xg" not in k}
    away_no_xg = {k: v for k, v in away.items() if "xg" not in k}
    result_no_xg = model.predict_expected_goals(home_no_xg, away_no_xg)

    # xG blend should produce different lambdas
    assert result_xg["lambda_home"] != result_no_xg["lambda_home"]
