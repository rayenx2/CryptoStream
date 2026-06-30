import os
import sys
import time
import logging
import urllib.request
import json
from datetime import datetime, timezone

sys.path.insert(0, "/app")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cryptostream-api")

app = FastAPI(title="CryptoStream", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_startup = time.time()
_price_cache: dict = {}   # { ts: ..., data: [...] }

COINGECKO_URL = (
    "https://api.coingecko.com/api/v3/coins/markets"
    "?vs_currency=usd&order=market_cap_desc&per_page=11&page=1"
    "&sparkline=false&price_change_percentage=24h"
)


def _db_config():
    return {
        "host":     os.getenv("POSTGRES_HOST", "postgres"),
        "port":     int(os.getenv("POSTGRES_PORT", "5432")),
        "database": os.getenv("POSTGRES_DB", "airflow"),
        "user":     os.getenv("POSTGRES_USER", "airflow"),
        "password": os.getenv("POSTGRES_PASSWORD", "airflow"),
    }


def _check_postgres() -> bool:
    try:
        import psycopg2
        conn = psycopg2.connect(**_db_config(), connect_timeout=2)
        conn.close()
        return True
    except Exception:
        return False


def _get_pg_prices():
    """Latest price per symbol from the airflow-written cryptos table."""
    try:
        import psycopg2
        conn = psycopg2.connect(**_db_config(), connect_timeout=3)
        cur = conn.cursor()
        cur.execute("""
            SELECT DISTINCT ON (symbol)
                symbol, name, rank, price, price_change_24h,
                volume, market_cap, updated_at
            FROM cryptos
            ORDER BY symbol, updated_at DESC
        """)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        if not rows:
            return None
        cols = ["symbol", "name", "rank", "price", "price_change_24h",
                "volume", "market_cap", "updated_at"]
        result = []
        for r in rows:
            d = dict(zip(cols, r))
            d["updated_at"] = str(d["updated_at"])
            result.append(d)
        return result
    except Exception as e:
        logger.warning(f"PG read failed: {e}")
        return None


def _fetch_coingecko() -> list:
    """Fetch top 11 coins from CoinGecko (no API key required)."""
    req = urllib.request.Request(
        COINGECKO_URL,
        headers={"Accept": "application/json",
                 "User-Agent": "CryptoStream/1.0"},
    )
    with urllib.request.urlopen(req, timeout=8) as resp:
        data = json.loads(resp.read())

    result = []
    for i, c in enumerate(data, start=1):
        result.append({
            "symbol": c["symbol"].upper(),
            "name":   c["name"],
            "rank":   i,
            "price":  c["current_price"],
            "price_change_24h": c.get("price_change_percentage_24h") or 0.0,
            "volume": c.get("total_volume") or 0,
            "market_cap": c.get("market_cap") or 0,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    return result


def _write_to_pg(prices: list) -> int:
    """Upsert live prices into the cryptos staging table."""
    import psycopg2
    conn = psycopg2.connect(**_db_config(), connect_timeout=5)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS cryptos (
            id TEXT PRIMARY KEY,
            symbol VARCHAR(10),
            name VARCHAR(100),
            rank INTEGER,
            price NUMERIC,
            price_change_24h NUMERIC,
            volume NUMERIC,
            volume_24h NUMERIC,
            volume_change_24h NUMERIC,
            market_cap NUMERIC,
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """)
    import uuid
    count = 0
    for p in prices:
        cur.execute("""
            INSERT INTO cryptos (id, symbol, name, rank, price, price_change_24h,
                volume, volume_24h, volume_change_24h, market_cap, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        """, (
            str(uuid.uuid4()), p["symbol"], p["name"], p["rank"],
            p["price"], p["price_change_24h"],
            p["volume"], p["volume"], 0, p["market_cap"],
        ))
        count += 1
    conn.commit()
    cur.close()
    conn.close()
    return count


@app.get("/api/v1/health")
def health():
    return {
        "status":   "healthy",
        "app":      "CryptoStream",
        "version":  "1.0.0",
        "uptime_s": round(time.time() - _startup),
        "postgres": _check_postgres(),
    }


@app.get("/api/v1/prices")
def prices():
    # 1. Try PostgreSQL (populated by Airflow DAG or /ingest)
    pg = _get_pg_prices()
    if pg:
        return {"prices": pg, "count": len(pg), "source": "postgres",
                "ts": datetime.now(timezone.utc).isoformat()}

    # 2. Try CoinGecko live (cache 60s to avoid rate limits), auto-write to postgres
    cached = _price_cache
    if cached and time.time() - cached.get("ts", 0) < 60:
        return {"prices": cached["data"], "count": len(cached["data"]),
                "source": "coingecko_cached", "ts": cached.get("iso")}
    try:
        live = _fetch_coingecko()
        _price_cache["ts"]   = time.time()
        _price_cache["iso"]  = datetime.now(timezone.utc).isoformat()
        _price_cache["data"] = live
        # Auto-write to postgres so it's always fresh
        try:
            _write_to_pg(live)
        except Exception:
            pass
        return {"prices": live, "count": len(live), "source": "coingecko",
                "ts": _price_cache["iso"]}
    except Exception as e:
        logger.warning(f"CoinGecko failed: {e}")

    # 3. Fallback: stale cache if any
    if cached:
        return {"prices": cached["data"], "count": len(cached["data"]),
                "source": "stale_cache", "ts": cached.get("iso")}

    raise HTTPException(status_code=503, detail="No data source available")


@app.post("/api/v1/ingest")
def manual_ingest():
    """Fetch live prices from CoinGecko and write to PostgreSQL."""
    try:
        live = _fetch_coingecko()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"CoinGecko fetch failed: {e}")

    if not _check_postgres():
        raise HTTPException(status_code=503, detail="PostgreSQL not reachable")

    count = _write_to_pg(live)
    _price_cache["ts"]   = time.time()
    _price_cache["iso"]  = datetime.now(timezone.utc).isoformat()
    _price_cache["data"] = live

    return {
        "ok": True,
        "rows_inserted": count,
        "coins": [p["symbol"] for p in live],
        "ts": _price_cache["iso"],
    }


@app.get("/api/v1/anomalies")
def anomalies():
    # Try to derive anomalies from real prices if available
    pg = _get_pg_prices()
    cached = _price_cache.get("data") or []
    prices_data = pg or cached

    found = []
    if prices_data:
        for c in prices_data:
            chg = float(c.get("price_change_24h") or 0)
            if abs(chg) >= 5:
                found.append({
                    "type": "price_spike" if chg > 0 else "flash_crash",
                    "symbol": c["symbol"],
                    "severity": min(1.0, abs(chg) / 20),
                    "description": f"{c['symbol']} moved {chg:+.2f}% in 24h",
                    "price": c["price"],
                    "z_score": abs(chg) / 3.5,
                    "timestamp_ms": int(time.time() * 1000),
                })

    source = "live_derived" if found else "demo"
    if not found:
        found = [
            {"type": "price_spike",  "symbol": "DOGE", "severity": 0.72,
             "description": "Price z-score 4.1 — rapid pump detected",
             "price": 0.1234, "z_score": 4.1, "timestamp_ms": int(time.time()*1000) - 120000},
            {"type": "volume_spike", "symbol": "SOL",  "severity": 0.58,
             "description": "Volume z-score 4.8 — possible wash trading",
             "price": 178.30, "z_score": 4.8, "timestamp_ms": int(time.time()*1000) - 300000},
            {"type": "flash_crash",  "symbol": "ADA",  "severity": 0.41,
             "description": "Price dropped 5.2% in one tick",
             "price": 0.452, "z_score": 0.0, "timestamp_ms": int(time.time()*1000) - 600000},
        ]

    return {"anomalies": found, "count": len(found), "source": source,
            "ts": datetime.now(timezone.utc).isoformat()}


@app.get("/api/v1/pipeline")
def pipeline():
    return {
        "services": [
            {"name": "CryptoStream UI",      "url": "http://localhost:8123", "port": 8123, "role": "React dashboard"},
            {"name": "CryptoStream API",     "url": "http://localhost:8122", "port": 8122, "role": "REST API"},
            {"name": "Airflow",              "url": "http://localhost:8085", "port": 8085, "role": "DAG orchestration"},
            {"name": "Kafka Control Center", "url": "http://localhost:9021", "port": 9021, "role": "Kafka monitoring"},
            {"name": "Schema Registry",      "url": "http://localhost:8081", "port": 8081, "role": "Schema enforcement"},
            {"name": "Spark UI",             "url": "http://localhost:9091", "port": 9091, "role": "Stream processing"},
            {"name": "Grafana",              "url": "http://localhost:3001", "port": 3001, "role": "Dashboards"},
            {"name": "Cassandra",            "url": None,                    "port": 9042, "role": "Timeseries storage"},
            {"name": "PostgreSQL",           "url": "http://localhost:5434", "port": 5434, "role": "Staging + Airflow metadata"},
        ]
    }
