#!/usr/bin/env python3
"""Check historical prediction results against finished matches.

Usage:
  python check_results.py --date 2026-04-28
  python check_results.py --demo
"""

from __future__ import annotations

import argparse
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.data.results_collector import ResultsCollector
from src.data.football_data_client import FootballDataClient
from src.betting.bankroll import BankrollTracker
from src.utils.logger import setup_logger

log = setup_logger("check_results", level="INFO", log_file="logs/check_results.log")


def resolve_1x2_result(score_home: int, score_away: int) -> str:
    if score_home > score_away:
        return "home"
    if score_home < score_away:
        return "away"
    return "draw"


def run_check(date_str: str, demo: bool = False) -> dict:
    collector = ResultsCollector()
    payload = collector.load_predictions(date_str)
    if not payload:
        print(f"No predictions found for {date_str}")
        return {}

    if demo:
        summary = {
            "date": date_str,
            "checked_at": datetime.now().isoformat(),
            "mode": "demo",
            "matches": len(payload.get("matches", [])),
            "value_bets": len(payload.get("value_bets", [])),
            "parlays": len(payload.get("parlays", [])),
            "note": "Demo mode only verifies saved prediction payload exists."
        }
        collector.save_results(date_str, summary)
        print(summary)
        return summary

    stats = FootballDataClient()
    bankroll = BankrollTracker()

    match_results = {}
    for comp in ["PL", "BL1", "SA", "PD", "FL1", "DED"]:
        data = stats.get_matches(comp, status="FINISHED")
        for m in (data or {}).get("matches", []):
            match_results[m.get("id")] = m

    settled = []
    wins = 0
    losses = 0
    total_staked = 0.0
    total_returned = 0.0

    for vb in payload.get("value_bets", []):
        mid = vb.get("match_id")
        match = match_results.get(mid)
        if not match:
            continue

        full = match.get("score", {}).get("fullTime", {})
        home_goals = full.get("home")
        away_goals = full.get("away")
        if home_goals is None or away_goals is None:
            continue

        selection = vb.get("selection", "").lower()
        won = False
        if selection == "home":
            won = home_goals > away_goals
        elif selection == "away":
            won = away_goals > home_goals
        elif selection == "draw":
            won = home_goals == away_goals
        elif selection.startswith("over"):
            won = (home_goals + away_goals) > 2.5
        elif selection.startswith("under"):
            won = (home_goals + away_goals) < 2.5

        odds = vb.get("odds", 1.0)
        stake = 10.0  # unit stake for tracking
        total_staked += stake
        if won:
            total_returned += stake * odds

        settled.append({
            "match_id": mid,
            "home_team": vb.get("home_team"),
            "away_team": vb.get("away_team"),
            "selection": vb.get("selection"),
            "odds": odds,
            "result": f"{home_goals}-{away_goals}",
            "won": won,
            "pnl": round((stake * odds - stake) if won else -stake, 2),
        })
        if won:
            wins += 1
        else:
            losses += 1

    # Evaluate parlays
    parlay_results = []
    for parlay in payload.get("parlays", []):
        legs = parlay.get("legs", [])
        all_won = True
        leg_results = []
        for leg in legs:
            mid = leg.get("match_id")
            match = match_results.get(mid)
            if not match:
                all_won = False
                leg_results.append({"match_id": mid, "settled": False})
                continue
            full = match.get("score", {}).get("fullTime", {})
            hg = full.get("home")
            ag = full.get("away")
            if hg is None or ag is None:
                all_won = False
                leg_results.append({"match_id": mid, "settled": False})
                continue
            sel = leg.get("selection", "").lower()
            leg_won = False
            if sel == "home":
                leg_won = hg > ag
            elif sel == "away":
                leg_won = ag > hg
            elif sel == "draw":
                leg_won = hg == ag
            elif sel.startswith("over"):
                leg_won = (hg + ag) > 2.5
            elif sel.startswith("under"):
                leg_won = (hg + ag) < 2.5
            if not leg_won:
                all_won = False
            leg_results.append({"match_id": mid, "settled": True, "won": leg_won, "result": f"{hg}-{ag}"})
        parlay_results.append({
            "combined_odds": parlay.get("combined_odds", 0),
            "all_won": all_won,
            "legs": leg_results,
        })

    roi = ((total_returned - total_staked) / total_staked * 100) if total_staked > 0 else 0.0

    summary = {
        "date": date_str,
        "checked_at": datetime.now().isoformat(),
        "singles": {
            "settled": len(settled),
            "wins": wins,
            "losses": losses,
            "win_rate": round((wins / len(settled)) if settled else 0.0, 4),
            "total_staked": round(total_staked, 2),
            "total_returned": round(total_returned, 2),
            "pnl": round(total_returned - total_staked, 2),
            "roi_pct": round(roi, 2),
        },
        "parlays": parlay_results,
        "bets": settled,
    }
    collector.save_results(date_str, summary)

    # Print readable summary
    s = summary["singles"]
    print(f"\n{'='*50}")
    print(f"  RESULTS — {date_str}")
    print(f"{'='*50}")
    print(f"  Singles: {s['wins']}W / {s['losses']}L ({s['win_rate']*100:.1f}%)")
    print(f"  Staked: ${s['total_staked']:.2f} | Returned: ${s['total_returned']:.2f}")
    print(f"  P&L: ${s['pnl']:.2f} | ROI: {s['roi_pct']:.1f}%")
    print(f"  Parlays: {sum(1 for p in parlay_results if p['all_won'])}/{len(parlay_results)} won")
    print(f"{'='*50}\n")

    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=(datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d"))
    parser.add_argument("--demo", action="store_true")
    args = parser.parse_args()
    run_check(args.date, demo=args.demo)
