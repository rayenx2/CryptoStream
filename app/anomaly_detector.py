"""
Real-time anomaly detection for crypto price streams.
Detects price spikes, volume anomalies, and wash trading patterns.
"""
from dataclasses import dataclass, field
from collections import deque
from enum import Enum
from typing import Optional
import statistics


class AnomalyType(str, Enum):
    PRICE_SPIKE = "price_spike"
    VOLUME_SPIKE = "volume_spike"
    FLASH_CRASH = "flash_crash"
    LOW_LIQUIDITY = "low_liquidity"


@dataclass
class PriceTick:
    symbol: str
    price: float
    volume: float
    timestamp_ms: int


@dataclass
class Anomaly:
    anomaly_type: AnomalyType
    symbol: str
    severity: float  # 0-1, higher = more severe
    description: str
    price: float
    z_score: float
    timestamp_ms: int

    def to_dict(self) -> dict:
        return {
            "type": self.anomaly_type.value,
            "symbol": self.symbol,
            "severity": round(self.severity, 3),
            "description": self.description,
            "price": self.price,
            "z_score": round(self.z_score, 2),
            "timestamp_ms": self.timestamp_ms,
        }


class StreamAnomalyDetector:
    """
    Sliding window Z-score anomaly detector for streaming price data.
    Uses rolling mean and std over configurable window size.
    """

    def __init__(
        self,
        window_size: int = 100,
        price_z_threshold: float = 3.5,
        volume_z_threshold: float = 4.0,
        flash_crash_pct: float = 0.05,
    ):
        self.window_size = window_size
        self.price_z_threshold = price_z_threshold
        self.volume_z_threshold = volume_z_threshold
        self.flash_crash_pct = flash_crash_pct

        self._price_windows: dict[str, deque] = {}
        self._volume_windows: dict[str, deque] = {}

    def _get_window(self, symbol: str) -> tuple[deque, deque]:
        if symbol not in self._price_windows:
            self._price_windows[symbol] = deque(maxlen=self.window_size)
            self._volume_windows[symbol] = deque(maxlen=self.window_size)
        return self._price_windows[symbol], self._volume_windows[symbol]

    def _z_score(self, value: float, window: deque) -> Optional[float]:
        if len(window) < 10:
            return None
        mean = statistics.mean(window)
        stdev = statistics.stdev(window)
        if stdev == 0:
            return 0.0
        return (value - mean) / stdev

    def process_tick(self, tick: PriceTick) -> list[Anomaly]:
        """Process a single price tick and return any anomalies detected."""
        price_win, vol_win = self._get_window(tick.symbol)
        anomalies = []

        # Flash crash detection (before updating window)
        if price_win and tick.price < price_win[-1] * (1 - self.flash_crash_pct):
            drop_pct = (price_win[-1] - tick.price) / price_win[-1]
            anomalies.append(Anomaly(
                anomaly_type=AnomalyType.FLASH_CRASH,
                symbol=tick.symbol,
                severity=min(1.0, drop_pct / 0.20),  # 20% = max severity
                description=f"Price dropped {drop_pct:.1%} in one tick",
                price=tick.price,
                z_score=0.0,
                timestamp_ms=tick.timestamp_ms,
            ))

        # Price spike detection
        price_z = self._z_score(tick.price, price_win)
        if price_z is not None and abs(price_z) > self.price_z_threshold:
            anomalies.append(Anomaly(
                anomaly_type=AnomalyType.PRICE_SPIKE,
                symbol=tick.symbol,
                severity=min(1.0, abs(price_z) / (self.price_z_threshold * 2)),
                description=f"Price z-score {price_z:.1f} exceeds threshold {self.price_z_threshold}",
                price=tick.price,
                z_score=price_z,
                timestamp_ms=tick.timestamp_ms,
            ))

        # Volume spike detection
        vol_z = self._z_score(tick.volume, vol_win)
        if vol_z is not None and vol_z > self.volume_z_threshold:
            anomalies.append(Anomaly(
                anomaly_type=AnomalyType.VOLUME_SPIKE,
                symbol=tick.symbol,
                severity=min(1.0, vol_z / (self.volume_z_threshold * 2)),
                description=f"Volume z-score {vol_z:.1f} — possible wash trading",
                price=tick.price,
                z_score=vol_z,
                timestamp_ms=tick.timestamp_ms,
            ))

        price_win.append(tick.price)
        vol_win.append(tick.volume)

        return anomalies

    def process_batch(self, ticks: list[PriceTick]) -> list[Anomaly]:
        """Process a batch of ticks (Spark micro-batch compatible)."""
        all_anomalies = []
        for tick in ticks:
            all_anomalies.extend(self.process_tick(tick))
        return all_anomalies
