import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import admin, meta

# The Vite dev server is a different origin to this one, so the browser
# preflights every request it makes. Set CLIENT_ORIGINS to whatever the
# deployed client is served from.
DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"

load_dotenv()

app = FastAPI(
    title="Limitless TCG API",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.environ.get("CLIENT_ORIGINS", DEFAULT_ORIGINS).split(",")
        if origin.strip()
    ],
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(meta.router)
app.include_router(admin.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
