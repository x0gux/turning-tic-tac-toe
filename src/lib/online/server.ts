/**
 * 온라인 대전 서버 코어. 소켓 종류(ws, Vercel WebSocket)에 상관없이
 * 같은 메시지 처리 규칙을 쓰게 한다.
 *
 * - 연결별 상태(id, 방 코드, mark)는 인스턴스 로컬에만 둔다
 * - 방 게임 상태는 RoomStore(메모리 or Redis)에 두고 원자적으로 갱신한다
 * - 갱신이 일어나면 Bus로 전파해 그 방을 보고 있는 모든 인스턴스가 전송한다
 */
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { ClientMessage, Player, ServerMessage } from "@/lib/tic-tac-toe";
import type { BroadcastMessage, Bus, RoomStore } from "./types";

export type OnlineServer = {
  /** ws 패키지 소켓을 서버에 물린다 (로컬 서버와 Vercel route 모두 ws를 쓴다) */
  attach(ws: WebSocket): void;
  /** Bus 구독이 준비될 때까지 기다린다 */
  ready: Promise<void>;
};

export type OnlineServerOptions = {
  store: RoomStore;
  bus: Bus;
  /** 상대 연결이 끊긴 뒤 라운드를 종료 처리하기까지의 유예 시간 */
  awayGraceMs?: number;
  /** 끊긴 플레이어를 확인하는 주기 */
  staleCheckMs?: number;
  log?: (line: string) => void;
};

export const DEFAULT_AWAY_GRACE_MS = 60_000;
export const DEFAULT_STALE_CHECK_MS = 15_000;

const other = (mark: Player): Player => (mark === "X" ? "O" : "X");

export function createOnlineServer(options: OnlineServerOptions): OnlineServer {
  const awayGraceMs = options.awayGraceMs ?? DEFAULT_AWAY_GRACE_MS;
  const staleCheckMs = options.staleCheckMs ?? DEFAULT_STALE_CHECK_MS;

  type LocalConn = {
    id: string;
    send: (message: ServerMessage) => void;
    code: string | null;
    mark: Player | null;
  };

  const conns = new Map<string, LocalConn>();
  let ticker: ReturnType<typeof setInterval> | null = null;

  /* ---------------------------- 전파 → 전송 ---------------------------- */

  function deliver(broadcast: BroadcastMessage) {
    for (const conn of conns.values()) {
      if (conn.code !== broadcast.code) continue;
      // 리매치로 좌석이 바뀌었다면 이 인스턴스의 연결 mark도 함께 뒤집는다
      if (broadcast.swap && conn.mark !== null) conn.mark = other(conn.mark);
      conn.send({
        type: "state",
        event: broadcast.event,
        state: broadcast.state,
        you: conn.mark,
      });
    }
  }

  const ready = Promise.resolve(options.bus.subscribe(deliver)).then(() => undefined);

  async function publish(
    code: string,
    event: BroadcastMessage["event"],
    state: BroadcastMessage["state"],
    swap = false,
  ) {
    try {
      await options.bus.publish({ code, event, state, swap });
    } catch (error) {
      options.log?.(`[error] 브로드캐스트 실패 (${code}): ${String(error)}`);
    }
  }

  /* ------------------------------ 유예 정리 ------------------------------ */

  function startTicker() {
    if (ticker) return;
    ticker = setInterval(() => {
      void sweepStale();
    }, staleCheckMs);
    ticker.unref?.();
  }

  function stopTickerIfIdle() {
    if (!ticker || conns.size > 0) return;
    clearInterval(ticker);
    ticker = null;
  }

  async function sweepStale() {
    const codes = new Set<string>();
    for (const conn of conns.values()) {
      if (conn.code) codes.add(conn.code);
    }
    for (const code of codes) {
      const stale = await options.store.checkStale(code, awayGraceMs);
      if (stale.kind === "changed") {
        await publish(code, stale.event, stale.snapshot.state);
      }
    }
  }

  /* ----------------------------- 연결 수명 ----------------------------- */

  function attach(ws: WebSocket) {
    const conn: LocalConn = {
      id: randomUUID(),
      send: (message) => ws.send(JSON.stringify(message)),
      code: null,
      mark: null,
    };
    conns.set(conn.id, conn);
    startTicker();

    ws.on("message", (raw) => {
      void handle(conn, String(raw));
    });
    ws.on("close", () => {
      void detach(conn);
    });
    ws.on("error", () => {
      try {
        ws.close();
      } catch {
        // 이미 닫힌 소켓
      }
    });
  }

  /** 예기치 않은 연결 종료 — 좌석은 토큰으로 유예 시간 동안 보존된다 */
  async function detach(conn: LocalConn) {
    if (!conns.delete(conn.id)) return;
    stopTickerIfIdle();
    const { code, mark } = conn;
    conn.code = null;
    conn.mark = null;
    if (!code || !mark) return;

    const result = await options.store.away(code, mark);
    if (result.kind === "away") await publish(code, null, result.snapshot.state);
  }

  /** 나가기 버튼 등 의도적 퇴장 — 즉시 좌석을 비운다 */
  async function leaveRoom(conn: LocalConn) {
    const { code, mark } = conn;
    conn.code = null;
    conn.mark = null;
    if (!code || !mark) return;

    const result = await options.store.depart(code, mark);
    if (result.kind !== "left") return;
    await publish(code, result.event, result.snapshot.state);
  }

  /* ----------------------------- 메시지 처리 ----------------------------- */

  async function handle(conn: LocalConn, raw: string) {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      conn.send({ type: "error", message: "잘못된 요청이에요" });
      return;
    }
    try {
      await dispatch(conn, message);
    } catch (error) {
      options.log?.(`[error] 메시지 처리 실패: ${String(error)}`);
      conn.send({ type: "error", message: "서버 오류가 발생했어요" });
    }
  }

  async function dispatch(conn: LocalConn, message: ClientMessage) {
    switch (message.type) {
      case "create": {
        if (conn.code) await leaveRoom(conn);

        const token = randomUUID();
        const snapshot = await options.store.create(token);
        conn.code = snapshot.code;
        conn.mark = "X";

        conn.send({ type: "welcome", code: snapshot.code, you: "X", token });
        await publish(snapshot.code, "created", snapshot.state);
        options.log?.(`[room] ${snapshot.code} 생성됨`);
        break;
      }

      case "join": {
        if (conn.code) await leaveRoom(conn);

        const code = String(message.code ?? "").trim().toUpperCase();
        const token = randomUUID();
        const result = await options.store.claim(code, token);

        if (result.kind === "missing") {
          conn.send({ type: "error", message: "존재하지 않는 방 코드예요" });
          return;
        }
        conn.code = code;
        if (result.kind === "spectator") {
          conn.mark = null;
          conn.send({ type: "welcome", code, you: null, token: null });
          conn.send({ type: "notice", text: "인원이 꽉 차 관전자로 참여했어요" });
          // 관전자에게도 현재 상태 스냅샷이 필요하다
          await publish(code, null, result.snapshot.state);
          options.log?.(`[room] ${code} 참여 (관전자)`);
          return;
        }

        conn.mark = result.mark;
        conn.send({ type: "welcome", code, you: result.mark, token });
        await publish(code, result.event, result.snapshot.state);
        options.log?.(`[room] ${code} 참여 (${result.mark})`);
        break;
      }

      case "resume": {
        if (conn.code) await leaveRoom(conn);

        const code = String(message.code ?? "").trim().toUpperCase();
        const token = String(message.token ?? "");
        const result = await options.store.resume(code, token);

        if (result.kind === "missing") {
          conn.send({ type: "error", message: "존재하지 않는 방 코드예요" });
          return;
        }
        if (result.kind === "invalid") {
          conn.send({
            type: "error",
            message: "재접속할 수 없어요. 방을 다시 만들거나 참여해주세요",
          });
          return;
        }

        conn.code = code;
        conn.mark = result.mark;
        conn.send({ type: "welcome", code, you: result.mark, token });
        await publish(code, null, result.snapshot.state);
        options.log?.(`[room] ${code} 재접속 (${result.mark})`);
        break;
      }

      case "move": {
        if (!conn.code || !conn.mark) {
          conn.send({ type: "error", message: "방에 참여한 뒤에 둘 수 있어요" });
          return;
        }
        // 서버 권위 판정: 진행 중이면서, 자신의 차례일 때만 허용한다.
        const result = await options.store.move(conn.code, conn.mark, Number(message.index));
        if (result.kind === "missing") {
          conn.send({ type: "error", message: "방이 사라졌어요" });
          return;
        }
        if (result.kind === "invalid") {
          conn.send({ type: "error", message: "지금은 그 칸에 둘 수 없어요" });
          return;
        }
        await publish(result.snapshot.code, result.event, result.snapshot.state);
        break;
      }

      case "rematch": {
        if (!conn.code || !conn.mark) {
          conn.send({ type: "error", message: "플레이어만 리매치를 요청할 수 있어요" });
          return;
        }
        const result = await options.store.rematch(conn.code, conn.mark);
        if (result.kind !== "applied") return;
        await publish(conn.code, result.event, result.snapshot.state, result.swap);
        break;
      }

      case "leave": {
        await leaveRoom(conn);
        break;
      }

      default:
        conn.send({ type: "error", message: "알 수 없는 요청이에요" });
    }
  }

  return { attach, ready };
}
