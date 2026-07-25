from fastapi import FastAPI

from app.routers import decks

app = FastAPI(
    title="Limitless TCG API",
    version="0.1.0",
)

app.include_router(decks.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
