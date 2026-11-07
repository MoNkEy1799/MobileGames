import http.server
import json
import os
import shutil
import socketserver
import subprocess
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GAMES_DIR = os.path.join(ROOT, "games")

def load_games():
    with open(os.path.join(HERE, "games.json")) as f:
        config = json.load(f)
    games = {}
    for name, port in config.items():
        if os.path.isdir(os.path.join(GAMES_DIR, name)):
            games[name] = port
        else:
            print(f"Skipping '{name}': folder games/{name} not found.")
    return games

def find_adb():
    local = os.path.join(HERE, "sdk_platform_tools/adb.exe")
    if os.path.isfile(local):
        return local
    return shutil.which("adb")

def setup_adb(ports):
    adb = find_adb()
    if not adb:
        print("adb not found. Put adb.exe in the install folder or add it to PATH.")
        return
    for port in ports:
        result = subprocess.run(
            [adb, "reverse", f"tcp:{port}", f"tcp:{port}"],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            print(f"adb reverse failed for port {port}:", (result.stderr or result.stdout).strip())
            print("Check: phone connected, USB debugging on, debugging prompt accepted.")
            return
    print("Phone connected.")

def make_handler(name, directory):
    class Handler(http.server.SimpleHTTPRequestHandler):
        extensions_map = {
            **http.server.SimpleHTTPRequestHandler.extensions_map,
            ".js": "text/javascript",
            ".json": "application/json",
            ".svg": "image/svg+xml",
        }

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=directory, **kwargs)

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def log_message(self, fmt, *args):
            print(f"[{name}] {fmt % args}")

    return Handler


if __name__ == "__main__":
    games = load_games()
    if not games:
        print("No games found.")
        raise SystemExit(1)

    setup_adb(games.values())
    socketserver.ThreadingTCPServer.allow_reuse_address = True

    servers = []
    for name, port in games.items():
        try:
            server = socketserver.ThreadingTCPServer(
                ("", port), make_handler(name, os.path.join(GAMES_DIR, name))
            )
        except OSError:
            print(f"Port {port} for '{name}' is already in use, skipping.")
            continue
        threading.Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)
        print(f"{name}: open localhost:{port} on the phone")

    print("Running (Ctrl+C to stop)")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        for s in servers:
            s.shutdown()