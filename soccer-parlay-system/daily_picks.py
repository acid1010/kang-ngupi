#!/usr/bin/env python3
"""Daily Picks — Main entry point for the soccer parlay betting system.

Fetches today's matches, runs the model, identifies value bets,
constructs optimal parlays, and outputs recommendations.

Usage:
    python daily_picks.py
    python daily_picks.py --bankroll 500
    python daily_picks.py --output report.txt
"""

import argparse
import sys
import os
from datetime import datetime

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.data.data_pipeline import DataPipeline
from src.models.poisson_model import PoissonMatchModel
from src.models.calibration import PlattScaler
from src.betting.value_detector import ValueDetector
from src.betting.parlay_optimizer import ParlayOptimizer
from src.betting.kelly import KellyCriterion
from src.betting.bankroll import BankrollTracker
from src.utils.helpers import load_config, format_currency, format_pct
from src.utils.logger import setup_logger
from src.data.results_collector import ResultsCollector
from src.betting.clv_tracker import CLVTracker

log = setup_logger("daily_picks", level="INFO", log_file="logs/daily_picks.log")


def format_report(parlays: list[dict], value_bets: list[dict],
                  total_matches: int, bankroll: float,
                  kelly: KellyCriterion) -> str:
    """Format the daily picks report."""
    now = datetime.now()
    lines = []

    lines.append("")
    lines.append("═" * 60)
    lines.append(f"  DAILY PARLAY PICKS — {now.strftime('%Y-%m-%d %H:%M')}")
    lines.append(f"  Bankroll: {format_currency(bankroll)} | Model: Poisson v1.0")
    lines.append("═" * 60)
    lines.append("")

    if not parlays:
        lines.append("  ⚠️  No value parlays found today.")
        lines.append("  This is normal — we skip >60% of matches.")
        lines.append("")
    else:
        for i, parlay in enumerate(parlays, 1):
            legs = parlay["legs"]
            scoring = parlay

            # Calculate stake
            stake_info = kelly.calculate_parlay_stake(legs)
            stake = stake_info.get("stake", 0)

            lines.append(f"🎯 PARLAY #{i} — Expected Value: "
                         f"{'+' if scoring['ev_pct'] > 0 else ''}{scoring['ev_pct']:.1f}%")
            lines.append(f"  Combined Odds: {scoring['combined_odds']:.2f} | "
                         f"Confidence: {scoring['confidence']}")
            lines.append(f"  Recommended Stake: {format_currency(stake)} "
                         f"({stake_info.get('pct_of_bankroll', 0):.1f}% bankroll)")
            lines.append(f"  Potential Payout: {format_currency(stake * scoring['combined_odds'])}")
            lines.append("")

            for j, leg in enumerate(legs, 1):
                lines.append(f"  Leg {j}: {leg['home_team']} vs {leg['away_team']} — "
                             f"{leg['selection']}")
                lines.append(f"    Model: {format_pct(leg['model_prob'])} | "
                             f"Implied: {format_pct(leg['implied_prob'])} | "
                             f"Edge: +{format_pct(leg['edge'])}")
                lines.append(f"    Odds: {leg['odds']:.2f} ({leg['bookmaker']})")
                lines.append(f"    League: {leg['league']}")
                lines.append("")

            # Correlation check
            league_codes = [l.get("league_code", "") for l in legs]
            if len(set(league_codes)) == len(league_codes):
                lines.append("  ✅ Legs uncorrelated (different leagues)")
            else:
                lines.append("  ⚠️  Some legs from same league (correlated)")

            sweet = sum(1 for l in legs if l.get("in_sweet_spot", False))
            if sweet == len(legs):
                lines.append("  ✅ All legs in sweet spot (1.50-2.50)")
            elif sweet > 0:
                lines.append(f"  ℹ️  {sweet}/{len(legs)} legs in sweet spot")

            lines.append("")
            lines.append("─" * 60)
            lines.append("")

    # Summary
    matches_with_value = len(set(v["match_id"] for v in value_bets))
    skip_pct = (total_matches - matches_with_value) / total_matches * 100 if total_matches > 0 else 0

    lines.append(f"  Matches analyzed: {total_matches} | "
                 f"Value bets found: {len(value_bets)} ({matches_with_value} matches)")
    lines.append(f"  Matches skipped: {total_matches - matches_with_value} "
                 f"({skip_pct:.0f}%) — insufficient edge")
    lines.append("")

    # Individual value bets
    if value_bets:
        lines.append("─" * 60)
        lines.append("  ALL VALUE BETS (sorted by edge)")
        lines.append("─" * 60)
        for vb in value_bets[:10]:
            lines.append(f"  {vb['home_team']} vs {vb['away_team']} — {vb['selection']}")
            lines.append(f"    Edge: +{format_pct(vb['edge'])} | "
                         f"Odds: {vb['odds']:.2f} | "
                         f"Conf: {vb['confidence']} | "
                         f"{'🎯' if vb['in_sweet_spot'] else ''}")
        lines.append("")

    lines.append("═" * 60)
    lines.append("")

    return "\n".join(lines)


def run_daily_picks(bankroll: float = None, output_file: str = None) -> dict:
    """Run the full daily picks pipeline.

    Returns dict with parlays, value_bets, and report text.
    """
    cfg = load_config()

    if bankroll is None:
        bankroll = cfg.get("bankroll", {}).get("initial", 1000.0)

    log.info("=" * 50)
    log.info("Starting daily picks pipeline")
    log.info(f"Bankroll: {format_currency(bankroll)}")
    log.info("=" * 50)

    # Step 1: Fetch and merge data
    log.info("STEP 1: Fetching data...")
    pipeline = DataPipeline()
    matches = pipeline.fetch_and_merge()

    if not matches:
        log.warning("No matches available — check API keys and data sources")
        report = "\n⚠️  No matches available. Check your API keys in config/settings.yaml\n"
        print(report)
        return {"parlays": [], "value_bets": [], "report": report}

    log.info(f"Got {len(matches)} matches with complete data")

    # Step 2: Run predictions
    log.info("STEP 2: Running Poisson model...")
    model = PoissonMatchModel()

    # Try to load calibration
    scaler = PlattScaler()
    scaler.load()

    predicted = model.predict_all(matches)
    log.info(f"Predictions generated for {len(predicted)} matches")

    # Step 3: Detect value bets
    log.info("STEP 3: Detecting value bets...")
    detector = ValueDetector()
    value_bets = detector.detect_all_value(predicted)
    log.info(f"Found {len(value_bets)} value bets")

    # Step 4: Optimize parlays
    log.info("STEP 4: Optimizing parlays...")
    optimizer = ParlayOptimizer()
    parlays = optimizer.find_optimal_parlays(value_bets)
    log.info(f"Selected {len(parlays)} optimal parlays")

    # Step 5: Calculate stakes
    log.info("STEP 5: Calculating stakes...")
    kelly = KellyCriterion(bankroll=bankroll)

    # Step 6: Generate report
    report = format_report(parlays, value_bets, len(matches), bankroll, kelly)
    print(report)

    # Save report
    if output_file:
        with open(output_file, "w") as f:
            f.write(report)
        log.info(f"Report saved to {output_file}")
    else:
        report_path = f"reports/picks_{datetime.now().strftime('%Y%m%d_%H%M')}.txt"
        os.makedirs("reports", exist_ok=True)
        with open(report_path, "w") as f:
            f.write(report)
        log.info(f"Report saved to {report_path}")

    # Persist predictions + opening odds for later evaluation / CLV tracking
    today = datetime.now().strftime('%Y-%m-%d')
    collector = ResultsCollector()
    collector.save_predictions(
        matches=predicted,
        value_bets=value_bets,
        parlays=parlays,
        run_meta={
            'bankroll': bankroll,
            'total_matches': len(matches),
            'value_bets': len(value_bets),
            'parlays': len(parlays),
        },
        date_str=today,
    )
    CLVTracker().save_opening_snapshot(today, value_bets)

    return {
        "parlays": parlays,
        "value_bets": value_bets,
        "total_matches": len(matches),
        "report": report,
    }


def main():
    parser = argparse.ArgumentParser(description="Soccer Parlay Daily Picks")
    parser.add_argument("--bankroll", type=float, default=None,
                        help="Current bankroll amount")
    parser.add_argument("--output", "-o", type=str, default=None,
                        help="Output file path for report")
    args = parser.parse_args()

    run_daily_picks(bankroll=args.bankroll, output_file=args.output)


if __name__ == "__main__":
    main()
