# Soccer Parlay Betting System

A research-backed soccer parlay (accumulator) betting analysis system built on principles from:
- **Dmochowski (2023)** — Median estimation & quantile-based edge detection
- **Uhrín et al. (2021)** — Kelly criterion, fractional Kelly, portfolio theory
- **Walsh & Joshi (2024)** — ML calibration > accuracy for sports betting

## Key Principles

| Principle | Implementation |
|-----------|---------------|
| Calibration > Accuracy | Platt-scaled Poisson model with reliability diagrams |
| Median estimation | Quantile-based edge detection, not mean EV |
| Fractional Kelly (25%) | Conservative bet sizing with hard caps |
| Skip weak edges | >60% of matches filtered out (min 5% edge) |
| Max 3 parlay legs | Combinatorial optimizer with correlation penalty |
| Uncorrelated legs | Different leagues/kickoff times preferred |
| CLV tracking | Closing Line Value logged for profitability analysis |
| xG integration | FBref xG data blended 60/40 with goals-based model |
| Auto-collection | Predictions + results auto-saved for evaluation |
| Form momentum | Weighted recent form with momentum detection |
| Odds sweet spot | 1.50–2.50 per leg preferred |

## Project Structure

```
soccer-parlay-system/
├── config/
│   └── settings.yaml          # All configuration (API keys, thresholds, etc.)
├── data/
│   ├── raw/                   # Raw API responses cached
│   ├── processed/             # Cleaned datasets
│   └── backtest/              # Historical backtest data
├── models/                    # Saved model artifacts
├── src/
│   ├── data/
│   │   ├── odds_client.py     # The Odds API client
│   │   ├── football_data_client.py  # Football-Data.org client
│   │   └── data_pipeline.py   # Unified data pipeline
│   ├── models/
│   │   ├── poisson_model.py   # Calibrated Poisson regression
│   │   └── calibration.py     # Platt scaling & reliability checks
│   ├── betting/
│   │   ├── value_detector.py  # Edge detection (model vs. bookmaker)
│   │   ├── parlay_optimizer.py # Optimal 2-3 leg parlay selection
│   │   ├── kelly.py           # Fractional Kelly bet sizing
│   │   └── bankroll.py        # Bankroll management & tracking
│   └── utils/
│       ├── logger.py          # Structured logging
│       └── helpers.py         # Shared utilities
├── tests/
│   └── test_system.py         # Unit & integration tests
├── backtest.py                # Historical backtesting framework
├── daily_picks.py             # Main entry: today's picks & parlays
├── requirements.txt
└── README.md
```

## Quick Start

### 1. Install dependencies

```bash
cd soccer-parlay-system
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure API keys

Edit `config/settings.yaml`:

```yaml
apis:
  odds_api_key: "YOUR_KEY_HERE"        # https://the-odds-api.com (free tier: 500 req/month)
  football_data_key: "YOUR_KEY_HERE"   # https://www.football-data.org (free tier)
```

### 3. Run daily picks

```bash
python daily_picks.py
```

### 4. Run backtesting

```bash
python backtest.py --seasons 2023 2024 --bankroll 1000
```

### 5. Run tests

```bash
python -m pytest tests/ -v
```

## API Keys (Free Tiers)

### The Odds API
1. Sign up at https://the-odds-api.com
2. Free tier: 500 requests/month
3. Copy your API key to `config/settings.yaml`

### Football-Data.org
1. Sign up at https://www.football-data.org/client/register
2. Free tier: 10 requests/minute, major leagues
3. Copy your API token to `config/settings.yaml`

## How It Works

### Data Pipeline
1. Fetch upcoming matches + odds from The Odds API
2. Fetch team statistics from Football-Data.org
3. Merge into unified match dataset

### Probability Model
1. **Poisson Regression**: Predict expected goals for home/away teams based on:
   - Attack strength (goals scored / league average)
   - Defense strength (goals conceded / league average)
   - Home advantage factor
2. **Match Outcome Probabilities**: Convert goal expectations to Home/Draw/Away probabilities
3. **Calibration**: Platt scaling ensures predicted probabilities match observed frequencies

### Value Detection
1. Convert bookmaker odds to implied probabilities (remove vig)
2. Compare model probabilities vs. implied probabilities
3. Flag edges > 5% as value bets
4. Apply Dmochowski's median-based edge estimation

### Parlay Optimization
1. From value bets, enumerate all 2-3 leg combinations
2. Score each parlay by:
   - Combined expected value
   - Correlation penalty (same league/time = bad)
   - Odds sweet spot bonus (1.50-2.50 per leg)
3. Select top N parlays by score

### Bet Sizing
1. Fractional Kelly (25%) for each parlay
2. Hard cap: 1-2% of bankroll per parlay
3. Daily exposure limit: 5% of bankroll

## Output Example

```
═══════════════════════════════════════════════════════
  DAILY PARLAY PICKS — 2026-04-28
  Bankroll: $1,000.00 | Model: Poisson v1.2
═══════════════════════════════════════════════════════

🎯 PARLAY #1 — Expected Value: +12.3%
  Combined Odds: 3.42 | Confidence: HIGH
  Recommended Stake: $15.00 (1.5% bankroll)

  Leg 1: Arsenal vs Chelsea — Arsenal Win
    Model: 58.2% | Implied: 48.1% | Edge: +10.1%
    Odds: 2.08 (Pinnacle)

  Leg 2: Bayern vs Dortmund — Over 2.5
    Model: 71.5% | Implied: 63.2% | Edge: +8.3%
    Odds: 1.58 (Bet365)

  ✅ Legs uncorrelated (different leagues)
  ✅ Both legs in sweet spot (1.50-2.50)

───────────────────────────────────────────────────────
  Matches analyzed: 47 | Value bets found: 8 (17%)
  Matches skipped: 39 (83%) — insufficient edge
═══════════════════════════════════════════════════════
```

## Backtesting Results

Run `python backtest.py` to see historical performance metrics:
- **ROI**: Return on investment per period
- **Sharpe Ratio**: Risk-adjusted returns
- **Max Drawdown**: Worst peak-to-trough decline
- **CLV Correlation**: Closing line value tracking
- **Calibration Plot**: Predicted vs. actual probability reliability

## Disclaimer

This system is for **educational and research purposes only**. Sports betting involves financial risk. Past performance does not guarantee future results. Always gamble responsibly and within your means. Check local laws regarding sports betting in your jurisdiction.
