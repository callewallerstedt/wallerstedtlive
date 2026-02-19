import argparse
import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

try:
    from TikTokLive import TikTokLiveClient
    from TikTokLive.events import CommentEvent, ConnectEvent, DisconnectEvent, GiftEvent, LikeEvent, RoomUserSeqEvent
except Exception as import_error:  # pragma: no cover
    print(
        json.dumps(
            {
                "ok": False,
                "error": f"TikTokLive import failed: {import_error}",
                "warnings": ["Install dependency with: python -m pip install TikTokLive"],
            }
        )
    )
    raise SystemExit(0)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def to_int(value: Any, default: int = 0) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(float(value))
        except Exception:
            return default
    return default


def as_str(value: Any) -> Optional[str]:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def find_first_string(data: Any, keys: set[str]) -> Optional[str]:
    if isinstance(data, dict):
        for key, value in data.items():
            if key in keys and isinstance(value, str) and value.strip():
                return value.strip()
            found = find_first_string(value, keys)
            if found:
                return found
    elif isinstance(data, list):
        for item in data:
            found = find_first_string(item, keys)
            if found:
                return found
    return None


def find_max_int(data: Any, keys: set[str]) -> int:
    best = 0
    if isinstance(data, dict):
        for key, value in data.items():
            if key in keys:
                best = max(best, to_int(value, 0))
            best = max(best, find_max_int(value, keys))
    elif isinstance(data, list):
        for item in data:
            best = max(best, find_max_int(item, keys))
    return best


def parse_current_viewers_from_room_info(room_info: Dict[str, Any]) -> int:
    # Current concurrent viewer signals (avoid cumulative totals like total_user).
    return max(
        0,
        find_max_int(
            room_info,
            {
                "user_count",
                "watch_user_count",
                "viewer_count",
                "viewerCount",
                "room_user_count",
            },
        ),
    )


def parse_total_enters_from_room_info(room_info: Dict[str, Any]) -> int:
    # Cumulative enter/total watcher signals.
    return max(
        0,
        find_max_int(
            room_info,
            {
                "total_user",
                "totalUser",
                "enter_count",
                "enterCount",
                "total_enter_count",
            },
        ),
    )


class LiveCaptureState:
    def __init__(self, username: str):
        self.username = username
        self.warnings: List[str] = []
        self.room_id: Optional[str] = None
        self.title: Optional[str] = None
        self.status_code: int = 0
        self.is_live: bool = False
        self.current_viewers: int = 0
        self.current_likes: int = 0
        self.current_enters: int = 0
        self.samples: List[Dict[str, Any]] = []
        self.comments: List[Dict[str, Any]] = []
        self.gifts: List[Dict[str, Any]] = []

    def snapshot(self) -> Dict[str, Any]:
        return {
            "username": self.username,
            "isLive": self.is_live,
            "statusCode": self.status_code,
            "viewerCount": max(0, int(self.current_viewers)),
            "likeCount": max(0, int(self.current_likes)),
            "enterCount": max(0, int(self.current_enters)),
            "roomId": self.room_id,
            "title": self.title,
            "fetchedAt": now_iso(),
        }

    def add_sample(self) -> Dict[str, Any]:
        sample = {
            "capturedAt": now_iso(),
            "viewerCount": max(0, int(self.current_viewers)),
            "likeCount": max(0, int(self.current_likes)),
            "enterCount": max(0, int(self.current_enters)),
        }
        self.samples.append(sample)
        return sample


def emit_line(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=True), flush=True)


def apply_optional_session(client: TikTokLiveClient, state: LiveCaptureState) -> None:
    session_id = (os.getenv("TIKTOK_SESSION_ID") or "").strip()
    tt_target_idc = (os.getenv("TIKTOK_TT_TARGET_IDC") or "").strip() or None
    if not session_id:
        return
    try:
        client.web.set_session(session_id=session_id, tt_target_idc=tt_target_idc)
    except Exception as session_error:
        state.warnings.append(f"session cookie setup failed: {session_error}")


async def bootstrap_client(
    state: LiveCaptureState,
    client: TikTokLiveClient,
    *,
    emit_events: bool,
    precheck_live: bool,
    collect_chat: bool,
    max_comments: int,
    max_gifts: int,
) -> bool:
    @client.on(ConnectEvent)
    async def on_connect(event: ConnectEvent) -> None:
        state.is_live = True
        state.status_code = 1
        state.room_id = str(getattr(event, "room_id", "") or "").strip() or state.room_id
        if emit_events:
            emit_line({"type": "meta", **state.snapshot()})

    @client.on(DisconnectEvent)
    async def on_disconnect(_: DisconnectEvent) -> None:
        if state.status_code == 1:
            state.status_code = 2

    @client.on(RoomUserSeqEvent)
    async def on_room_user_seq(event: RoomUserSeqEvent) -> None:
        viewers = to_int(getattr(event, "m_total", 0), 0)
        enters = to_int(getattr(event, "total_user", 0), 0)
        likes = to_int(getattr(event, "m_popularity", 0), 0)
        if viewers > 0:
            state.current_viewers = viewers
        if enters > 0:
            state.current_enters = max(state.current_enters, enters)
        if likes > 0:
            state.current_likes = max(state.current_likes, likes)

    @client.on(LikeEvent)
    async def on_like(event: LikeEvent) -> None:
        total_likes = to_int(getattr(event, "total", 0), 0)
        if total_likes > 0:
            state.current_likes = max(state.current_likes, total_likes)

    @client.on(CommentEvent)
    async def on_comment(event: CommentEvent) -> None:
        if not collect_chat or max_comments == 0 or len(state.comments) >= max_comments:
            return

        user = getattr(event, "user", None)
        row = {
            "createdAt": now_iso(),
            "userUniqueId": as_str(getattr(user, "unique_id", None)),
            "nickname": as_str(getattr(user, "nickname", None)),
            "comment": as_str(getattr(event, "comment", None)) or "",
        }
        state.comments.append(row)
        if emit_events:
            emit_line({"type": "comment", **row})

    @client.on(GiftEvent)
    async def on_gift(event: GiftEvent) -> None:
        if not collect_chat or max_gifts == 0 or len(state.gifts) >= max_gifts:
            return

        gift_obj = getattr(event, "gift", None)
        gift_info = getattr(gift_obj, "info", None)
        streakable = bool(getattr(gift_obj, "streakable", False))
        streaking = bool(getattr(event, "streaking", False) or getattr(gift_obj, "streaking", False))
        if streakable and streaking:
            return

        user = getattr(event, "user", None)
        diamond_count = max(
            0,
            to_int(getattr(gift_obj, "diamond_count", 0), 0),
            to_int(getattr(gift_info, "diamond_count", 0), 0),
        )
        repeat_count = max(
            1,
            to_int(getattr(event, "repeat_count", 0), 0),
            to_int(getattr(event, "count", 0), 0),
            to_int(getattr(gift_obj, "count", 0), 0),
        )
        row = {
            "createdAt": now_iso(),
            "userUniqueId": as_str(getattr(user, "unique_id", None)),
            "nickname": as_str(getattr(user, "nickname", None)),
            "giftName": as_str(getattr(gift_obj, "name", None)),
            "diamondCount": diamond_count,
            "repeatCount": repeat_count,
        }
        state.gifts.append(row)
        if emit_events:
            emit_line({"type": "gift", **row})

    if precheck_live:
        live_check = bool(await client.is_live())
        if not live_check:
            state.status_code = 4
            state.is_live = False
            return False

    state.is_live = True
    state.status_code = 1
    await client.start(
        process_connect_events=False,
        fetch_room_info=True,
        fetch_gift_info=False,
        fetch_live_check=not precheck_live,
        compress_ws_events=True,
    )
    await asyncio.sleep(1.25)

    room_info = client.room_info or {}
    state.room_id = state.room_id or (str(client.room_id) if client.room_id else None)
    state.title = find_first_string(room_info, {"title", "room_title", "live_title"})
    state.current_viewers = max(state.current_viewers, parse_current_viewers_from_room_info(room_info))
    state.current_likes = max(
        state.current_likes,
        find_max_int(room_info, {"like_count", "likeCount", "m_popularity", "total_like", "likes"}),
    )
    state.current_enters = max(state.current_enters, parse_total_enters_from_room_info(room_info))

    return True


async def safe_disconnect(client: TikTokLiveClient, state: LiveCaptureState) -> None:
    try:
        if client.connected:
            await client.disconnect(close_client=True)
    except Exception as disconnect_error:
        state.warnings.append(f"disconnect warning: {disconnect_error}")


async def capture_live(args: argparse.Namespace) -> Dict[str, Any]:
    username = args.username.strip().lstrip("@")
    duration_sec = max(5, int(args.duration_sec))
    sample_interval_sec = max(0.2, float(args.sample_interval_sec))
    max_comments = max(0, int(args.max_comments))
    max_gifts = max(0, int(args.max_gifts))
    collect_chat = bool(args.collect_chat)
    mode = args.mode

    state = LiveCaptureState(username=username)
    client = TikTokLiveClient(unique_id=f"@{username}")
    client.logger.setLevel(logging.ERROR)
    apply_optional_session(client, state)

    try:
        is_live = await bootstrap_client(
            state,
            client,
            emit_events=False,
            precheck_live=True,
            collect_chat=collect_chat,
            max_comments=max_comments,
            max_gifts=max_gifts,
        )
        if not is_live:
            state.add_sample()
            return {
                "ok": True,
                "mode": mode,
                **state.snapshot(),
                "samples": state.samples,
                "comments": state.comments,
                "gifts": state.gifts,
                "warnings": state.warnings,
            }

        if mode == "check":
            probe_end = time.monotonic() + 3
            while time.monotonic() < probe_end:
                await asyncio.sleep(0.2)
            state.add_sample()
            await safe_disconnect(client, state)
            return {
                "ok": True,
                "mode": mode,
                **state.snapshot(),
                "samples": state.samples,
                "comments": state.comments,
                "gifts": state.gifts,
                "warnings": state.warnings,
            }

        stop_at = time.monotonic() + duration_sec
        next_sample_at = time.monotonic()
        while time.monotonic() < stop_at:
            if time.monotonic() >= next_sample_at:
                state.add_sample()
                next_sample_at += sample_interval_sec
            await asyncio.sleep(0.15)

        state.add_sample()
        await safe_disconnect(client, state)

        return {
            "ok": True,
            "mode": mode,
            **state.snapshot(),
            "samples": state.samples,
            "comments": state.comments,
            "gifts": state.gifts,
            "warnings": state.warnings,
        }
    except Exception as capture_error:
        await safe_disconnect(client, state)
        return {
            "ok": False,
            "mode": mode,
            "username": username,
            "error": str(capture_error),
            "warnings": state.warnings,
            "samples": state.samples,
            "comments": state.comments,
            "gifts": state.gifts,
        }


async def capture_live_stream(args: argparse.Namespace) -> int:
    username = args.username.strip().lstrip("@")
    duration_sec = int(args.duration_sec)
    sample_interval_sec = max(0.2, float(args.sample_interval_sec))
    max_comments = max(0, int(args.max_comments))
    max_gifts = max(0, int(args.max_gifts))
    collect_chat = bool(args.collect_chat)

    state = LiveCaptureState(username=username)
    client = TikTokLiveClient(unique_id=f"@{username}")
    client.logger.setLevel(logging.ERROR)
    apply_optional_session(client, state)

    try:
        is_live = await bootstrap_client(
            state,
            client,
            emit_events=True,
            precheck_live=False,
            collect_chat=collect_chat,
            max_comments=max_comments,
            max_gifts=max_gifts,
        )
        if not is_live:
            emit_line({"type": "meta", **state.snapshot()})
            emit_line({"type": "sample", **state.add_sample()})
            emit_line({"type": "end", "ok": True, "isLive": False, "warnings": state.warnings, "error": None})
            return 0

        emit_line({"type": "meta", **state.snapshot()})

        stop_at = time.monotonic() + duration_sec if duration_sec > 0 else None
        next_sample_at = time.monotonic()
        while stop_at is None or time.monotonic() < stop_at:
            if time.monotonic() >= next_sample_at:
                emit_line({"type": "sample", **state.add_sample()})
                next_sample_at += sample_interval_sec
            await asyncio.sleep(0.15)

        emit_line({"type": "sample", **state.add_sample()})
        await safe_disconnect(client, state)
        emit_line({"type": "end", "ok": True, "isLive": True, "warnings": state.warnings, "error": None})
        return 0
    except Exception as capture_error:
        await safe_disconnect(client, state)
        text = str(capture_error)
        if "Age restricted stream" in text and not (os.getenv("TIKTOK_SESSION_ID") or "").strip():
            text = (
                f"{text} | Set TIKTOK_SESSION_ID in .env to access age-restricted lives."
            )
        emit_line(
            {
                "type": "end",
                "ok": False,
                "isLive": state.is_live,
                "warnings": state.warnings,
                "error": text,
            }
        )
        return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["check", "track", "stream"], required=True)
    parser.add_argument("--username", required=True)
    parser.add_argument("--duration-sec", type=int, default=60)
    parser.add_argument("--sample-interval-sec", type=float, default=1.0)
    parser.add_argument("--collect-chat", action="store_true")
    parser.add_argument("--max-comments", type=int, default=1200)
    parser.add_argument("--max-gifts", type=int, default=900)
    return parser


async def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if args.mode == "stream":
        code = await capture_live_stream(args)
        raise SystemExit(code)

    payload = await capture_live(args)
    print(json.dumps(payload, ensure_ascii=True))


if __name__ == "__main__":
    asyncio.run(main())
