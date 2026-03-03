"""CDS Sesame 天体名検索"""

import requests


def resolve(name):
    """天体名から RA/DEC を検索

    Args:
        name: 天体名 (例: "Sirius", "Vega", "M42")

    Returns:
        dict: {"ra": float, "dec": float} 度数、見つからない場合 None
    """
    url = f"http://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame/-oI/A?{name}"

    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
    except requests.RequestException:
        return None

    for line in response.text.splitlines():
        line = line.strip()
        if line.startswith("%J"):
            # "%J" の後に RA DEC が続く
            parts = line[2:].strip()
            # "=" があればその前までの部分を使用
            if "=" in parts:
                parts = parts[: parts.index("=")].strip()
            tokens = parts.split()
            if len(tokens) >= 2:
                try:
                    ra = float(tokens[0])
                    dec = float(tokens[1])
                    return {"ra": ra, "dec": dec}
                except ValueError:
                    continue

    return None
