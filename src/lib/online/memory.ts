/**
 * 단일 프로세스용 방 저장소/버스. 로컬 개발 서버(`server/game-server.ts`)가 쓴다.
 * Redis 없이도 `npm run dev`가 그대로 동작하게 한다.
 */
import type {
  AwayResult,
  Bus,
  BroadcastMessage,
  ClaimResult,
  DepartResult,
  MoveResult,
  RematchResult,
  ResumeResult,
  RoomSnapshot,
  RoomStore,
  StaleResult,
} from "./types";
import {
  applyMove,
  applyRematch,
  claimSeat,
  departSeat,
  findStale,
  freshRoom,
  generateRoomCode,
  markAway,
  resumeSeat,
} from "./room";

export function createMemoryStore(): RoomStore {
  const rooms = new Map<string, RoomSnapshot>();

  return {
    async create(token) {
      const code = await generateRoomCode((candidate) => rooms.has(candidate));
      const snapshot = freshRoom(code, token);
      rooms.set(code, snapshot);
      return snapshot;
    },

    async claim(code, token): Promise<ClaimResult> {
      const snap = rooms.get(code);
      if (!snap) return { kind: "missing" };
      const outcome = claimSeat(snap, token);
      if (outcome === null) return { kind: "missing" };
      rooms.set(code, outcome.snapshot);
      if (outcome.mark === null) {
        return { kind: "spectator", snapshot: outcome.snapshot };
      }
      return {
        kind: "seated",
        mark: outcome.mark,
        event: outcome.event,
        snapshot: outcome.snapshot,
      };
    },

    async resume(code, token): Promise<ResumeResult> {
      const snap = rooms.get(code);
      if (!snap) return { kind: "missing" };
      const outcome = resumeSeat(snap, token);
      if (!outcome) return { kind: "invalid" };
      rooms.set(code, outcome.snapshot);
      return { kind: "seated", mark: outcome.mark, snapshot: outcome.snapshot };
    },

    async move(code, mark, index): Promise<MoveResult> {
      const snap = rooms.get(code);
      if (!snap) return { kind: "missing" };
      const outcome = applyMove(snap, mark, index);
      if (!outcome) return { kind: "invalid" };
      rooms.set(code, outcome.snapshot);
      return { kind: "applied", event: outcome.event, snapshot: outcome.snapshot };
    },

    async rematch(code, mark): Promise<RematchResult> {
      const snap = rooms.get(code);
      if (!snap) return { kind: "missing" };
      const outcome = applyRematch(snap, mark);
      if (!outcome) return { kind: "invalid" };
      rooms.set(code, outcome.snapshot);
      return {
        kind: "applied",
        event: outcome.event,
        snapshot: outcome.snapshot,
        swap: outcome.swap,
      };
    },

    async away(code, mark): Promise<AwayResult> {
      const snap = rooms.get(code);
      if (!snap) return { kind: "missing" };
      const snapshot = markAway(snap, mark);
      rooms.set(code, snapshot);
      return { kind: "away", snapshot };
    },

    async depart(code, mark): Promise<DepartResult> {
      const snap = rooms.get(code);
      if (!snap) return { kind: "missing" };
      const outcome = departSeat(snap, mark);
      if (outcome.empty) {
        rooms.delete(code);
      } else {
        rooms.set(code, outcome.snapshot);
      }
      return { kind: "left", ...outcome };
    },

    async checkStale(code, awayGraceMs): Promise<StaleResult> {
      const snap = rooms.get(code);
      if (!snap) return { kind: "missing" };
      const outcome = findStale(snap, awayGraceMs, Date.now());
      if (!outcome) return { kind: "unchanged" };
      rooms.set(code, outcome.snapshot);
      return { kind: "changed", event: outcome.event, snapshot: outcome.snapshot };
    },
  };
}

export function createMemoryBus(): Bus {
  const handlers = new Set<(message: BroadcastMessage) => void>();

  return {
    publish(message) {
      for (const handler of handlers) handler(message);
    },
    subscribe(handler) {
      handlers.add(handler);
    },
    close() {
      handlers.clear();
    },
  };
}
