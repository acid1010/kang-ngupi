"""Client for The Odds API — fetches live odds for soccer matches.

API docs: https://the-odds-api.com/liveapi/guides/v4/
Free tier: 500 requests/month.
"""

import time
from datetime import datetime, timezone
from typing import Optional

import requests

from src.utils.helpers import load_config, read_cache, write_cache, implied_probability, remove_vig
from src.utils.logger import get_logger

log = get_logger("odds_client")


class OddsClient:
    """Fetch and parse odds from The Odds API."""

    BASE_URL = "https://api.the-odds-api.com/v4"

    def __init__(self, api_key: str = None):
        cfg = load_config()
        self.api_key = api_key or cfg["apis"]["odds_api_key"]
        self.cache_ttl = cfg.get("cache", {}).get("odds_ttl_minutes", 30)
        self._remaining_requests = None

        if self.api_key == "YOUR_ODDS_API_KEY_HERE":
            log.warning("Odds API key not configured — using demo/cached data only")

    def _get(self, endpoint: str, params: dict = None) -> Optional[dict]:
        """Make a GET request with error handling and rate tracking."""
        url = f"{self.BASE_URL}/{endpoint}"
        params = params or {}
        params["apiKey"] = self.api_key

        try:
            resp = requests.get(url, params=params, timeout=15)

            # Track remaining quota
            self._remaining_requests = resp.headers.get("x-requests-remaining")
            if self._remaining_requests:
                log.info(f"Odds API requests remaining: {self._remaining_requests}")

            resp.raise_for_status()
            return resp.json()

        except requests.exceptions.HTTPError as e:
            if resp.status_code == 401:
                log.error("Odds API: Invalid API key")
            elif resp.status_code == 429:
                log.error("Odds API: Rate limit exceeded")
            else:
                log.error(f"Odds API HTTP error: {e}")
            return None
        except requests.exceptions.RequestException as e:
            log.error(f"Odds API request failed: {e}")
            return None

    def get_sports(self) -> list[dict]:
        """Get list of available sports."""
        cache_key = "sports_list"
        cached = read_cache("odds", cache_key, ttl_minutes=1440)  # 24h cache
        if cached:
            return cached

        data = self._get("sports")
        if data:
            write_cache("odds", cache_key, data)
        return data or []

    def get_odds(self, sport_key: str, regions: str = "eu,uk",
                 markets: str = "h2h,totals",
                 odds_format: str = "decimal") -> list[dict]:
        """Fetch current odds for a sport.

        Args:
            sport_key: e.g. "soccer_epl", "soccer_germany_bundesliga"
            regions: Bookmaker regions (eu, uk, us, au)
            markets: h2h (1X2), totals (over/under), spreads
            odds_format: decimal or american

        Returns:
            List of match dicts with odds from multiple bookmakers.
        """
        cache_key = f"odds_{sport_key}_{markets}"
        cached = read_cache("odds", cache_key, ttl_minutes=self.cache_ttl)
        if cached:
            log.info(f"Using cached odds for {sport_key}")
            return cached

        data = self._get(f"sports/{sport_key}/odds", {
            "regions": regions,
            "markets": markets,
            "oddsFormat": odds_format,
        })

        if data:
            write_cache("odds", cache_key, data)
            log.info(f"Fetched {len(data)} matches for {sport_key}")
        return data or []

    def get_all_soccer_odds(self) -> list[dict]:
        """Fetch odds for all configured soccer leagues."""
        cfg = load_config()
        leagues = cfg.get("leagues", [])
        all_matches = []

        for league in leagues:
            sport_key = league["sport_key"]
            log.info(f"Fetching odds for {league['name']} ({sport_key})")
            matches = self.get_odds(sport_key)

            for match in matches:
                match["_league_code"] = league["code"]
                match["_league_name"] = league["name"]

            all_matches.extend(matches)
            time.sleep(0.5)  # Be nice to the API

        log.info(f"Total matches with odds: {len(all_matches)}")
        return all_matches

    @staticmethod
    def parse_match_odds(match: dict) -> Optional[dict]:
        """Parse a single match into a standardized format.

        Returns dict with best odds across bookmakers and fair probabilities.
        """
        try:
            home_team = match.get("home_team", "")
            away_team = match.get("away_team", "")
            commence = match.get("commence_time", "")
            sport_key = match.get("sport_key", "")
            league_name = match.get("_league_name", sport_key)

            bookmakers = match.get("bookmakers", [])
            if not bookmakers:
                return None

            # Find best h2h odds across all bookmakers
            best_home_odds = 0.0
            best_draw_odds = 0.0
            best_away_odds = 0.0
            best_home_book = ""
            best_draw_book = ""
            best_away_book = ""

            # Also collect average odds for fair probability estimation
            all_home, all_draw, all_away = [], [], []

            # Over/under odds
            best_over_odds = 0.0
            best_under_odds = 0.0
            best_ou_book = ""
            best_ou_line = 2.5  # default

            for bm in bookmakers:
                bm_name = bm.get("title", "")
                for market in bm.get("markets", []):
                    if market["key"] == "h2h":
                        outcomes = {o["name"]: o["price"] for o in market["outcomes"]}
                        h = outcomes.get(home_team, 0)
                        d = outcomes.get("Draw", 0)
                        a = outcomes.get(away_team, 0)

                        if h > 0:
                            all_home.append(h)
                        if d > 0:
                            all_draw.append(d)
                        if a > 0:
                            all_away.append(a)

                        if h > best_home_odds:
                            best_home_odds = h
                            best_home_book = bm_name
                        if d > best_draw_odds:
                            best_draw_odds = d
                            best_draw_book = bm_name
                        if a > best_away_odds:
                            best_away_odds = a
                            best_away_book = bm_name

                    elif market["key"] == "totals":
                        for o in market["outcomes"]:
                            point = o.get("point", 2.5)
                            if abs(point - 2.5) < 0.01:  # Standard O/U 2.5
                                if o["name"] == "Over" and o["price"] > best_over_odds:
                                    best_over_odds = o["price"]
                                    best_ou_book = bm_name
                                    best_ou_line = point
                                elif o["name"] == "Under" and o["price"] > best_under_odds:
                                    best_under_odds = o["price"]

            if best_home_odds == 0 or best_draw_odds == 0 or best_away_odds == 0:
                return None

            # Calculate fair probabilities (remove vig from average odds)
            avg_home = sum(all_home) / len(all_home) if all_home else best_home_odds
            avg_draw = sum(all_draw) / len(all_draw) if all_draw else best_draw_odds
            avg_away = sum(all_away) / len(all_away) if all_away else best_away_odds

            implied = [
                implied_probability(avg_home),
                implied_probability(avg_draw),
                implied_probability(avg_away),
            ]
            fair_probs = remove_vig(implied)

            result = {
                "match_id": match.get("id", ""),
                "home_team": home_team,
                "away_team": away_team,
                "league": league_name,
                "league_code": match.get("_league_code", ""),
                "sport_key": sport_key,
                "commence_time": commence,
                "best_odds": {
                    "home": {"odds": best_home_odds, "bookmaker": best_home_book},
                    "draw": {"odds": best_draw_odds, "bookmaker": best_draw_book},
                    "away": {"odds": best_away_odds, "bookmaker": best_away_book},
                },
                "implied_probs": {
                    "home": fair_probs[0],
                    "draw": fair_probs[1],
                    "away": fair_probs[2],
                },
                "over_under": {
                    "line": best_ou_line,
                    "over_odds": best_over_odds,
                    "under_odds": best_under_odds,
                    "bookmaker": best_ou_book,
                } if best_over_odds > 0 else None,
                "num_bookmakers": len(bookmakers),
            }

            return result

        except Exception as e:
            log.error(f"Error parsing match odds: {e}")
            return None

    def get_parsed_odds(self) -> list[dict]:
        """Fetch and parse all soccer odds into standardized format."""
        raw_matches = self.get_all_soccer_odds()
        parsed = []

        for match in raw_matches:
            parsed_match = self.parse_match_odds(match)
            if parsed_match:
                parsed.append(parsed_match)

        log.info(f"Parsed {len(parsed)} matches with valid odds")
        return parsed
