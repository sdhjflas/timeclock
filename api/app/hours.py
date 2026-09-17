from datetime import datetime, time, timedelta, timezone

from . import config


def period(today):
    start = config.PERIOD_ANCHOR + timedelta(
        days=((today - config.PERIOD_ANCHOR).days // config.PERIOD_DAYS)
        * config.PERIOD_DAYS
    )
    return start, start + timedelta(days=config.PERIOD_DAYS)


def boundary(day):
    return datetime.combine(day, time.min, config.ZONE).astimezone(timezone.utc)


def daily_totals(shifts, start, end):
    result = []
    day = start
    while day < end:
        left, right = boundary(day), boundary(day + timedelta(days=1))
        seconds = 0
        for shift in shifts:
            if shift["ended_at"] is None:
                continue
            seconds += max(
                0,
                (
                    min(shift["ended_at"].astimezone(timezone.utc), right)
                    - max(shift["started_at"].astimezone(timezone.utc), left)
                ).total_seconds(),
            )
        result.append({"date": day.isoformat(), "seconds": seconds})
        day += timedelta(days=1)
    return result
