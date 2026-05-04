"""Simple FBref scraper for team-level xG statistics.

Uses requests + BeautifulSoup to parse the stats tables on FBref.
Caches results via existing cache helpers (6 hour TTL by default).
Respects polite rate-limiting (3s between requests).

Supported leagues (fbref competition ids):
- EPL: 9
- Bundesliga: 20
- Serie A: 11
- La Liga: 12
- Ligue 1: 13
- Eredivisie: 23

Exports:
- FbrefClient.build_league_xg_stats(league_id) -> dict(team_name -> stats)

"""

import time
import re
from typing import Optional, Dict, Any

import requests
from bs4 import BeautifulSoup

from src.utils.helpers import read_cache, write_cache, load_config
from src.utils.logger import get_logger

log = get_logger("fbref")


LEAGUE_IDS = {
    "EPL": 9,
    "BUNDESLIGA": 20,
    "SERIEA": 11,
    "LALIGA": 12,
    "LIGUE1": 13,
    "EREDIVISIE": 23,
}

BASE_URL = "https://fbref.com/en/comps/{id}/stats/"


class FbrefClient:
    """Minimal FBref scraper focused on xG team-level stats."""

    def __init__(self):
        cfg = load_config()
        self.cache_ttl_hours = cfg.get("cache", {}).get("stats_ttl_hours", 6)
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "soccer-parlay-system/1.0 (+https://github.com)"
        })

    def _fetch_html(self, url: str) -> Optional[str]:
        try:
            resp = self.session.get(url, timeout=15)
            resp.raise_for_status()
            return resp.text
        except requests.RequestException as e:
            log.error(f"FBref request failed: {e}")
            return None

    def _parse_stats_table(self, html: str) -> Dict[str, Dict[str, Any]]:
        """Parse tables and extract team xG stats.

        Returns mapping team_name -> {xg, xga, xg_per90, xga_per90, npxg, matches}
        """
        soup = BeautifulSoup(html, "lxml")

        # Search for table elements that include xG headers
        tables = soup.find_all("table")
        result = {}

        for table in tables:
            header = table.find("thead")
            if not header:
                continue

            headers = [th.get_text(strip=True) for th in header.find_all("th")]
            # Lowercase normalized headers
            headers_l = [h.lower() for h in headers]

            # Need at least 'team' and one of xg/npxg/xg per 90
            if not any("xg" in h for h in headers_l):
                continue

            # Build index map
            idx = {}
            for i, h in enumerate(headers_l):
                h_clean = re.sub(r"[^a-z0-9_. ]", "", h)
                idx[h_clean] = i

            # Find likely column names
            rows = table.find("tbody").find_all("tr") if table.find("tbody") else []
            for r in rows:
                # Skip separators
                if r.get("class") and "thead" in r.get("class"):
                    continue

                cols = [td.get_text(strip=True) for td in r.find_all(["td", "th"])]
                if not cols:
                    continue

                # Team name is often in the first column with an anchor
                team_cell = r.find("th") or r.find("td")
                team_name = team_cell.get_text(strip=True)

                # Initialize stats
                stats = {
                    "team": team_name,
                    "matches": None,
                    "xg": None,
                    "xga": None,
                    "xg_per90": None,
                    "xga_per90": None,
                    "npxg": None,
                }

                # Try to fill fields by checking header keywords
                for h, i in idx.items():
                    val = None
                    if i < len(cols):
                        val = cols[i]
                    if not val:
                        continue

                    v = val.replace("%", "").replace(",", "")
                    # Numeric parsing try
                    try:
                        fv = float(v)
                    except Exception:
                        fv = None

                    # Map known header patterns
                    if "matches" in h or "played" in h or "appearances" in h:
                        if fv is not None:
                            stats["matches"] = int(fv)
                    elif "npxg" in h:
                        stats["npxg"] = fv
                    elif re.search(r"xg.*90|xg/90|xg per 90|xg per match", h):
                        stats["xg_per90"] = fv
                    elif re.search(r"xg(?!.*90)", h) and "per" not in h:
                        # total xG
                        stats["xg"] = fv
                    elif re.search(r"xga.*90|xga/90|xga per 90|xga per match", h):
                        stats["xga_per90"] = fv
                    elif re.search(r"xga(?!.*90)", h) and "per" not in h:
                        stats["xga"] = fv

                # Fallback heuristics: try to find columns by exact header texts
                # Already attempted above; accept partials

                # Save
                result[team_name] = stats

            # If we've gathered some teams, break (prefer the first relevant table)
            if result:
                break

        return result

    def build_league_xg_stats(self, fbref_comp_id: int) -> Dict[str, Dict[str, Any]]:
        """Fetch and parse xG stats for a FBref competition id.

        Caches results for cache_ttl_hours from config.
        """
        cache_key = f"fbref_xg_{fbref_comp_id}"
        cached = read_cache("stats", cache_key, ttl_minutes=self.cache_ttl_hours * 60)
        if cached:
            return cached

        url = BASE_URL.format(id=fbref_comp_id)
        log.info(f"Fetching FBref stats: {url}")
        html = self._fetch_html(url)
        if not html:
            log.warning(f"No HTML from FBref for comp {fbref_comp_id}")
            return {}

        stats = self._parse_stats_table(html)

        # Respect rate limit
        time.sleep(3.0)

        if stats:
            write_cache("stats", cache_key, stats)
        return stats


if __name__ == "__main__":
    # Quick test (will use config cache TTL)
    client = FbrefClient()
    for name, cid in LEAGUE_IDS.items():
        s = client.build_league_xg_stats(cid)
        print(name, len(s))
