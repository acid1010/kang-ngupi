"""Bankroll management and tracking.

Tracks bets, results, P&L, and generates performance metrics.
"""

import json
import os
from datetime import datetime, date
from typing import Optional

from src.utils.helpers import get_project_root, format_currency
from src.utils.logger import get_logger

log = get_logger("bankroll")


class BankrollTracker:
    """Track bankroll, bets, and performance over time."""

    def __init__(self, initial_bankroll: float = 1000.0,
                 state_file: str = None):
        self.initial_bankroll = initial_bankroll
        self.current_bankroll = initial_bankroll

        if state_file is None:
            state_file = str(get_project_root() / "data" / "bankroll_state.json")
        self.state_file = state_file

        self.bets: list[dict] = []
        self.daily_pnl: dict[str, float] = {}

        self._load_state()

    def _load_state(self) -> None:
        """Load saved state if it exists."""
        if os.path.exists(self.state_file):
            try:
                with open(self.state_file, "r") as f:
                    state = json.load(f)
                self.current_bankroll = state.get("current_bankroll", self.initial_bankroll)
                self.initial_bankroll = state.get("initial_bankroll", self.initial_bankroll)
                self.bets = state.get("bets", [])
                self.daily_pnl = state.get("daily_pnl", {})
                log.info(f"Loaded bankroll state: {format_currency(self.current_bankroll)}")
            except Exception as e:
                log.warning(f"Could not load bankroll state: {e}")

    def save_state(self) -> None:
        """Persist current state."""
        os.makedirs(os.path.dirname(self.state_file), exist_ok=True)
        state = {
            "current_bankroll": self.current_bankroll,
            "initial_bankroll": self.initial_bankroll,
            "bets": self.bets[-500:],  # Keep last 500 bets
            "daily_pnl": self.daily_pnl,
            "last_updated": datetime.now().isoformat(),
        }
        with open(self.state_file, "w") as f:
            json.dump(state, f, indent=2)

    def record_bet(self, parlay: dict, stake: float) -> str:
        """Record a placed bet.

        Returns bet_id for later result recording.
        """
        bet_id = f"BET-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{len(self.bets)}"

        bet = {
            "bet_id": bet_id,
            "timestamp": datetime.now().isoformat(),
            "date": date.today().isoformat(),
            "stake": stake,
            "combined_odds": parlay.get("combined_odds", 0),
            "combined_prob": parlay.get("combined_prob", 0),
            "num_legs": parlay.get("num_legs", 0),
            "legs": [
                {
                    "home": l.get("home_team", ""),
                    "away": l.get("away_team", ""),
                    "selection": l.get("selection", ""),
                    "odds": l.get("odds", 0),
                    "edge": l.get("edge", 0),
                }
                for l in parlay.get("legs", [])
            ],
            "potential_payout": round(stake * parlay.get("combined_odds", 0), 2),
            "result": "pending",
            "pnl": 0.0,
        }

        self.bets.append(bet)
        self.current_bankroll -= stake
        self.save_state()

        log.info(f"Recorded bet {bet_id}: stake={format_currency(stake)}, "
                 f"odds={parlay.get('combined_odds', 0):.2f}")
        return bet_id

    def record_result(self, bet_id: str, won: bool) -> dict:
        """Record the result of a bet."""
        for bet in self.bets:
            if bet["bet_id"] == bet_id:
                bet["result"] = "won" if won else "lost"

                if won:
                    payout = bet["potential_payout"]
                    bet["pnl"] = round(payout - bet["stake"], 2)
                    self.current_bankroll += payout
                else:
                    bet["pnl"] = -bet["stake"]

                # Update daily P&L
                bet_date = bet["date"]
                self.daily_pnl[bet_date] = self.daily_pnl.get(bet_date, 0) + bet["pnl"]

                self.save_state()
                log.info(f"Bet {bet_id}: {'WON' if won else 'LOST'}, "
                         f"P&L={format_currency(bet['pnl'])}")
                return bet

        log.warning(f"Bet {bet_id} not found")
        return {}

    def get_performance(self) -> dict:
        """Calculate overall performance metrics."""
        if not self.bets:
            return {"message": "No bets recorded yet"}

        settled = [b for b in self.bets if b["result"] != "pending"]
        if not settled:
            return {"message": "No settled bets yet"}

        total_staked = sum(b["stake"] for b in settled)
        total_pnl = sum(b["pnl"] for b in settled)
        wins = sum(1 for b in settled if b["result"] == "won")
        losses = sum(1 for b in settled if b["result"] == "lost")

        roi = total_pnl / total_staked * 100 if total_staked > 0 else 0

        # Calculate max drawdown
        running_pnl = []
        cumulative = 0
        for b in settled:
            cumulative += b["pnl"]
            running_pnl.append(cumulative)

        peak = 0
        max_dd = 0
        for pnl in running_pnl:
            if pnl > peak:
                peak = pnl
            dd = peak - pnl
            if dd > max_dd:
                max_dd = dd

        return {
            "current_bankroll": round(self.current_bankroll, 2),
            "initial_bankroll": self.initial_bankroll,
            "total_pnl": round(total_pnl, 2),
            "roi_pct": round(roi, 2),
            "total_bets": len(settled),
            "wins": wins,
            "losses": losses,
            "win_rate": round(wins / len(settled) * 100, 1) if settled else 0,
            "total_staked": round(total_staked, 2),
            "avg_stake": round(total_staked / len(settled), 2) if settled else 0,
            "avg_odds": round(
                sum(b["combined_odds"] for b in settled) / len(settled), 2
            ) if settled else 0,
            "max_drawdown": round(max_dd, 2),
            "pending_bets": sum(1 for b in self.bets if b["result"] == "pending"),
        }
