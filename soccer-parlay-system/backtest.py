#!/usr/bin/env python3
"""Backtesting framework for the soccer parlay betting system.

Tests the strategy on historical data and calculates:
- ROI (Return on Investment)
- Sharpe Ratio (risk-adjusted returns)
- Max Drawdown
- Win Rate
- CLV (Closing Line Value) correlation
- Calibration metrics

Usage:
    python backtest.py
    python backtest.py --seasons 2023 2024 --bankroll 1000
    python backtest.py --demo  # Run with synthetic data
"""

import argparse
import json
import math
import os
import sys
from datetime import datetime, timedelta
from typing import Optional

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.data.football_data_client import FootballDataClient
from src.models.poisson_model import PoissonMatchModel
from src.models.calibration import PlattScaler, compute_calibration_stats
from src.betting.value_detector import ValueDetector
from src.betting.parlay_optimizer import ParlayOptimizer
from src.betting.kelly import KellyCriterion
from src.utils.helpers import load_config, format_currency, format_pct, implied_probability
from src.utils.logger import setup_logger

log = setup_logger("backtest", level="INFO", log_file="logs/backtest.log")


def generate_synthetic_data(n_matches: int = 500, seed: int = 42) -> list[dict]:
    """Generate synthetic historical match data for demo backtesting.

    Creates realistic-looking match data with known statistical properties
    so we can validate the system works end-to-end.
    """
    np.random.seed(seed)

    leagues = [
        {"code": "PL", "name": "Premier League", "sport_key": "soccer_epl"},
        {"code": "BL1", "name": "Bundesliga", "sport_key": "soccer_germany_bundesliga"},
        {"code": "SA", "name": "Serie A", "sport_key": "soccer_italy_serie_a"},
        {"code": "PD", "name": "La Liga", "sport_key": "soccer_spain_la_liga"},
    ]

    teams_by_league = {
        "PL": [
            ("Arsenal FC", 1.3, 0.8), ("Manchester City FC", 1.4, 0.7),
            ("Liverpool FC", 1.3, 0.8), ("Chelsea FC", 1.1, 0.9),
            ("Tottenham Hotspur FC", 1.1, 1.0), ("Manchester United FC", 1.0, 1.0),
            ("Newcastle United FC", 1.1, 0.9), ("Aston Villa FC", 1.0, 1.0),
            ("West Ham United FC", 0.9, 1.1), ("Brighton & Hove Albion FC", 1.0, 0.9),
        ],
        "BL1": [
            ("FC Bayern München", 1.5, 0.7), ("Borussia Dortmund", 1.2, 0.9),
            ("RB Leipzig", 1.2, 0.8), ("Bayer 04 Leverkusen", 1.3, 0.8),
            ("Eintracht Frankfurt", 1.0, 1.0), ("VfB Stuttgart", 1.1, 0.9),
            ("Sport-Club Freiburg", 0.9, 0.9), ("VfL Wolfsburg", 0.9, 1.0),
        ],
        "SA": [
            ("FC Internazionale Milano", 1.3, 0.7), ("AC Milan", 1.1, 0.9),
            ("Juventus FC", 1.1, 0.8), ("SSC Napoli", 1.2, 0.8),
            ("AS Roma", 1.0, 0.9), ("SS Lazio", 1.0, 1.0),
            ("Atalanta BC", 1.2, 0.9), ("ACF Fiorentina", 0.9, 1.0),
        ],
        "PD": [
            ("Real Madrid CF", 1.4, 0.7), ("FC Barcelona", 1.4, 0.7),
            ("Club Atlético de Madrid", 1.1, 0.7), ("Real Sociedad de Fútbol", 1.0, 0.9),
            ("Real Betis Balompié", 1.0, 1.0), ("Villarreal CF", 1.0, 0.9),
            ("Athletic Club", 0.9, 0.9), ("Sevilla FC", 0.9, 1.0),
        ],
    }

    matches = []
    base_date = datetime(2024, 8, 15)

    for i in range(n_matches):
        league = leagues[i % len(leagues)]
        league_code = league["code"]
        teams = teams_by_league[league_code]

        # Pick two different teams
        idx = np.random.choice(len(teams), 2, replace=False)
        home_name, home_att, home_def = teams[idx[0]]
        away_name, away_att, away_def = teams[idx[1]]

        # Simulate expected goals
        home_advantage = 0.3
        lambda_home = home_att * away_def * 1.35 * (1 + home_advantage)
        lambda_away = away_att * home_def * 1.10

        # Clamp
        lambda_home = max(0.5, min(lambda_home, 3.5))
        lambda_away = max(0.3, min(lambda_away, 3.0))

        # Simulate actual goals
        home_goals = np.random.poisson(lambda_home)
        away_goals = np.random.poisson(lambda_away)

        # Determine result
        if home_goals > away_goals:
            result = "HOME_WIN"
        elif home_goals == away_goals:
            result = "DRAW"
        else:
            result = "AWAY_WIN"

        total_goals = home_goals + away_goals

        # Generate "bookmaker" odds (with some noise and vig)
        from scipy.stats import poisson as poisson_dist

        # True probabilities from Poisson
        max_g = 8
        true_home_win = 0
        true_draw = 0
        true_away_win = 0
        for hg in range(max_g + 1):
            for ag in range(max_g + 1):
                p = poisson_dist.pmf(hg, lambda_home) * poisson_dist.pmf(ag, lambda_away)
                if hg > ag:
                    true_home_win += p
                elif hg == ag:
                    true_draw += p
                else:
                    true_away_win += p

        # Add vig (overround ~5-8%)
        vig = 1.0 + np.random.uniform(0.05, 0.08)

        # Add noise to bookmaker odds (they're not perfect)
        noise_h = np.random.normal(0, 0.03)
        noise_d = np.random.normal(0, 0.03)
        noise_a = np.random.normal(0, 0.03)

        bk_home = max(true_home_win + noise_h, 0.05) * vig
        bk_draw = max(true_draw + noise_d, 0.05) * vig
        bk_away = max(true_away_win + noise_a, 0.05) * vig

        # Convert to decimal odds
        home_odds = max(1.05, 1.0 / bk_home) if bk_home > 0 else 10.0
        draw_odds = max(1.05, 1.0 / bk_draw) if bk_draw > 0 else 10.0
        away_odds = max(1.05, 1.0 / bk_away) if bk_away > 0 else 10.0

        # Over/Under 2.5
        true_over = 1.0 - sum(
            poisson_dist.pmf(hg, lambda_home) * poisson_dist.pmf(ag, lambda_away)
            for hg in range(max_g + 1) for ag in range(max_g + 1)
            if hg + ag < 3
        )
        over_noise = np.random.normal(0, 0.03)
        bk_over = max(true_over + over_noise, 0.1) * vig
        over_odds = max(1.05, 1.0 / bk_over) if bk_over > 0 else 5.0
        under_odds = max(1.05, 1.0 / (1 - true_over + over_noise + 0.02)) if (1 - true_over + over_noise) > 0.05 else 5.0

        match_date = base_date + timedelta(days=i // 4, hours=int(np.random.choice([12, 14, 15, 17, 19, 20])))

        # Build team stats (simplified)
        home_stats = {
            "team_id": idx[0],
            "played": 20 + np.random.randint(0, 10),
            "won": 0, "drawn": 0, "lost": 0,
            "goals_for": 0, "goals_against": 0,
            "home_played": 10, "home_goals_for": 0, "home_goals_against": 0,
            "away_played": 10, "away_goals_for": 0, "away_goals_against": 0,
            "attack_strength": round(home_att, 3),
            "defense_strength": round(home_def, 3),
            "home_attack": round(home_att * 1.1, 3),
            "home_defense": round(home_def * 0.95, 3),
            "away_attack": round(home_att * 0.9, 3),
            "away_defense": round(home_def * 1.1, 3),
            "avg_home_goals_league": 1.35,
            "avg_away_goals_league": 1.10,
            "position": int(idx[0]) + 1,
            "form": "",
        }

        away_stats = {
            "team_id": idx[1],
            "played": 20 + np.random.randint(0, 10),
            "won": 0, "drawn": 0, "lost": 0,
            "goals_for": 0, "goals_against": 0,
            "home_played": 10, "home_goals_for": 0, "home_goals_against": 0,
            "away_played": 10, "away_goals_for": 0, "away_goals_against": 0,
            "attack_strength": round(away_att, 3),
            "defense_strength": round(away_def, 3),
            "home_attack": round(away_att * 1.1, 3),
            "home_defense": round(away_def * 0.95, 3),
            "away_attack": round(away_att * 0.9, 3),
            "away_defense": round(away_def * 1.1, 3),
            "avg_home_goals_league": 1.35,
            "avg_away_goals_league": 1.10,
            "position": int(idx[1]) + 1,
            "form": "",
        }

        matches.append({
            "match_id": f"SYN-{i:04d}",
            "home_team": home_name,
            "away_team": away_name,
            "league": league["name"],
            "league_code": league_code,
            "sport_key": league["sport_key"],
            "commence_time": match_date.isoformat(),
            "best_odds": {
                "home": {"odds": round(home_odds, 2), "bookmaker": "Synthetic"},
                "draw": {"odds": round(draw_odds, 2), "bookmaker": "Synthetic"},
                "away": {"odds": round(away_odds, 2), "bookmaker": "Synthetic"},
            },
            "implied_probs": {
                "home": round(implied_probability(home_odds), 4),
                "draw": round(implied_probability(draw_odds), 4),
                "away": round(implied_probability(away_odds), 4),
            },
            "over_under": {
                "line": 2.5,
                "over_odds": round(over_odds, 2),
                "under_odds": round(under_odds, 2),
                "bookmaker": "Synthetic",
            },
            "num_bookmakers": 5,
            "home_stats": home_stats,
            "away_stats": away_stats,
            # Actual results (for backtesting)
            "_actual_result": result,
            "_actual_home_goals": int(home_goals),
            "_actual_away_goals": int(away_goals),
            "_actual_total_goals": int(total_goals),
            "_true_home_prob": round(true_home_win, 4),
            "_true_draw_prob": round(true_draw, 4),
            "_true_away_prob": round(true_away_win, 4),
        })

    log.info(f"Generated {len(matches)} synthetic matches")
    return matches


def evaluate_bet(bet: dict, match: dict) -> bool:
    """Check if a value bet won based on actual results."""
    result = match.get("_actual_result", "")
    total = match.get("_actual_total_goals", 0)
    selection = bet.get("market", "")

    if selection == "home_win":
        return result == "HOME_WIN"
    elif selection == "draw":
        return result == "DRAW"
    elif selection == "away_win":
        return result == "AWAY_WIN"
    elif selection == "over_2.5":
        return total > 2
    elif selection == "under_2.5":
        return total < 3
    return False


def evaluate_parlay(parlay: dict, match_lookup: dict) -> bool:
    """Check if all legs of a parlay won."""
    for leg in parlay.get("legs", []):
        match_id = leg.get("match_id", "")
        match = match_lookup.get(match_id)
        if not match:
            return False
        if not evaluate_bet(leg, match):
            return False
    return True


def run_backtest(matches: list[dict], initial_bankroll: float = 1000.0) -> dict:
    """Run the full backtesting simulation.

    Processes matches in chronological batches (simulating daily picks),
    tracks bankroll, and computes performance metrics.
    """
    log.info(f"Starting backtest with {len(matches)} matches, "
             f"bankroll={format_currency(initial_bankroll)}")

    model = PoissonMatchModel()
    detector = ValueDetector()
    optimizer = ParlayOptimizer()
    kelly = KellyCriterion(bankroll=initial_bankroll)

    # Build match lookup for result checking
    match_lookup = {m["match_id"]: m for m in matches}

    # Sort by date
    matches_sorted = sorted(matches, key=lambda m: m.get("commence_time", ""))

    # Process in batches (simulate daily windows)
    batch_size = 8  # ~8 matches per "day"
    bankroll = initial_bankroll
    bankroll_history = [bankroll]
    all_bets = []
    all_parlays_placed = []
    daily_returns = []

    total_staked = 0
    total_won = 0
    total_lost = 0
    total_pnl = 0

    # Calibration tracking
    all_predicted_probs = []
    all_actual_outcomes = []

    for batch_start in range(0, len(matches_sorted), batch_size):
        batch = matches_sorted[batch_start:batch_start + batch_size]

        if bankroll < initial_bankroll * 0.5:
            log.warning(f"Stop-loss triggered at {format_currency(bankroll)}")
            break

        # Run model
        predicted = model.predict_all(batch)

        # Track calibration data
        for pred in predicted:
            probs = pred.get("model_predictions", {}).get("probabilities", {})
            actual = match_lookup.get(pred["match_id"], {}).get("_actual_result", "")

            if probs and actual:
                all_predicted_probs.append(probs.get("home_win", 0))
                all_actual_outcomes.append(1.0 if actual == "HOME_WIN" else 0.0)

        # Detect value
        value_bets = detector.detect_all_value(predicted)

        if not value_bets:
            daily_returns.append(0)
            bankroll_history.append(bankroll)
            continue

        # Build parlays
        parlays = optimizer.find_optimal_parlays(value_bets, max_results=2)

        day_pnl = 0

        for parlay in parlays:
            legs = parlay["legs"]
            stake_info = kelly.calculate_parlay_stake(legs)
            stake = stake_info.get("stake", 0)

            if stake <= 0:
                continue

            # Check result
            won = evaluate_parlay(parlay, match_lookup)
            payout = stake * parlay["combined_odds"] if won else 0

            pnl = payout - stake
            day_pnl += pnl
            total_staked += stake
            total_pnl += pnl

            if won:
                total_won += 1
                bankroll += payout
            else:
                total_lost += 1
                bankroll -= stake

            all_bets.append({
                "stake": stake,
                "odds": parlay["combined_odds"],
                "prob": parlay["combined_prob"],
                "won": won,
                "pnl": pnl,
                "num_legs": parlay["num_legs"],
                "bankroll_after": bankroll,
            })

            all_parlays_placed.append(parlay)

        kelly.set_bankroll(bankroll)
        kelly.reset_daily()
        daily_returns.append(day_pnl)
        bankroll_history.append(bankroll)

    # Calculate metrics
    total_bets = total_won + total_lost
    win_rate = total_won / total_bets * 100 if total_bets > 0 else 0
    roi = total_pnl / total_staked * 100 if total_staked > 0 else 0

    # Max drawdown
    peak = bankroll_history[0]
    max_dd = 0
    max_dd_pct = 0
    for bh in bankroll_history:
        if bh > peak:
            peak = bh
        dd = peak - bh
        dd_pct = dd / peak * 100 if peak > 0 else 0
        if dd > max_dd:
            max_dd = dd
            max_dd_pct = dd_pct

    # Sharpe ratio (annualized, assuming ~250 trading days)
    if daily_returns:
        returns_arr = np.array(daily_returns)
        mean_return = returns_arr.mean()
        std_return = returns_arr.std()
        sharpe = (mean_return / std_return * math.sqrt(250)) if std_return > 0 else 0
    else:
        sharpe = 0

    # Calibration
    cal_stats = None
    if len(all_predicted_probs) > 20:
        cal_stats = compute_calibration_stats(
            np.array(all_predicted_probs),
            np.array(all_actual_outcomes)
        )

    results = {
        "initial_bankroll": initial_bankroll,
        "final_bankroll": round(bankroll, 2),
        "total_pnl": round(total_pnl, 2),
        "roi_pct": round(roi, 2),
        "total_bets": total_bets,
        "wins": total_won,
        "losses": total_lost,
        "win_rate_pct": round(win_rate, 1),
        "total_staked": round(total_staked, 2),
        "avg_stake": round(total_staked / total_bets, 2) if total_bets > 0 else 0,
        "avg_odds": round(
            sum(b["odds"] for b in all_bets) / len(all_bets), 2
        ) if all_bets else 0,
        "max_drawdown": round(max_dd, 2),
        "max_drawdown_pct": round(max_dd_pct, 1),
        "sharpe_ratio": round(sharpe, 3),
        "num_days": len(daily_returns),
        "profitable_days": sum(1 for r in daily_returns if r > 0),
        "losing_days": sum(1 for r in daily_returns if r < 0),
        "flat_days": sum(1 for r in daily_returns if r == 0),
        "calibration": cal_stats,
        "bankroll_history": [round(b, 2) for b in bankroll_history],
    }

    return results


def format_backtest_report(results: dict) -> str:
    """Format backtesting results into a readable report."""
    lines = []

    lines.append("")
    lines.append("═" * 60)
    lines.append("  BACKTEST RESULTS")
    lines.append("═" * 60)
    lines.append("")

    lines.append(f"  Initial Bankroll:  {format_currency(results['initial_bankroll'])}")
    lines.append(f"  Final Bankroll:    {format_currency(results['final_bankroll'])}")
    lines.append(f"  Total P&L:         {format_currency(results['total_pnl'])}")
    lines.append(f"  ROI:               {results['roi_pct']:+.2f}%")
    lines.append("")

    lines.append("─" * 60)
    lines.append("  BET STATISTICS")
    lines.append("─" * 60)
    lines.append(f"  Total Bets:        {results['total_bets']}")
    lines.append(f"  Wins:              {results['wins']}")
    lines.append(f"  Losses:            {results['losses']}")
    lines.append(f"  Win Rate:          {results['win_rate_pct']:.1f}%")
    lines.append(f"  Total Staked:      {format_currency(results['total_staked'])}")
    lines.append(f"  Avg Stake:         {format_currency(results['avg_stake'])}")
    lines.append(f"  Avg Parlay Odds:   {results['avg_odds']:.2f}")
    lines.append("")

    lines.append("─" * 60)
    lines.append("  RISK METRICS")
    lines.append("─" * 60)
    lines.append(f"  Max Drawdown:      {format_currency(results['max_drawdown'])} "
                 f"({results['max_drawdown_pct']:.1f}%)")
    lines.append(f"  Sharpe Ratio:      {results['sharpe_ratio']:.3f}")
    lines.append(f"  Simulation Days:   {results['num_days']}")
    lines.append(f"  Profitable Days:   {results['profitable_days']}")
    lines.append(f"  Losing Days:       {results['losing_days']}")
    lines.append(f"  Flat Days:         {results['flat_days']}")
    lines.append("")

    # Calibration
    cal = results.get("calibration")
    if cal:
        lines.append("─" * 60)
        lines.append("  MODEL CALIBRATION")
        lines.append("─" * 60)
        lines.append(f"  ECE (Expected Calibration Error): {cal['ece']:.4f}")
        lines.append(f"  Brier Score:       {cal['brier_score']:.4f}")
        lines.append(f"  Samples:           {cal['n_samples']}")
        lines.append("")
        lines.append("  Reliability Diagram:")
        lines.append(f"  {'Predicted':>12} {'Actual':>10} {'Count':>8} {'Gap':>8}")
        for b in cal.get("bins", []):
            lines.append(f"  {format_pct(b['predicted_mean']):>12} "
                         f"{format_pct(b['actual_mean']):>10} "
                         f"{b['count']:>8} "
                         f"{format_pct(b['gap']):>8}")
        lines.append("")

    lines.append("═" * 60)
    lines.append("")

    # Bankroll chart (ASCII)
    history = results.get("bankroll_history", [])
    if len(history) > 5:
        lines.append("  BANKROLL OVER TIME")
        lines.append("─" * 60)

        min_b = min(history)
        max_b = max(history)
        chart_width = 50
        chart_height = 12

        if max_b > min_b:
            # Sample points for chart
            step = max(1, len(history) // chart_width)
            sampled = history[::step]

            for row in range(chart_height, -1, -1):
                threshold = min_b + (max_b - min_b) * row / chart_height
                line = "  "
                if row == chart_height:
                    line += f"{format_currency(max_b):>10} │"
                elif row == 0:
                    line += f"{format_currency(min_b):>10} │"
                elif row == chart_height // 2:
                    mid = (max_b + min_b) / 2
                    line += f"{format_currency(mid):>10} │"
                else:
                    line += "           │"

                for val in sampled:
                    if val >= threshold:
                        line += "█"
                    else:
                        line += " "
                lines.append(line)

            lines.append("           └" + "─" * len(sampled))
            lines.append("")

    lines.append("═" * 60)
    lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Soccer Parlay Backtesting")
    parser.add_argument("--seasons", nargs="+", type=int, default=[2024],
                        help="Seasons to backtest (e.g. 2023 2024)")
    parser.add_argument("--bankroll", type=float, default=1000.0,
                        help="Starting bankroll")
    parser.add_argument("--demo", action="store_true",
                        help="Run with synthetic data (no API keys needed)")
    parser.add_argument("--matches", type=int, default=500,
                        help="Number of synthetic matches for demo mode")
    parser.add_argument("--output", "-o", type=str, default=None,
                        help="Output file for results")
    args = parser.parse_args()

    log.info("=" * 50)
    log.info("Starting backtesting")
    log.info("=" * 50)

    if args.demo:
        log.info("Running in DEMO mode with synthetic data")
        matches = generate_synthetic_data(n_matches=args.matches)
    else:
        log.info(f"Fetching historical data for seasons: {args.seasons}")
        client = FootballDataClient()
        cfg = load_config()
        leagues = cfg.get("leagues", [])

        matches = []
        for season in args.seasons:
            for league in leagues:
                log.info(f"Fetching {league['name']} {season}...")
                data = client.get_matches(league["code"], season=season,
                                          status="FINISHED")
                if data and "matches" in data:
                    for m in data["matches"]:
                        # Convert to our format (simplified for backtest)
                        score = m.get("score", {})
                        ft = score.get("fullTime", {})
                        home_goals = ft.get("home")
                        away_goals = ft.get("away")

                        if home_goals is None or away_goals is None:
                            continue

                        if home_goals > away_goals:
                            result = "HOME_WIN"
                        elif home_goals == away_goals:
                            result = "DRAW"
                        else:
                            result = "AWAY_WIN"

                        matches.append({
                            "match_id": str(m.get("id", "")),
                            "home_team": m.get("homeTeam", {}).get("name", ""),
                            "away_team": m.get("awayTeam", {}).get("name", ""),
                            "league": league["name"],
                            "league_code": league["code"],
                            "commence_time": m.get("utcDate", ""),
                            "_actual_result": result,
                            "_actual_home_goals": home_goals,
                            "_actual_away_goals": away_goals,
                            "_actual_total_goals": home_goals + away_goals,
                        })

        if not matches:
            log.warning("No historical data available. Try --demo mode.")
            print("\n⚠️  No historical data. Run with --demo for synthetic data:\n"
                  "    python backtest.py --demo\n")
            return

    # Run backtest
    results = run_backtest(matches, initial_bankroll=args.bankroll)

    # Format and print report
    report = format_backtest_report(results)
    print(report)

    # Save
    output_path = args.output or f"reports/backtest_{datetime.now().strftime('%Y%m%d_%H%M')}.txt"
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        f.write(report)

    # Also save raw results as JSON
    json_path = output_path.replace(".txt", ".json")
    with open(json_path, "w") as f:
        json.dump(results, f, indent=2)

    log.info(f"Results saved to {output_path}")
    log.info(f"Raw data saved to {json_path}")


if __name__ == "__main__":
    main()
