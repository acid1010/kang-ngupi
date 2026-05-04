"""Shared utility functions."""

import json
import os
import hashlib
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

import yaml


_config_cache = None
_config_path = None


def load_config(config_path: str = None) -> dict:
    """Load YAML configuration with caching."""
    global _config_cache, _config_path

    if config_path is None:
        config_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            "config", "settings.yaml"
        )

    if _config_cache is not None and _config_path == config_path:
        return _config_cache

    with open(config_path, "r") as f:
        _config_cache = yaml.safe_load(f)
        _config_path = config_path

    return _config_cache


def get_project_root() -> Path:
    """Get the project root directory."""
    return Path(__file__).parent.parent.parent


def cache_path(category: str, key: str) -> Path:
    """Get a cache file path for a given category and key."""
    root = get_project_root()
    safe_key = hashlib.md5(key.encode()).hexdigest()[:12]
    path = root / "data" / "raw" / category / f"{safe_key}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def read_cache(category: str, key: str, ttl_minutes: int = 30) -> Optional[Any]:
    """Read cached data if it exists and is fresh."""
    path = cache_path(category, key)
    if not path.exists():
        return None

    mtime = datetime.fromtimestamp(path.stat().st_mtime)
    if datetime.now() - mtime > timedelta(minutes=ttl_minutes):
        return None

    with open(path, "r") as f:
        return json.load(f)


def write_cache(category: str, key: str, data: Any) -> None:
    """Write data to cache."""
    path = cache_path(category, key)
    with open(path, "w") as f:
        json.dump(data, f, indent=2, default=str)


def implied_probability(decimal_odds: float) -> float:
    """Convert decimal odds to implied probability."""
    if decimal_odds <= 1.0:
        return 1.0
    return 1.0 / decimal_odds


def remove_vig(probs: list[float]) -> list[float]:
    """Remove bookmaker vig (overround) from implied probabilities.

    Uses the multiplicative method: divide each probability by the sum.
    """
    total = sum(probs)
    if total == 0:
        return probs
    return [p / total for p in probs]


def decimal_to_american(decimal_odds: float) -> str:
    """Convert decimal odds to American format."""
    if decimal_odds >= 2.0:
        return f"+{int((decimal_odds - 1) * 100)}"
    else:
        return f"-{int(100 / (decimal_odds - 1))}"


def format_currency(amount: float) -> str:
    """Format a number as currency."""
    return f"${amount:,.2f}"


def format_pct(value: float, decimals: int = 1) -> str:
    """Format a decimal as percentage string."""
    return f"{value * 100:.{decimals}f}%"
