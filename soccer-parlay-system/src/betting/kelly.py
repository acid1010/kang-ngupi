"""Fractional Kelly criterion for bet sizing.

Based on Uhrín et al. (2021):
- Full Kelly is optimal but volatile
- Fractional Kelly (25-30%) provides better risk-adjusted returns
- Hard caps prevent catastrophic losses
"""

from src.utils.helpers import load_config, format_currency
from src.utils.logger import get_logger

log = get_logger("kelly")


class KellyCriterion:
    """Fractional Kelly bet sizing with safety caps."""

    def __init__(self, bankroll: float = None):
        cfg = load_config()
        br_cfg = cfg.get("bankroll", {})

        self.bankroll = bankroll or br_cfg.get("initial", 1000.0)
        self.kelly_fraction = br_cfg.get("kelly_fraction", 0.25)
        self.max_bet_pct = br_cfg.get("max_bet_pct", 0.02)
        self.min_bet_pct = br_cfg.get("min_bet_pct", 0.005)
        self.daily_exposure_pct = br_cfg.get("daily_exposure_pct", 0.05)
        self.stop_loss_pct = br_cfg.get("stop_loss_pct", 0.50)

        self._daily_wagered = 0.0

    def set_bankroll(self, bankroll: float) -> None:
        """Update current bankroll."""
        self.bankroll = bankroll

    def reset_daily(self) -> None:
        """Reset daily exposure tracking."""
        self._daily_wagered = 0.0

    def full_kelly(self, prob: float, odds: float) -> float:
        """Calculate full Kelly fraction.

        f* = (p * b - q) / b
        where:
            p = probability of winning
            q = 1 - p = probability of losing
            b = decimal odds - 1 (net profit per unit wagered)

        Returns fraction of bankroll to wager (can be negative = don't bet).
        """
        if odds <= 1.0 or prob <= 0 or prob >= 1:
            return 0.0

        b = odds - 1.0
        q = 1.0 - prob
        f = (prob * b - q) / b

        return max(0.0, f)

    def fractional_kelly(self, prob: float, odds: float) -> float:
        """Calculate fractional Kelly (conservative).

        Returns fraction of bankroll to wager.
        """
        f = self.full_kelly(prob, odds)
        return f * self.kelly_fraction

    def calculate_stake(self, prob: float, odds: float) -> dict:
        """Calculate recommended stake with all safety checks.

        Args:
            prob: Model's estimated probability of the bet winning
            odds: Decimal odds offered

        Returns:
            Dict with stake amount, kelly fraction, and reasoning.
        """
        cfg = load_config()
        initial = cfg.get("bankroll", {}).get("initial", 1000.0)

        # Check stop-loss
        if self.bankroll < initial * self.stop_loss_pct:
            return {
                "stake": 0.0,
                "kelly_fraction": 0.0,
                "reason": "STOP_LOSS — bankroll below threshold",
                "bankroll": self.bankroll,
            }

        # Check daily exposure
        max_daily = self.bankroll * self.daily_exposure_pct
        remaining_daily = max_daily - self._daily_wagered
        if remaining_daily <= 0:
            return {
                "stake": 0.0,
                "kelly_fraction": 0.0,
                "reason": "DAILY_LIMIT — exposure cap reached",
                "bankroll": self.bankroll,
            }

        # Calculate Kelly
        fk = self.fractional_kelly(prob, odds)

        if fk <= 0:
            return {
                "stake": 0.0,
                "kelly_fraction": 0.0,
                "reason": "NO_EDGE — Kelly says don't bet",
                "bankroll": self.bankroll,
            }

        # Apply caps
        stake = fk * self.bankroll
        max_stake = self.bankroll * self.max_bet_pct
        min_stake = self.bankroll * self.min_bet_pct

        capped = False
        if stake > max_stake:
            stake = max_stake
            capped = True
        if stake > remaining_daily:
            stake = remaining_daily
            capped = True
        if stake < min_stake:
            # Below minimum — skip this bet
            return {
                "stake": 0.0,
                "kelly_fraction": fk,
                "reason": "BELOW_MIN — stake too small",
                "bankroll": self.bankroll,
            }

        # Round to nearest 0.50
        stake = round(stake * 2) / 2

        return {
            "stake": stake,
            "kelly_fraction": round(fk, 6),
            "full_kelly": round(self.full_kelly(prob, odds), 6),
            "pct_of_bankroll": round(stake / self.bankroll * 100, 2),
            "capped": capped,
            "reason": "OK",
            "bankroll": self.bankroll,
        }

    def calculate_parlay_stake(self, legs: list[dict]) -> dict:
        """Calculate stake for a parlay bet.

        For parlays, we use the combined probability and combined odds,
        then apply fractional Kelly with tighter caps (1-2% bankroll).

        Args:
            legs: List of value bet dicts, each with model_prob and odds.

        Returns:
            Stake recommendation dict.
        """
        if not legs:
            return {"stake": 0.0, "reason": "NO_LEGS"}

        # Combined probability (assuming independence)
        combined_prob = 1.0
        combined_odds = 1.0
        for leg in legs:
            combined_prob *= leg["model_prob"]
            combined_odds *= leg["odds"]

        # For parlays, use tighter max (1.5% instead of 2%)
        parlay_max_pct = min(self.max_bet_pct, 0.015)

        result = self.calculate_stake(combined_prob, combined_odds)

        # Apply parlay-specific cap
        parlay_max = self.bankroll * parlay_max_pct
        if result["stake"] > parlay_max:
            result["stake"] = round(parlay_max * 2) / 2
            result["capped"] = True

        result["combined_prob"] = round(combined_prob, 6)
        result["combined_odds"] = round(combined_odds, 3)
        result["num_legs"] = len(legs)
        result["potential_payout"] = round(result["stake"] * combined_odds, 2)

        return result

    def record_wager(self, amount: float) -> None:
        """Record a wager for daily exposure tracking."""
        self._daily_wagered += amount

    @property
    def daily_remaining(self) -> float:
        """Remaining daily exposure budget."""
        max_daily = self.bankroll * self.daily_exposure_pct
        return max(0, max_daily - self._daily_wagered)
