#!/usr/bin/env python3
"""Download historical match data from football-data.co.uk.

Downloads CSV files for the last 3 seasons across 6 major European leagues.
Saves to data/historical/

Usage:
    python download_historical.py
"""

import os
import sys
import time
import urllib.request
import urllib.error

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "historical")

# League code -> football-data.co.uk CSV filename
LEAGUES = {
    "EPL": "E0",
    "Bundesliga": "D1",
    "SerieA": "I1",
    "LaLiga": "SP1",
    "Ligue1": "F1",
    "Eredivisie": "N1",
}

SEASONS = ["2324", "2425", "2526"]
SEASON_LABELS = {"2324": "2023/24", "2425": "2024/25", "2526": "2025/26"}

BASE_URL = "https://www.football-data.co.uk/mmz4281/{season}/{code}.csv"


def download_file(url: str, dest: str) -> bool:
    """Download a file from URL to destination path."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as response:
            data = response.read()
            if len(data) < 100:
                print(f"  ⚠️  Skipped (too small, likely not available yet): {url}")
                return False
            with open(dest, "wb") as f:
                f.write(data)
            print(f"  ✅ Downloaded: {os.path.basename(dest)} ({len(data):,} bytes)")
            return True
    except urllib.error.HTTPError as e:
        print(f"  ⚠️  HTTP {e.code} for {url} — season may not be available yet")
        return False
    except Exception as e:
        print(f"  ❌ Error downloading {url}: {e}")
        return False


def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    total = 0
    downloaded = 0

    for league_name, csv_code in LEAGUES.items():
        print(f"\n{'='*50}")
        print(f"  {league_name} ({csv_code}.csv)")
        print(f"{'='*50}")

        for season in SEASONS:
            total += 1
            url = BASE_URL.format(season=season, code=csv_code)
            filename = f"{league_name}_{season}.csv"
            dest = os.path.join(DATA_DIR, filename)

            print(f"\n  Season {SEASON_LABELS[season]}:")
            print(f"  URL: {url}")

            if os.path.exists(dest) and os.path.getsize(dest) > 100:
                print(f"  ℹ️  Already exists: {filename}")
                downloaded += 1
                continue

            if download_file(url, dest):
                downloaded += 1

            # Be polite to the server
            time.sleep(1)

    print(f"\n{'='*50}")
    print(f"  Download complete: {downloaded}/{total} files")
    print(f"  Data directory: {DATA_DIR}")
    print(f"{'='*50}\n")

    # List downloaded files
    files = sorted(os.listdir(DATA_DIR))
    csv_files = [f for f in files if f.endswith(".csv")]
    print(f"  CSV files available: {len(csv_files)}")
    for f in csv_files:
        size = os.path.getsize(os.path.join(DATA_DIR, f))
        print(f"    {f} ({size:,} bytes)")


if __name__ == "__main__":
    main()
