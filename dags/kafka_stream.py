import uuid
import datetime
import requests
import json
import logging
import time
import psycopg2
from airflow import DAG
from airflow.operators.python import PythonOperator

logging.basicConfig(level=logging.INFO)

COINGECKO_URL = (
    "https://api.coingecko.com/api/v3/coins/markets"
    "?vs_currency=usd&order=market_cap_desc&per_page=11&page=1"
    "&sparkline=false&price_change_percentage=24h"
)


def get_data():
    headers = {"Accept": "application/json", "User-Agent": "CryptoStream-Airflow/1.0"}
    res = requests.get(COINGECKO_URL, headers=headers, timeout=10)
    res.raise_for_status()
    return res.json()


def format_data(coins):
    data_list = []
    for i, coin in enumerate(coins, start=1):
        data_list.append({
            "id": str(uuid.uuid4()),
            "symbol": coin["symbol"].upper(),
            "name": coin["name"],
            "rank": i,
            "price": coin["current_price"],
            "price_change_24h": coin.get("price_change_percentage_24h") or 0.0,
            "volume": coin.get("total_volume") or 0,
            "volume_24h": coin.get("total_volume") or 0,
            "volume_change_24h": 0,
            "market_cap": coin.get("market_cap") or 0,
            "updated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        })
    return data_list


def storage_data():
    coins = get_data()
    data = format_data(coins)

    conn = psycopg2.connect(
        host="postgres", port="5432",
        database="airflow", user="airflow", password="airflow",
    )
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
            updated_at TIMESTAMP
        )
    """)

    for crypto in data:
        cur.execute("""
            INSERT INTO cryptos (id, symbol, name, rank, price,
                price_change_24h, volume, volume_24h,
                volume_change_24h, market_cap, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            crypto["id"], crypto["symbol"], crypto["name"], crypto["rank"],
            crypto["price"], crypto["price_change_24h"],
            crypto["volume"], crypto["volume_24h"],
            crypto["volume_change_24h"], crypto["market_cap"],
            crypto["updated_at"],
        ))
    conn.commit()
    conn.close()
    logging.info(f"Stored {len(data)} coins to PostgreSQL")


def stream_data():
    try:
        from kafka import KafkaProducer
        producer = KafkaProducer(
            bootstrap_servers=["broker:29092"],
            max_block_ms=5000,
        )
    except Exception as e:
        logging.warning(f"Kafka not available, skipping streaming: {e}")
        return

    curr_time = time.time()
    while time.time() < curr_time + 60:
        try:
            coins = get_data()
            data_list = format_data(coins)
            for data in data_list:
                producer.send("cryptos_created", json.dumps(data).encode("utf-8"))
                logging.info(f"Sent to Kafka: {data['symbol']} @ {data['price']}")
        except Exception as e:
            logging.error(f"Error in stream loop: {e}")
            break
    producer.close()
    logging.info("Streaming task complete")


default_args = {
    "owner": "rayen_lassoued",
    "start_date": datetime.datetime(2024, 9, 3, 10, 0),
    "retries": 1,
}

with DAG(
    "crypto_automation",
    default_args=default_args,
    schedule_interval="@hourly",
    catchup=False,
) as dag:
    storage_task = PythonOperator(
        task_id="store_data_crypto",
        python_callable=storage_data,
    )
    streaming_task = PythonOperator(
        task_id="stream_data_crypto",
        python_callable=stream_data,
    )

    storage_task >> streaming_task
