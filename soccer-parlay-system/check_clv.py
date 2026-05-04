#!/usr/bin/env python3
"""Check CLV by comparing saved opening odds to current odds."""

from __future__ import annotations

import argparse
import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.data.results_collector import ResultsCollector
from src.data.data_pipeline import DataPipeline
from src.betting.value_detector import ValueDetector
from src.models.poisson_model import PoissonMatchModel
from src.betting.clv_tracker import CLVTracker
from src.utils.logger import setup_logger

log = setup_logger("check_clv", level="INFO", log_file="logs/check_clv.log")


def run_check(date_str: str) -> dict:
    tracker = CLVTracker()
    snapshot = tracker.load_snapshot(date_str)
    if not snapshot:
        print(f"No CLV snapshot found for {date_str}")
        return {}

    matches = DataPipeline().fetch_and_merge()
    predicted = PoissonMatchModel().predict_all(matches)
    current_value_bets = ValueDetector().detect_all_value(predicted)
    result = tracker.compare_with_current(snapshot, current_value_bets)
    print(result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=datetime.now().strftime("%Y-%m-%d"))
    args = parser.parse_args()
    run_check(args.date)
