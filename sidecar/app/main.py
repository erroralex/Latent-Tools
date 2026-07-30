from fastapi import FastAPI

app = FastAPI(title="Latent Tools Sidecar")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
