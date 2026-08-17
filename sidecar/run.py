import argparse
import os
import uvicorn

from app.main import app

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Latent Tools FastAPI Sidecar")
    parser.add_argument("--port", type=int, default=int(os.environ.get("LATENT_SIDECAR_PORT", os.environ.get("PORT", "8756"))))
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    # Force 127.0.0.1 loopback binding to prevent Windows Firewall prompts
    bind_host = "127.0.0.1" if args.host in ("0.0.0.0", "localhost", "127.0.0.1") else "127.0.0.1"
    # Pass the app object directly, not the "module:attr" string form — PyInstaller's
    # static analysis can't see imports inside a string, so it silently drops the
    # `app` package from the frozen bundle and the packaged .exe crashes with
    # ModuleNotFoundError: No module named 'app'. A direct import is visible to it.
    uvicorn.run(app, host=bind_host, port=args.port)

