/**
 * Redis 기반 방 저장소/버스. Vercel처럼 함수 인스턴스가 여러 개로 나뉘는 환경용.
 *
 * - 방 스냅샷은 `tic-tac-toe:room:{code}` 키에 JSON으로 보관하고 (TTL로 방 청소)
 * - 값 갱신은 WATCH/MULTI 낙관적 트랜잭션으로 직렬화한다
 * - 브로드캐스트는 pub/sub으로 모든 인스턴스에 전파한다
 */
import Redis from "ioredis";
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

const ROOM_KEY_PREFIX = "tic-tac-toe:room:";
const ROOM_TTL_SECONDS = 60 * 60 * 2;
const CAS_ATTEMPTS = 25;

export const ROOM_CHANNEL_PATTERN = `${ROOM_KEY_PREFIX}*`;

function roomKey(code: string): string {
  return `${ROOM_KEY_PREFIX}${code}`;
}

function parseSnapshot(raw: string): RoomSnapshot | null {
  try {
    return JSON.parse(raw) as RoomSnapshot;
  } catch {
    return null;
  }
}

type Mutation<T> = {
  snapshot: RoomSnapshot;
  result: T;
  destroy?: boolean;
};

export function createRedisStore(client: Redis): RoomStore {
  /**
   * 스냅샷을 읽고 → 규칙을 적용하고 → 다시 쓴다.
   * 사이에 다른 인스턴스가 방을 건드리면 WATCH가 감지해 재시도한다.
   */
  async function mutate<T>(
    code: string,
    transition: (snapshot: RoomSnapshot) => Mutation<T> | null,
  ): Promise<T | null> {
    const key = roomKey(code);

    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      await client.watch(key);
      const raw = await client.get(key);
      if (!raw) {
        await client.unwatch();
        return null;
      }
      const snap = parseSnapshot(raw);
      if (!snap) {
        await client.unwatch();
        return null;
      }

      const next = transition(snap);
      if (next === null) {
        await client.unwatch();
        return null;
      }

      const exec = next.destroy
        ? await client.multi().del(key).exec()
        : await client
            .multi()
            .set(key, JSON.stringify(next.snapshot), "EX", ROOM_TTL_SECONDS)
            .exec();

      // exec가 null이면 WATCH 중에 키가 바뀌었다는 뜻 — 다시 시도
      if (exec === null) continue;
      if (exec.some(([error]) => error !== null)) continue;
      return next.result;
    }

    throw new Error(`방 상태 갱신에 실패했어요 (${code})`);
  }

  return {
    async create(token) {
      const code = await generateRoomCode(async (candidate) =>
        Boolean(await client.exists(roomKey(candidate))),
      );
      const snapshot = freshRoom(code, token);
      await client.set(roomKey(code), JSON.stringify(snapshot), "EX", ROOM_TTL_SECONDS);
      return snapshot;
    },

    async claim(code, token): Promise<ClaimResult> {
      const result = await mutate<ClaimResult>(code, (snap) => {
        const outcome = claimSeat(snap, token);
        if (outcome === null) return null;
        if (outcome.mark === null) {
          return {
            snapshot: outcome.snapshot,
            result: { kind: "spectator", snapshot: outcome.snapshot } satisfies ClaimResult,
          };
        }
        return {
          snapshot: outcome.snapshot,
          result: {
            kind: "seated",
            mark: outcome.mark,
            event: outcome.event,
            snapshot: outcome.snapshot,
          } satisfies ClaimResult,
        };
      });
      return result ?? { kind: "missing" };
    },

    async resume(code, token): Promise<ResumeResult> {
      const result = await mutate<ResumeResult>(code, (snap) => {
        const outcome = resumeSeat(snap, token);
        if (!outcome) return null;
        return {
          snapshot: outcome.snapshot,
          result: {
            kind: "seated",
            mark: outcome.mark,
            snapshot: outcome.snapshot,
          } satisfies ResumeResult,
        };
      });
      return result ?? { kind: "missing" };
    },

    async move(code, mark, index): Promise<MoveResult> {
      const result = await mutate<MoveResult>(code, (snap) => {
        const outcome = applyMove(snap, mark, index);
        if (!outcome) return null;
        return {
          snapshot: outcome.snapshot,
          result: {
            kind: "applied",
            event: outcome.event,
            snapshot: outcome.snapshot,
          } satisfies MoveResult,
        };
      });
      return result ?? { kind: "missing" };
    },

    async rematch(code, mark): Promise<RematchResult> {
      const result = await mutate<RematchResult>(code, (snap) => {
        const outcome = applyRematch(snap, mark);
        if (!outcome) return null;
        return {
          snapshot: outcome.snapshot,
          result: {
            kind: "applied",
            event: outcome.event,
            snapshot: outcome.snapshot,
            swap: outcome.swap,
          } satisfies RematchResult,
        };
      });
      return result ?? { kind: "missing" };
    },

    async away(code, mark): Promise<AwayResult> {
      const result = await mutate<AwayResult>(code, (snap) => {
        const snapshot = markAway(snap, mark);
        return {
          snapshot,
          result: { kind: "away", snapshot } satisfies AwayResult,
        };
      });
      return result ?? { kind: "missing" };
    },

    async depart(code, mark): Promise<DepartResult> {
      const result = await mutate<DepartResult>(code, (snap) => {
        const outcome = departSeat(snap, mark);
        return {
          snapshot: outcome.snapshot,
          destroy: outcome.empty,
          result: {
            kind: "left",
            event: outcome.event,
            snapshot: outcome.snapshot,
            empty: outcome.empty,
          } satisfies DepartResult,
        };
      });
      return result ?? { kind: "missing" };
    },

    async checkStale(code, awayGraceMs): Promise<StaleResult> {
      const result = await mutate<StaleResult>(code, (snap) => {
        const outcome = findStale(snap, awayGraceMs, Date.now());
        if (!outcome) return null;
        return {
          snapshot: outcome.snapshot,
          result: {
            kind: "changed",
            event: outcome.event,
            snapshot: outcome.snapshot,
          } satisfies StaleResult,
        };
      });
      return result ?? { kind: "missing" };
    },
  };
}

export function createRedisBus(client: Redis): Bus {
  const subscriber = client.duplicate();
  let handler: ((message: BroadcastMessage) => void) | null = null;

  subscriber.on("pmessage", (_pattern, _channel, raw) => {
    if (!handler) return;
    try {
      handler(JSON.parse(raw) as BroadcastMessage);
    } catch {
      // 깨진 메시지는 무시한다
    }
  });

  const ready = subscriber
    .psubscribe(ROOM_CHANNEL_PATTERN)
    .then(() => undefined)
    .catch((error: unknown) => {
      console.error("[error] Redis pub/sub 구독 실패:", error);
      throw error;
    });

  return {
    publish(message) {
      void client
        .publish(roomKey(message.code), JSON.stringify(message))
        .catch((error: unknown) => {
          console.error("[error] Redis publish 실패:", error);
        });
    },
    subscribe(next) {
      handler = next;
      return ready;
    },
    close() {
      subscriber.disconnect();
    },
  };
}

/** ioredis(TCP)로 접속할 수 있는 URL만 골라낸다. REST(https) URL은 제외 */
function pickRedisUrl(): string {
  const candidates = [
    "REDIS_URL",
    "REDIS_TCP_URL",
    "KV_REDIS_URL",
    "STORAGE_URL",
  ];
  let restOnly: string | null = null;

  for (const name of candidates) {
    const value = process.env[name];
    if (!value) continue;
    if (/^rediss?:\/\//i.test(value)) return value;
    restOnly ??= `${name}은(는) https:// REST 주소라서 웹소켓 서버가 쓰는 TCP 클라이언트(ioredis)와 호환되지 않아요`;
  }

  const hint = restOnly
    ? ` (${restOnly} — Upstash 콘솔에서 rediss://로 시작하는 연결 문자열을 REDIS_URL에 넣어주세요)`
    : "";
  throw new Error(
    `TCP 접속용 REDIS_URL 환경변수가 없어요. Vercel Marketplace에서 Redis(Upstash)를 추가하면 자동으로 주입돼요.${hint}`,
  );
}

/** Vercel Marketplace Redis 등의 접속 정보로 클라이언트를 만든다 */
export function createRedisClient(): Redis {
  return new Redis(pickRedisUrl(), {
    connectTimeout: 10_000,
    maxRetriesPerRequest: 3,
  });
}
