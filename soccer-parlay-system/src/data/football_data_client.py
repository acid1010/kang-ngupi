"""Client for Football-Data.org API — fetches match stats and standings.

API docs: https://www.football-data.org/documentation/api
Free tier: 10 requests/minute, major European leagues.
"""

import time
from typing import Optional

import requests

from src.utils.helpers import load_config, read_cache, write_cache
from src.utils.logger import get_logger

log = get_logger("football_data")


class FootballDataClient:
    """Fetch team statistics and match data from Football-Data.org."""

    BASE_URL = "https://api.football-data.org/v4"

    def __init__(self, api_key: str = None):
        cfg = load_config()
        self.api_key = api_key or cfg["apis"]["football_data_key"]
        self.cache_ttl_hours = cfg.get("cache", {}).get("stats_ttl_hours", 6)

        if self.api_key == "YOUR_FOOTBALL_DATA_KEY_HERE":
            log.warning("Football-Data API key not configured — using cached/demo data")

    def _get(self, endpoint: str, params: dict = None) -> Optional[dict]:
        """Make authenticated GET request."""
        url = f"{self.BASE_URL}/{endpoint}"
        headers = {"X-Auth-Token": self.api_key}

        try:
            resp = requests.get(url, headers=headers, params=params, timeout=15)
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.HTTPError as e:
            if resp.status_code == 429:
                log.warning("Football-Data: Rate limited, waiting 60s...")
                time.sleep(60)
                return self._get(endpoint, params)  # Retry once
            log.error(f"Football-Data HTTP error: {e}")
            return None
        except requests.exceptions.RequestException as e:
            log.error(f"Football-Data request failed: {e}")
            return None

    def get_standings(self, competition: str, season: int = None) -> Optional[dict]:
        """Get league standings (table).

        Args:
            competition: Competition code (PL, BL1, SA, PD, FL1, DED)
            season: Year (e.g. 2024 for 2024/25 season). None = current.
        """
        cache_key = f"standings_{competition}_{season or 'current'}"
        cached = read_cache("stats", cache_key, ttl_minutes=self.cache_ttl_hours * 60)
        if cached:
            return cached

        params = {}
        if season:
            params["season"] = season

        data = self._get(f"competitions/{competition}/standings", params)
        if data:
            write_cache("stats", cache_key, data)
        return data

    def get_matches(self, competition: str, matchday: int = None,
                    status: str = None, season: int = None) -> Optional[dict]:
        """Get matches for a competition.

        Args:
            competition: Competition code
            matchday: Specific matchday number
            status: SCHEDULED, LIVE, IN_PLAY, PAUSED, FINISHED, etc.
            season: Year
        """
        cache_key = f"matches_{competition}_{matchday}_{status}_{season}"
        cached = read_cache("stats", cache_key, ttl_minutes=self.cache_ttl_hours * 60)
        if cached:
            return cached

        params = {}
        if matchday:
            params["matchday"] = matchday
        if status:
            params["status"] = status
        if season:
            params["season"] = season

        data = self._get(f"competitions/{competition}/matches", params)
        if data:
            write_cache("stats", cache_key, data)
        return data

    def get_team(self, team_id: int) -> Optional[dict]:
        """Get team details."""
        cache_key = f"team_{team_id}"
        cached = read_cache("stats", cache_key, ttl_minutes=self.cache_ttl_hours * 60)
        if cached:
            return cached

        data = self._get(f"teams/{team_id}")
        if data:
            write_cache("stats", cache_key, data)
        return data

    def get_team_matches(self, team_id: int, limit: int = 15,
                         status: str = "FINISHED") -> Optional[dict]:
        """Get recent matches for a specific team."""
        cache_key = f"team_matches_{team_id}_{limit}_{status}"
        cached = read_cache("stats", cache_key, ttl_minutes=self.cache_ttl_hours * 60)
        if cached:
            return cached

        params = {"limit": limit}
        if status:
            params["status"] = status

        data = self._get(f"teams/{team_id}/matches", params)
        if data:
            write_cache("stats", cache_key, data)
        return data

    def get_scorers(self, competition: str, season: int = None,
                    limit: int = 20) -> Optional[dict]:
        """Get top scorers for a competition."""
        params = {"limit": limit}
        if season:
            params["season"] = season
        return self._get(f"competitions/{competition}/scorers", params)

    def build_team_stats(self, competition: str, season: int = None) -> dict:
        """Build comprehensive team statistics from standings and results.

        Returns dict mapping team_name -> {
            played, won, drawn, lost,
            goals_for, goals_against, goal_diff,
            home_goals_for, home_goals_against,
            away_goals_for, away_goals_against,
            attack_strength, defense_strength,
            home_attack, home_defense,
            away_attack, away_defense,
            points, position, form
        }
        """
        standings_data = self.get_standings(competition, season)
        if not standings_data:
            log.warning(f"No standings data for {competition}")
            return {}

        standings = standings_data.get("standings", [])
        if not standings:
            return {}

        # Use the total table (index 0), home (1), away (2)
        total_table = standings[0].get("table", []) if len(standings) > 0 else []
        home_table = standings[1].get("table", []) if len(standings) > 1 else []
        away_table = standings[2].get("table", []) if len(standings) > 2 else []

        # Build home/away lookup
        home_lookup = {}
        for entry in home_table:
            name = entry.get("team", {}).get("name", "")
            home_lookup[name] = entry

        away_lookup = {}
        for entry in away_table:
            name = entry.get("team", {}).get("name", "")
            away_lookup[name] = entry

        # Calculate league averages
        total_home_goals = 0
        total_away_goals = 0
        total_matches = 0

        for entry in total_table:
            played = entry.get("playedGames", 0)
            total_matches += played

        for entry in home_table:
            total_home_goals += entry.get("goalsFor", 0)
        for entry in away_table:
            total_away_goals += entry.get("goalsFor", 0)

        # Fallback: if HOME/AWAY standings not available (free tier),
        # estimate from TOTAL using typical home/away split (~55/45)
        if total_home_goals == 0 and total_away_goals == 0 and total_table:
            total_goals = sum(e.get("goalsFor", 0) for e in total_table)
            total_home_goals = int(total_goals * 0.55)
            total_away_goals = total_goals - total_home_goals
            log.info(f"{competition}: HOME/AWAY standings unavailable, estimated from TOTAL ({total_goals} goals)")

        # Total matches is sum of all team matches / 2 (each match counted twice)
        num_teams = len(total_table)
        if num_teams == 0:
            return {}

        total_league_matches = sum(e.get("playedGames", 0) for e in total_table) / 2
        if total_league_matches == 0:
            total_league_matches = 1  # Avoid division by zero

        avg_home_goals = total_home_goals / total_league_matches if total_league_matches else 1.3
        avg_away_goals = total_away_goals / total_league_matches if total_league_matches else 1.1

        log.info(f"{competition}: avg home goals={avg_home_goals:.2f}, "
                 f"avg away goals={avg_away_goals:.2f}, "
                 f"matches={int(total_league_matches)}")

        # Build per-team stats
        team_stats = {}
        for entry in total_table:
            team_name = entry.get("team", {}).get("name", "")
            team_id = entry.get("team", {}).get("id", 0)
            played = entry.get("playedGames", 0)

            if played == 0:
                continue

            gf = entry.get("goalsFor", 0)
            ga = entry.get("goalsAgainst", 0)

            # Home stats (fallback to estimated split from total if unavailable)
            h = home_lookup.get(team_name, {})
            h_played = h.get("playedGames", 0) or max(played // 2, 1)
            h_gf = h.get("goalsFor", 0) or int(gf * 0.55)
            h_ga = h.get("goalsAgainst", 0) or int(ga * 0.45)

            # Away stats
            a = away_lookup.get(team_name, {})
            a_played = a.get("playedGames", 0) or max(played // 2, 1)
            a_gf = a.get("goalsFor", 0) or int(gf * 0.45)
            a_ga = a.get("goalsAgainst", 0) or int(ga * 0.55)

            # Attack/defense strength relative to league average
            # Attack strength = team's goals per game / league avg goals per game
            avg_total = (avg_home_goals + avg_away_goals) / 2 if (avg_home_goals + avg_away_goals) > 0 else 1.3
            attack_strength = (gf / played) / avg_total if played > 0 else 1.0
            defense_strength = (ga / played) / avg_total if played > 0 else 1.0

            # Home-specific strengths
            home_attack = (h_gf / h_played) / avg_home_goals if h_played > 0 and avg_home_goals > 0 else 1.0
            home_defense = (h_ga / h_played) / avg_away_goals if h_played > 0 and avg_away_goals > 0 else 1.0
            away_attack = (a_gf / a_played) / avg_away_goals if a_played > 0 and avg_away_goals > 0 else 1.0
            away_defense = (a_ga / a_played) / avg_home_goals if a_played > 0 and avg_home_goals > 0 else 1.0

            # Form: last 5 results
            form = entry.get("form", "")

            team_stats[team_name] = {
                "team_id": team_id,
                "played": played,
                "won": entry.get("won", 0),
                "drawn": entry.get("draw", 0),
                "lost": entry.get("lost", 0),
                "goals_for": gf,
                "goals_against": ga,
                "goal_diff": entry.get("goalDifference", 0),
                "points": entry.get("points", 0),
                "position": entry.get("position", 0),
                "home_played": h_played,
                "home_goals_for": h_gf,
                "home_goals_against": h_ga,
                "away_played": a_played,
                "away_goals_for": a_gf,
                "away_goals_against": a_ga,
                "attack_strength": round(attack_strength, 3),
                "defense_strength": round(defense_strength, 3),
                "home_attack": round(home_attack, 3),
                "home_defense": round(home_defense, 3),
                "away_attack": round(away_attack, 3),
                "away_defense": round(away_defense, 3),
                "form": form,
                "avg_home_goals_league": round(avg_home_goals, 3),
                "avg_away_goals_league": round(avg_away_goals, 3),
            }

        log.info(f"Built stats for {len(team_stats)} teams in {competition}")
        return team_stats

    def build_all_team_stats(self) -> dict:
        """Build team stats for all configured leagues.

        Returns dict mapping league_code -> {team_name -> stats}
        """
        cfg = load_config()
        leagues = cfg.get("leagues", [])
        all_stats = {}

        for league in leagues:
            code = league["code"]
            log.info(f"Building stats for {league['name']} ({code})")
            stats = self.build_team_stats(code)
            all_stats[code] = stats
            time.sleep(6.5)  # Respect 10 req/min rate limit

        return all_stats
