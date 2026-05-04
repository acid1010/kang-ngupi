#!/usr/bin/env python3
"""Historical backtester v2 — with improvements:
1. All 6 leagues working
2. Higher edge threshold (8%)
3. Odds sweet spot filter (1.50-2.50)
4. Form-weighted lambda adjustment
5. Per-league home advantage
6. Skip early season (matchday < 6)
7. Calibrator integration
"""

import os, sys, json, math, pickle
from datetime import datetime
from pathlib import Path
from collections import defaultdict

import pandas as pd
import numpy as np
from scipy.stats import poisson

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

DATA_DIR = Path(__file__).parent / "data" / "historical"
MODEL_DIR = Path(__file__).parent / "data" / "models"

# Per-league home advantage (empirical from football research)
LEAGUE_HOME_ADV = {
    "EPL": 0.25, "Bundesliga": 0.28, "SerieA": 0.30,
    "LaLiga": 0.27, "Ligue1": 0.26, "Eredivisie": 0.32,
}
DEFAULT_HOME_ADV = 0.28

ODDS_H = ["B365H", "BWH", "PSH", "WHH", "VCH", "IWH", "1XBH", "BFDH", "BFH", "LBH", "AvgH"]
ODDS_D = ["B365D", "BWD", "PSD", "WHD", "VCD", "IWD", "1XBD", "BFDD", "BFD", "LBD", "AvgD"]
ODDS_A = ["B365A", "BWA", "PSA", "WHA", "VCA", "IWA", "1XBA", "BFDA", "BFA", "LBA", "AvgA"]
ODDS_O25 = ["B365>2.5", "P>2.5", "Avg>2.5", "BFE>2.5"]
ODDS_U25 = ["B365<2.5", "P<2.5", "Avg<2.5", "BFE<2.5"]

MIN_MATCHES = 6
EDGE_THRESHOLD = 0.08  # Raised from 5% to 8%
ODDS_MIN = 1.50  # Sweet spot
ODDS_MAX = 2.50
KELLY_FRACTION = 0.25
MAX_BET_PCT = 0.02
INITIAL_BANKROLL = 1000.0
MAX_GOALS = 8
FORM_WEIGHT = 0.15  # How much form adjusts lambda


def avg_odds(row, cols):
    vals = [float(row[c]) for c in cols if c in row.index and pd.notna(row[c]) and float(row[c]) > 1.0]
    return np.mean(vals) if vals else None


def implied_prob(odds):
    return 1.0 / odds if odds and odds > 1.0 else None


def form_score(results):
    """Calculate form from last 5 results. W=3, D=1, L=0. Returns 0-1."""
    if not results:
        return 0.5
    recent = results[-5:]
    weights = {"W": 3, "D": 1, "L": 0}
    total = sum(weights.get(r, 0) for r in recent)
    return total / (len(recent) * 3)


def poisson_probs(lam_h, lam_a):
    n = MAX_GOALS + 1
    matrix = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            matrix[i][j] = poisson.pmf(i, lam_h) * poisson.pmf(j, lam_a)
    hw = sum(matrix[i][j] for i in range(n) for j in range(n) if i > j)
    dr = sum(matrix[i][j] for i in range(n) for j in range(n) if i == j)
    aw = sum(matrix[i][j] for i in range(n) for j in range(n) if i < j)
    t = hw + dr + aw
    o25 = 1.0 - sum(matrix[i][j] for i in range(n) for j in range(n) if i + j < 3)
    return {"home": hw/t, "draw": dr/t, "away": aw/t, "over25": o25, "under25": 1-o25}


def calibrate_prob(prob, calibrator):
    if not calibrator:
        return prob
    a, b = calibrator["a"], calibrator["b"]
    return 1.0 / (1.0 + np.exp(-(a * prob + b)))


def kelly_stake(edge, odds, bankroll):
    if edge <= 0 or odds <= 1:
        return 0
    p = edge + implied_prob(odds)
    q = 1 - p
    b = odds - 1
    f = (b * p - q) / b if b > 0 else 0
    f = max(0, f) * KELLY_FRACTION
    f = min(f, MAX_BET_PCT)
    return round(f * bankroll, 2)


def load_calibrator():
    path = MODEL_DIR / "calibrator.json"
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return None


def load_all_csvs():
    frames = []
    for f in sorted(DATA_DIR.glob("*.csv")):
        try:
            df = pd.read_csv(f, encoding="utf-8", on_bad_lines="skip")
        except Exception:
            df = pd.read_csv(f, encoding="latin-1", on_bad_lines="skip")
        if "HomeTeam" not in df.columns:
            continue
        df = df.dropna(subset=["HomeTeam", "AwayTeam", "FTHG", "FTAG", "FTR"])
        df["FTHG"] = pd.to_numeric(df["FTHG"], errors="coerce")
        df["FTAG"] = pd.to_numeric(df["FTAG"], errors="coerce")
        df = df.dropna(subset=["FTHG", "FTAG"])
        df["FTHG"] = df["FTHG"].astype(int)
        df["FTAG"] = df["FTAG"].astype(int)
        # Extract league from filename
        stem = f.stem  # e.g. "EPL_2324"
        league = stem.rsplit("_", 1)[0]
        df = df.copy()
        df["league"] = league
        df["source_file"] = f.name
        frames.append(df)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def run_backtest(use_calibrator=True):
    calibrator = load_calibrator() if use_calibrator else None
    cal_label = "WITH calibration" if calibrator else "WITHOUT calibration"
    
    df = load_all_csvs()
    if df.empty:
        print("No data!")
        return

    print(f"\n{'='*60}")
    print(f"  HISTORICAL BACKTEST v2 ({cal_label})")
    print(f"  Edge threshold: {EDGE_THRESHOLD*100:.0f}% | Odds: {ODDS_MIN}-{ODDS_MAX}")
    print(f"{'='*60}")
    print(f"  {len(df)} matches from {df['source_file'].nunique()} files")
    print(f"  Leagues: {sorted(df['league'].unique())}\n")

    bankroll = INITIAL_BANKROLL
    peak = bankroll
    max_dd = 0
    total_bets = 0
    wins = 0
    losses = 0
    total_staked = 0.0
    total_returned = 0.0
    cal_pairs = []
    league_stats = defaultdict(lambda: {"bets": 0, "wins": 0, "staked": 0.0, "returned": 0.0})
    bankroll_history = [bankroll]
    returns_list = []

    for source, group in df.groupby("source_file"):
        team_gf = defaultdict(list)  # goals for
        team_ga = defaultdict(list)  # goals against
        team_form = defaultdict(list)  # W/D/L
        league_hg = []
        league_ag = []
        league_name = group["league"].iloc[0]
        home_adv = LEAGUE_HOME_ADV.get(league_name, DEFAULT_HOME_ADV)
        matchday = 0

        for _, row in group.iterrows():
            ht, at = row["HomeTeam"], row["AwayTeam"]
            hg, ag = int(row["FTHG"]), int(row["FTAG"])
            ftr = row["FTR"]
            matchday += 1

            # Skip early season
            if len(team_gf[ht]) >= MIN_MATCHES and len(team_gf[at]) >= MIN_MATCHES and len(league_hg) >= 30:
                avg_h = np.mean(league_hg[-150:]) if league_hg else 1.3
                avg_a = np.mean(league_ag[-150:]) if league_ag else 1.1
                avg_t = (avg_h + avg_a) / 2 if (avg_h + avg_a) > 0 else 1.2

                # Attack/defense strengths (last 10 matches)
                h_att = np.mean(team_gf[ht][-10:]) / avg_t if avg_t else 1.0
                h_def = np.mean(team_ga[ht][-10:]) / avg_t if avg_t else 1.0
                a_att = np.mean(team_gf[at][-10:]) / avg_t if avg_t else 1.0
                a_def = np.mean(team_ga[at][-10:]) / avg_t if avg_t else 1.0

                # Form adjustment
                h_form = form_score(team_form[ht])
                a_form = form_score(team_form[at])
                form_adj_h = 1.0 + FORM_WEIGHT * (h_form - 0.5)  # >0.5 = boost, <0.5 = nerf
                form_adj_a = 1.0 + FORM_WEIGHT * (a_form - 0.5)

                lam_h = max(0.3, min(h_att * a_def * avg_h * (1 + home_adv) * form_adj_h, 4.5))
                lam_a = max(0.2, min(a_att * h_def * avg_a * form_adj_a, 4.0))

                probs = poisson_probs(lam_h, lam_a)

                # Apply calibration
                if calibrator:
                    probs = {k: calibrate_prob(v, calibrator) for k, v in probs.items()}
                    # Re-normalize 1X2
                    t = probs["home"] + probs["draw"] + probs["away"]
                    if t > 0:
                        probs["home"] /= t
                        probs["draw"] /= t
                        probs["away"] /= t

                # Get odds
                odds_h = avg_odds(row, ODDS_H)
                odds_d = avg_odds(row, ODDS_D)
                odds_a = avg_odds(row, ODDS_A)
                odds_o25 = avg_odds(row, ODDS_O25)

                # Value detection with sweet spot filter
                markets = []
                for sel, prob, odds, actual_won in [
                    ("home", probs["home"], odds_h, ftr == "H"),
                    ("draw", probs["draw"], odds_d, ftr == "D"),
                    ("away", probs["away"], odds_a, ftr == "A"),
                    ("over25", probs["over25"], odds_o25, (hg + ag) > 2.5),
                ]:
                    if not odds:
                        continue
                    imp = implied_prob(odds)
                    edge = prob - imp
                    cal_pairs.append((prob, 1 if actual_won else 0))

                    # Sweet spot + edge filter
                    if edge > EDGE_THRESHOLD and ODDS_MIN <= odds <= ODDS_MAX:
                        markets.append((sel, prob, imp, edge, odds, actual_won))

                # Place bets
                for sel, model_p, imp_p, edge, odds, won in markets:
                    stake = kelly_stake(edge, odds, bankroll)
                    if stake < 1 or bankroll < 10:
                        continue
                    total_bets += 1
                    total_staked += stake
                    ls = league_stats[league_name]
                    ls["bets"] += 1
                    ls["staked"] += stake

                    if won:
                        wins += 1
                        ret = stake * odds
                        total_returned += ret
                        ls["wins"] += 1
                        ls["returned"] += ret
                        bankroll += stake * (odds - 1)
                        returns_list.append((odds - 1))
                    else:
                        losses += 1
                        bankroll -= stake
                        returns_list.append(-1.0)

                    peak = max(peak, bankroll)
                    dd = (peak - bankroll) / peak if peak > 0 else 0
                    max_dd = max(max_dd, dd)
                    bankroll_history.append(bankroll)

            # Update rolling stats
            team_gf[ht].append(hg)
            team_ga[ht].append(ag)
            team_gf[at].append(ag)
            team_ga[at].append(hg)
            if ftr == "H":
                team_form[ht].append("W"); team_form[at].append("L")
            elif ftr == "A":
                team_form[ht].append("L"); team_form[at].append("W")
            else:
                team_form[ht].append("D"); team_form[at].append("D")
            league_hg.append(hg)
            league_ag.append(ag)

            if total_bets > 0 and total_bets % 500 == 0:
                roi = (total_returned - total_staked) / total_staked * 100 if total_staked else 0
                print(f"  [{total_bets} bets] ROI: {roi:+.1f}% | Bankroll: ${bankroll:.2f} | WR: {wins/total_bets*100:.1f}%")

    # Metrics
    roi = (total_returned - total_staked) / total_staked * 100 if total_staked else 0
    wr = wins / total_bets if total_bets else 0
    sharpe = 0
    if returns_list:
        r = np.array(returns_list)
        sharpe = r.mean() / r.std() * math.sqrt(len(r)) if r.std() > 0 else 0

    brier = 0
    ece = 0
    if cal_pairs:
        p, a = np.array([x[0] for x in cal_pairs]), np.array([x[1] for x in cal_pairs])
        brier = float(np.mean((p - a) ** 2))
        bins = np.linspace(0, 1, 11)
        for i in range(10):
            mask = (p >= bins[i]) & (p < bins[i+1])
            if mask.sum() > 0:
                ece += abs(p[mask].mean() - a[mask].mean()) * mask.sum() / len(p)

    print(f"\n{'='*60}")
    print(f"  RESULTS ({cal_label})")
    print(f"{'='*60}")
    print(f"  Total bets: {total_bets} (from {len(df)} matches)")
    print(f"  Wins: {wins} | Losses: {losses} | Win rate: {wr*100:.1f}%")
    print(f"  Staked: ${total_staked:.2f} | Returned: ${total_returned:.2f}")
    print(f"  P&L: ${total_returned - total_staked:+.2f}")
    print(f"  ROI: {roi:+.2f}%")
    print(f"  Final bankroll: ${bankroll:.2f}")
    print(f"  Max drawdown: {max_dd*100:.1f}%")
    print(f"  Sharpe: {sharpe:.3f}")
    print(f"  Brier: {brier:.4f} | ECE: {ece:.4f}")

    print(f"\n  {'League':<15} {'Bets':>6} {'Wins':>6} {'WR%':>7} {'Staked':>10} {'P&L':>10} {'ROI%':>8}")
    print(f"  {'-'*63}")
    for lg in sorted(league_stats.keys()):
        ls = league_stats[lg]
        lr = (ls["returned"]-ls["staked"])/ls["staked"]*100 if ls["staked"] else 0
        lw = ls["wins"]/ls["bets"]*100 if ls["bets"] else 0
        print(f"  {lg:<15} {ls['bets']:>6} {ls['wins']:>6} {lw:>6.1f}% ${ls['staked']:>9.2f} ${ls['returned']-ls['staked']:>+9.2f} {lr:>+7.2f}%")

    # Bankroll chart (last 40 points)
    bh = bankroll_history
    if len(bh) > 40:
        step = max(1, len(bh) // 40)
        bh = [bh[i] for i in range(0, len(bh), step)]
    mn, mx = min(bh), max(bh)
    rng = mx - mn if mx > mn else 1
    print(f"\n  Bankroll:")
    for v in bh[-30:]:
        bar = int((v - mn) / rng * 40)
        print(f"  ${v:>8.2f} |{'█' * bar}")
    print(f"{'='*60}")

    results = {
        "version": "v2", "calibrated": bool(calibrator),
        "edge_threshold": EDGE_THRESHOLD, "odds_range": [ODDS_MIN, ODDS_MAX],
        "matches": len(df), "total_bets": total_bets,
        "wins": wins, "losses": losses, "win_rate": round(wr, 4),
        "staked": round(total_staked, 2), "returned": round(total_returned, 2),
        "pnl": round(total_returned - total_staked, 2), "roi_pct": round(roi, 2),
        "bankroll": round(bankroll, 2), "max_dd": round(max_dd*100, 1),
        "sharpe": round(sharpe, 3), "brier": round(brier, 4), "ece": round(ece, 4),
    }
    out = DATA_DIR / f"backtest_v2{'_cal' if calibrator else ''}.json"
    with open(out, "w") as f:
        json.dump(results, f, indent=2)
    print(f"  Saved to {out}")
    return results


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-calibrator", action="store_true")
    args = parser.parse_args()
    
    # Run without calibrator first
    print("\n" + "▓" * 60)
    r1 = run_backtest(use_calibrator=False)
    
    # Then with calibrator
    print("\n" + "▓" * 60)
    r2 = run_backtest(use_calibrator=True)
    
    # Comparison
    if r1 and r2:
        print(f"\n{'='*60}")
        print(f"  COMPARISON: v2 improvements")
        print(f"{'='*60}")
        print(f"  {'Metric':<20} {'No Cal':>12} {'With Cal':>12} {'Delta':>10}")
        print(f"  {'-'*54}")
        for k in ["total_bets", "win_rate", "roi_pct", "bankroll", "max_dd", "sharpe", "brier", "ece"]:
            v1, v2 = r1.get(k, 0), r2.get(k, 0)
            fmt = ".1f" if k in ["roi_pct", "max_dd"] else ".4f" if k in ["brier", "ece", "win_rate"] else ".2f"
            print(f"  {k:<20} {v1:>12{fmt}} {v2:>12{fmt}} {v2-v1:>+10{fmt}}")
        print(f"{'='*60}")
