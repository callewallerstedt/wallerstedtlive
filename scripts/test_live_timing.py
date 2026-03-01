import argparse
import asyncio
import time
from datetime import datetime, timezone

from TikTokLive import TikTokLiveClient
from TikTokLive.events import CommentEvent, RoomUserSeqEvent, ConnectEvent, DisconnectEvent


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def run_test(username: str, duration_sec: int = 35):
    client = TikTokLiveClient(unique_id=f"@{username}")

    viewer_events = []
    comment_events = []
    connect_info = {"connected": False, "room_id": None, "connected_at": None}

    @client.on(ConnectEvent)
    async def on_connect(event: ConnectEvent):
        connect_info["connected"] = True
        connect_info["room_id"] = str(getattr(event, "room_id", "") or "")
        connect_info["connected_at"] = time.time()
        print(f"[{iso_now()}] CONNECT room={connect_info['room_id']}", flush=True)

    @client.on(DisconnectEvent)
    async def on_disconnect(_: DisconnectEvent):
        print(f"[{iso_now()}] DISCONNECT", flush=True)

    @client.on(RoomUserSeqEvent)
    async def on_room_user_seq(event: RoomUserSeqEvent):
        ts = time.time()
        viewers = int(getattr(event, "m_total", 0) or 0)
        enters = int(getattr(event, "total_user", 0) or 0)
        likes = int(getattr(event, "m_popularity", 0) or 0)
        viewer_events.append((ts, viewers, enters, likes))
        print(f"[{iso_now()}] VIEWERS viewers={viewers} enters={enters} likes={likes}", flush=True)

    @client.on(CommentEvent)
    async def on_comment(event: CommentEvent):
        ts = time.time()
        user = getattr(event, "user", None)
        uid = getattr(user, "unique_id", None)
        text = (getattr(event, "comment", "") or "").strip()
        comment_events.append((ts, uid, text))
        print(f"[{iso_now()}] COMMENT @{uid}: {text}", flush=True)

    print(f"[{iso_now()}] Starting test for @{username} ({duration_sec}s)", flush=True)

    start = time.time()
    try:
        await client.start(
            process_connect_events=False,
            fetch_room_info=True,
            fetch_gift_info=False,
            fetch_live_check=True,
            compress_ws_events=True,
        )

        while time.time() - start < duration_sec:
            await asyncio.sleep(0.2)

    except Exception as e:
        print(f"[{iso_now()}] ERROR {type(e).__name__}: {e}", flush=True)
        return 1
    finally:
        try:
            if client.connected:
                await client.disconnect(close_client=True)
        except Exception as e:
            print(f"[{iso_now()}] DISCONNECT_WARNING: {e}", flush=True)

    # Summary metrics
    print("\n=== SUMMARY ===", flush=True)
    print(f"connected: {connect_info['connected']}", flush=True)
    print(f"room_id: {connect_info['room_id']}", flush=True)
    print(f"viewer_event_count: {len(viewer_events)}", flush=True)
    print(f"comment_event_count: {len(comment_events)}", flush=True)

    if len(viewer_events) >= 2:
        intervals = [viewer_events[i][0] - viewer_events[i - 1][0] for i in range(1, len(viewer_events))]
        avg_interval = sum(intervals) / len(intervals)
        max_interval = max(intervals)
        min_interval = min(intervals)
        print(f"viewer_interval_avg_sec: {avg_interval:.2f}", flush=True)
        print(f"viewer_interval_min_sec: {min_interval:.2f}", flush=True)
        print(f"viewer_interval_max_sec: {max_interval:.2f}", flush=True)
        print(f"viewer_updates_within_5s: {'YES' if max_interval <= 5.0 else 'NO'}", flush=True)
    elif len(viewer_events) == 1:
        print("viewer_updates_within_5s: INCONCLUSIVE (only 1 event)", flush=True)
    else:
        print("viewer_updates_within_5s: NO (no viewer events)", flush=True)

    if comment_events:
        first_comment_age = comment_events[0][0] - start
        print(f"first_comment_after_sec: {first_comment_age:.2f}", flush=True)
        print("live_comment_stream: YES", flush=True)
    else:
        print("live_comment_stream: NO (no comments captured during test window)", flush=True)

    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=True)
    parser.add_argument("--duration-sec", type=int, default=35)
    args = parser.parse_args()
    raise SystemExit(asyncio.run(run_test(args.username.strip().lstrip("@"), args.duration_sec)))


if __name__ == "__main__":
    main()
