/**
 * 방 상태 전이 규칙 (순수 함수).
 * 메모리 스토어와 Redis 스토어가 같은 규칙을 쓰도록 모아 둔다.
 */
import {
  applyOnlineMove,
  createOnlineState,
  resetOnlineState,
  type OnlineEvent,
  type Player,
} from "@/lib/tic-tac-toe";
import type { RoomSnapshot } from "./types";

/** 혼동하기 쉬운 문자(I, O, 0, 1)를 제외한 방 코드 알파벳 */
export const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export async function generateRoomCode(
  taken: (code: string) => boolean | Promise<boolean>,
): Promise<string> {
  for (;;) {
    let code = "";
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    if (!(await taken(code))) return code;
  }
}

export function freshRoom(code: string, token: string): RoomSnapshot {
  return {
    code,
    seats: { X: token, O: null },
    away: { X: null, O: null },
    state: { ...createOnlineState(), connected: { X: true, O: false } },
  };
}

function withState(snap: RoomSnapshot, state: RoomSnapshot["state"]): RoomSnapshot {
  return { ...snap, state };
}

function setConnected(
  state: RoomSnapshot["state"],
  mark: Player,
  value: boolean,
): RoomSnapshot["state"] {
  const connected =
    mark === "X"
      ? { ...state.connected, X: value }
      : { ...state.connected, O: value };
  return { ...state, connected };
}

/**
 * 빈 좌석에 앉는다. 대기 중인 방에서 유예 시간을 버티지 못한 유령 좌석은
 * 바로 거둔다 (새 참여자가 앉을 수 있게).
 */
export function claimSeat(
  snap: RoomSnapshot,
  token: string,
): { snapshot: RoomSnapshot; mark: Player | null; event: OnlineEvent | null } | null {
  const isFree = (mark: Player) =>
    snap.seats[mark] === null ||
    (snap.state.status === "waiting" && snap.away[mark] !== null);

  let mark: Player | null = null;
  if (isFree("X")) mark = "X";
  else if (isFree("O")) mark = "O";

  if (mark === null) {
    return { snapshot: snap, mark: null, event: null };
  }

  let snapshot: RoomSnapshot = {
    ...snap,
    seats: { ...snap.seats, [mark]: token },
    away: { ...snap.away, [mark]: null },
    state: setConnected(snap.state, mark, true),
  };

  let event: OnlineEvent | null = null;
  if (snapshot.seats.X !== null && snapshot.seats.O !== null && snapshot.state.status === "waiting") {
    snapshot = withState(snapshot, { ...snapshot.state, status: "playing" });
    event = "started";
  }
  return { snapshot, mark, event };
}

/** 토큰으로 자기 좌석을 되찾는다 */
export function resumeSeat(
  snap: RoomSnapshot,
  token: string,
): { mark: Player; snapshot: RoomSnapshot } | null {
  const mark: Player | null = snap.seats.X === token ? "X" : snap.seats.O === token ? "O" : null;
  if (mark === null) return null;
  return {
    mark,
    snapshot: {
      ...snap,
      away: { ...snap.away, [mark]: null },
      state: setConnected(snap.state, mark, true),
    },
  };
}

export function applyMove(
  snap: RoomSnapshot,
  mark: Player,
  index: number,
): { snapshot: RoomSnapshot; event: OnlineEvent } | null {
  if (snap.state.status !== "playing" || snap.state.current !== mark) return null;
  const outcome = applyOnlineMove(snap.state, index);
  if (!outcome) return null;
  const event: OnlineEvent = outcome.rotated
    ? "rotated"
    : outcome.state.result
      ? "ended"
      : "moved";
  return { snapshot: withState(snap, outcome.state), event };
}

export function applyRematch(
  snap: RoomSnapshot,
  mark: Player,
): { snapshot: RoomSnapshot; event: OnlineEvent | null; swap: boolean } | null {
  if (snap.state.status !== "ended" || snap.state.rematch[mark]) return null;
  const rematch = { ...snap.state.rematch, [mark]: true };

  if (rematch.X && rematch.O) {
    // 양쪽 모두 수락하면 좌석(토큰)을 서로 바꿔 X/O를 교대하고 새 라운드를 시작한다.
    return {
      snapshot: {
        ...snap,
        seats: { X: snap.seats.O, O: snap.seats.X },
        away: { X: snap.away.O, O: snap.away.X },
        state: { ...resetOnlineState(snap.state), connected: { X: true, O: true } },
      },
      event: "rematch",
      swap: true,
    };
  }
  return {
    snapshot: withState(snap, { ...snap.state, rematch }),
    event: null,
    swap: false,
  };
}

/** 예기치 않은 연결 종료 — 라운드는 유예 시간 동안 살려 둔다 */
export function markAway(snap: RoomSnapshot, mark: Player): RoomSnapshot {
  return {
    ...snap,
    away: { ...snap.away, [mark]: Date.now() },
    state: setConnected(snap.state, mark, false),
  };
}

export function departSeat(
  snap: RoomSnapshot,
  mark: Player,
): { snapshot: RoomSnapshot; event: OnlineEvent | null; empty: boolean } {
  let state = setConnected(snap.state, mark, false);
  let event: OnlineEvent | null = null;
  if (state.status === "playing") {
    state = { ...state, status: "ended" };
    event = "opponent-left";
  }
  const seats = { ...snap.seats, [mark]: null };
  return {
    snapshot: { ...snap, seats, away: { ...snap.away, [mark]: null }, state },
    event,
    empty: seats.X === null && seats.O === null,
  };
}

/** 유예 시간이 지나도록 돌아오지 않은 플레이어를 정리한다 */
export function findStale(
  snap: RoomSnapshot,
  awayGraceMs: number,
  now: number,
): { snapshot: RoomSnapshot; event: OnlineEvent } | null {
  let snapshot = snap;
  let event: OnlineEvent | null = null;

  for (const mark of ["X", "O"] as const) {
    const since = snapshot.away[mark];
    if (since === null || now - since < awayGraceMs) continue;

    if (snapshot.state.status === "playing") {
      // 진행 중이었다면 라운드를 종료 처리한다. 좌석 토큰은 살려 둬
      // 돌아온 플레이어가 리매치를 청할 수 있게 한다.
      snapshot = withState(snapshot, { ...snapshot.state, status: "ended" });
      event = "opponent-left";
    } else if (snapshot.state.status === "waiting") {
      // 대기 중이면 좌석만 비워 다른 사람이 앉을 수 있게 한다.
      snapshot = {
        ...snapshot,
        seats: { ...snapshot.seats, [mark]: null },
        away: { ...snapshot.away, [mark]: null },
      };
      event = event ?? "opponent-left";
    }
  }

  if (event === null) return null;
  return { snapshot, event };
}
