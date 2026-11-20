"""Exporte la géométrie du jeu (js/table.js) vers cao/geometrie.json, via Chrome sans écran.

    python3 cao/exporter_geometrie.py

À relancer chaque fois que la table du jeu change, puis : freecadcmd cao/construire.py ; python3 cao/plans.py
"""
import html
import http.server
import json
import re
import subprocess
import threading
from functools import partial
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
PORT = 0   # port libre choisi par le système


def main():
    h = partial(http.server.SimpleHTTPRequestHandler, directory=str(RACINE))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), h)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        dom = subprocess.run(["google-chrome", "--headless", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=5000",
                              "--dump-dom", f"http://127.0.0.1:{port}/cao/export_geo.html"],
                             capture_output=True, text=True, timeout=90).stdout
    finally:
        srv.shutdown()
    m = re.search(r'<pre id="geo">(.*?)</pre>', dom, re.S)
    if not m or not m.group(1).strip().startswith("{"):
        raise SystemExit("export impossible : la page n'a pas produit de JSON")
    geo = json.loads(html.unescape(m.group(1)))
    (RACINE / "cao" / "geometrie.json").write_text(json.dumps(geo, ensure_ascii=False), encoding="utf-8")
    print("ok :", len(geo["walls"]), "parois,", len(geo["lamps"]), "lampes,", len(geo["ramp"]), "points de rampe")


if __name__ == "__main__":
    main()
