"""Unified data pipeline — merges odds and stats into analysis-ready dataset."""

import re
from datetime import datetime
from typing import Optional

from src.data.odds_client import OddsClient
from src.data.football_data_client import FootballDataClient
from src.data.fbref_client import FbrefClient, LEAGUE_IDS as FBREF_LEAGUE_IDS
from src.utils.helpers import load_config
from src.utils.logger import get_logger

log = get_logger("data_pipeline")


# Common team name mappings (odds API names → football-data.org names)
TEAM_NAME_MAP = {
    # Premier League
    "Manchester United": "Manchester United FC",
    "Manchester City": "Manchester City FC",
    "Arsenal": "Arsenal FC",
    "Chelsea": "Chelsea FC",
    "Liverpool": "Liverpool FC",
    "Tottenham Hotspur": "Tottenham Hotspur FC",
    "Newcastle United": "Newcastle United FC",
    "Aston Villa": "Aston Villa FC",
    "West Ham United": "West Ham United FC",
    "Brighton and Hove Albion": "Brighton & Hove Albion FC",
    "Brighton": "Brighton & Hove Albion FC",
    "Wolverhampton Wanderers": "Wolverhampton Wanderers FC",
    "Wolves": "Wolverhampton Wanderers FC",
    "Crystal Palace": "Crystal Palace FC",
    "Fulham": "Fulham FC",
    "Everton": "Everton FC",
    "Brentford": "Brentford FC",
    "Nottingham Forest": "Nottingham Forest FC",
    "Bournemouth": "AFC Bournemouth",
    "AFC Bournemouth": "AFC Bournemouth",
    "Burnley": "Burnley FC",
    "Sheffield United": "Sheffield United FC",
    "Luton Town": "Luton Town FC",
    "Ipswich Town": "Ipswich Town FC",
    "Leicester City": "Leicester City FC",
    "Southampton": "Southampton FC",

    # Bundesliga
    "Bayern Munich": "FC Bayern München",
    "Borussia Dortmund": "Borussia Dortmund",
    "RB Leipzig": "RB Leipzig",
    "Bayer Leverkusen": "Bayer 04 Leverkusen",
    "Bayer 04 Leverkusen": "Bayer 04 Leverkusen",
    "Eintracht Frankfurt": "Eintracht Frankfurt",
    "VfB Stuttgart": "VfB Stuttgart",
    "SC Freiburg": "Sport-Club Freiburg",
    "Freiburg": "Sport-Club Freiburg",
    "Union Berlin": "1. FC Union Berlin",
    "1. FC Union Berlin": "1. FC Union Berlin",
    "Wolfsburg": "VfL Wolfsburg",
    "VfL Wolfsburg": "VfL Wolfsburg",
    "Borussia Monchengladbach": "Borussia Mönchengladbach",
    "Borussia Mönchengladbach": "Borussia Mönchengladbach",
    "Werder Bremen": "SV Werder Bremen",
    "Hoffenheim": "TSG 1899 Hoffenheim",
    "TSG Hoffenheim": "TSG 1899 Hoffenheim",
    "FC Augsburg": "FC Augsburg",
    "Mainz 05": "1. FSV Mainz 05",
    "1. FSV Mainz 05": "1. FSV Mainz 05",
    "FC Koln": "1. FC Köln",
    "1. FC Köln": "1. FC Köln",
    "Heidenheim": "1. FC Heidenheim 1846",
    "Darmstadt 98": "SV Darmstadt 98",

    # Serie A
    "AC Milan": "AC Milan",
    "Inter Milan": "FC Internazionale Milano",
    "Internazionale": "FC Internazionale Milano",
    "Juventus": "Juventus FC",
    "Napoli": "SSC Napoli",
    "AS Roma": "AS Roma",
    "Roma": "AS Roma",
    "Lazio": "SS Lazio",
    "SS Lazio": "SS Lazio",
    "Atalanta": "Atalanta BC",
    "Fiorentina": "ACF Fiorentina",
    "ACF Fiorentina": "ACF Fiorentina",
    "Bologna": "Bologna FC 1909",
    "Torino": "Torino FC",
    "Monza": "AC Monza",
    "Udinese": "Udinese Calcio",
    "Sassuolo": "US Sassuolo Calcio",
    "Empoli": "Empoli FC",
    "Cagliari": "Cagliari Calcio",
    "Genoa": "Genoa CFC",
    "Lecce": "US Lecce",
    "Verona": "Hellas Verona FC",
    "Hellas Verona": "Hellas Verona FC",
    "Frosinone": "Frosinone Calcio",
    "Salernitana": "US Salernitana 1919",

    # La Liga
    "Real Madrid": "Real Madrid CF",
    "Barcelona": "FC Barcelona",
    "FC Barcelona": "FC Barcelona",
    "Atletico Madrid": "Club Atlético de Madrid",
    "Atlético Madrid": "Club Atlético de Madrid",
    "Real Sociedad": "Real Sociedad de Fútbol",
    "Real Betis": "Real Betis Balompié",
    "Villarreal": "Villarreal CF",
    "Athletic Bilbao": "Athletic Club",
    "Athletic Club": "Athletic Club",
    "Sevilla": "Sevilla FC",
    "Sevilla FC": "Sevilla FC",
    "Valencia": "Valencia CF",
    "Osasuna": "CA Osasuna",
    "Celta Vigo": "RC Celta de Vigo",
    "Getafe": "Getafe CF",
    "Mallorca": "RCD Mallorca",
    "Rayo Vallecano": "Rayo Vallecano de Madrid",
    "Las Palmas": "UD Las Palmas",
    "Alaves": "Deportivo Alavés",
    "Deportivo Alavés": "Deportivo Alavés",
    "Cadiz": "Cádiz CF",
    "Granada": "Granada CF",
    "Almeria": "UD Almería",
    "Girona": "Girona FC",

    # Ligue 1
    "Paris Saint Germain": "Paris Saint-Germain FC",
    "Paris Saint-Germain": "Paris Saint-Germain FC",
    "PSG": "Paris Saint-Germain FC",
    "Marseille": "Olympique de Marseille",
    "Olympique Marseille": "Olympique de Marseille",
    "Lyon": "Olympique Lyonnais",
    "Olympique Lyon": "Olympique Lyonnais",
    "Monaco": "AS Monaco FC",
    "AS Monaco": "AS Monaco FC",
    "Lille": "Lille OSC",
    "Lille OSC": "Lille OSC",
    "Nice": "OGC Nice",
    "OGC Nice": "OGC Nice",
    "Rennes": "Stade Rennais FC 1901",
    "Stade Rennais": "Stade Rennais FC 1901",
    "Lens": "RC Lens",
    "RC Lens": "RC Lens",
    "Strasbourg": "RC Strasbourg Alsace",
    "Nantes": "FC Nantes",
    "Toulouse": "Toulouse FC",
    "Montpellier": "Montpellier HSC",
    "Brest": "Stade Brestois 29",
    "Reims": "Stade de Reims",
    "Le Havre": "Le Havre AC",
    "Metz": "FC Metz",
    "Clermont Foot": "Clermont Foot 63",
    "Lorient": "FC Lorient",
}


def normalize_team_name(name: str) -> str:
    """Normalize a team name for matching across data sources."""
    # Try direct mapping first
    if name in TEAM_NAME_MAP:
        return TEAM_NAME_MAP[name]
    return name


def fuzzy_match_team(name: str, candidates: list[str], threshold: float = 0.6) -> Optional[str]:
    """Simple fuzzy matching for team names not in the mapping."""
    name_lower = name.lower().strip()

    # Exact match
    for c in candidates:
        if c.lower().strip() == name_lower:
            return c

    # Substring match
    for c in candidates:
        c_lower = c.lower().strip()
        if name_lower in c_lower or c_lower in name_lower:
            return c

    # Word overlap
    name_words = set(re.sub(r'[^a-z\s]', '', name_lower).split())
    best_match = None
    best_score = 0

    for c in candidates:
        c_words = set(re.sub(r'[^a-z\s]', '', c.lower()).split())
        # Remove common words
        common_skip = {"fc", "cf", "sc", "ac", "afc", "de", "the", "1."}
        n_words = name_words - common_skip
        c_words_clean = c_words - common_skip

        if not n_words or not c_words_clean:
            continue

        overlap = len(n_words & c_words_clean)
        score = overlap / max(len(n_words), len(c_words_clean))

        if score > best_score and score >= threshold:
            best_score = score
            best_match = c

    return best_match


class DataPipeline:
    """Unified pipeline that merges odds and stats data."""

    def __init__(self, odds_key: str = None, stats_key: str = None):
        self.odds_client = OddsClient(api_key=odds_key)
        self.stats_client = FootballDataClient(api_key=stats_key)
        self.fbref_client = FbrefClient()

    def fetch_and_merge(self) -> list[dict]:
        """Fetch odds and stats, merge into analysis-ready match records.

        Returns list of dicts, each containing:
        - Match info (teams, league, time)
        - Best odds and implied probabilities
        - Team attack/defense strengths
        - Over/under data
        """
        # Step 1: Fetch odds
        log.info("Step 1: Fetching odds data...")
        matches_with_odds = self.odds_client.get_parsed_odds()

        if not matches_with_odds:
            log.warning("No odds data available")
            return []

        # Step 2: Fetch team stats for all leagues
        log.info("Step 2: Fetching team statistics...")
        all_stats = self.stats_client.build_all_team_stats()

        # Step 2b: fetch FBref xG stats and merge onto team stats where possible
        fbref_code_map = {
            'PL': 'EPL', 'BL1': 'BUNDESLIGA', 'SA': 'SERIEA',
            'PD': 'LALIGA', 'FL1': 'LIGUE1', 'DED': 'EREDIVISIE'
        }
        for league_code, teams in all_stats.items():
            fbref_key = fbref_code_map.get(league_code)
            if not fbref_key:
                continue
            comp_id = FBREF_LEAGUE_IDS.get(fbref_key)
            if not comp_id:
                continue
            xg_stats = self.fbref_client.build_league_xg_stats(comp_id)
            if not xg_stats:
                continue
            for team_name, stats in teams.items():
                candidate = xg_stats.get(team_name)
                if not candidate:
                    matched = fuzzy_match_team(team_name, list(xg_stats.keys()))
                    candidate = xg_stats.get(matched) if matched else None
                if candidate:
                    stats.update({k: v for k, v in candidate.items() if k != 'team' and v is not None})

        # Step 3: Merge
        log.info("Step 3: Merging odds with team stats...")
        merged = []

        for match in matches_with_odds:
            league_code = match.get("league_code", "")
            league_stats = all_stats.get(league_code, {})

            if not league_stats:
                log.debug(f"No stats for league {league_code}, skipping {match['home_team']} vs {match['away_team']}")
                continue

            # Match team names
            home_name = normalize_team_name(match["home_team"])
            away_name = normalize_team_name(match["away_team"])

            candidates = list(league_stats.keys())

            home_stats = league_stats.get(home_name)
            if not home_stats:
                matched = fuzzy_match_team(home_name, candidates)
                if matched:
                    home_stats = league_stats[matched]
                    home_name = matched

            away_stats = league_stats.get(away_name)
            if not away_stats:
                matched = fuzzy_match_team(away_name, candidates)
                if matched:
                    away_stats = league_stats[matched]
                    away_name = matched

            cfg = load_config()
            min_matches = cfg.get("model", {}).get("min_matches", 5)

            if not home_stats or not away_stats:
                log.debug(f"Could not match teams: {match['home_team']} / {match['away_team']}")
                continue

            if home_stats["played"] < min_matches or away_stats["played"] < min_matches:
                log.debug(f"Insufficient matches for {home_name} or {away_name}")
                continue

            # Build merged record
            record = {
                **match,
                "home_team_normalized": home_name,
                "away_team_normalized": away_name,
                "home_stats": home_stats,
                "away_stats": away_stats,
            }

            merged.append(record)

        log.info(f"Merged {len(merged)} matches with complete data "
                 f"(from {len(matches_with_odds)} with odds)")
        return merged
