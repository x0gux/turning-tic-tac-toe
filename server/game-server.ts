import { createServer, type Server } from "node:http";
import { randomInt } from "node:crypto";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import {
  applyOnlineMove,
  createOnlineState,
  resetOnlineState,
  type ClientMessage,
  type OnlineEvent,
  type OnlineState,
  type Player,
  type ServerMessage,
} from "../src/lib/tic-tac-toe";

const dev = process.env.NODE_ENV !== "production";

/* ------------------------------- 방 모델 ------------------------------- */

type Conn = {
  ws: WebSocket;
  room: Room | null;
  alive: boolean;
};

type Room = {
  code: string;
  /** 접속 중인 두 플레이어의 소켓 → 마크 매핑 (관전자는 spectators로) */
  marks: Map<Conn, Player>;
  spectators: Set<Conn>;
  state: OnlineState;
};

const rooms = new Map<string, Room>();
const conns = new Set<Conn>();

/** 혼동하기 쉬운 문자(I, O, 0, 1)를 제외한 방 코드 알파벳 */
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateRoomCode(): string {
  for (;;) {
    let code = "";
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS[randomInt(CODE_CHARS.length)];
    }
    if (!rooms.has(code)) return code;
  }
}

function send(conn: Conn, message: ServerMessage) {
  if (conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(JSON.stringify(message));
  }
}

function broadcast(room: Room, event: OnlineEvent | null) {
  for (const conn of [...room.marks.keys(), ...room.spectators]) {
    send(conn, {
      type: "state",
      event,
      state: room.state,
      you: room.marks.get(conn) ?? null,
    });
  }
}

function setConnected(state: OnlineState, mark: Player, value: boolean): OnlineState {
  const connected =
    mark === "X"
      ? { ...state.connected, X: value }
      : { ...state.connected, O: value };
  return { ...state, connected };
}

function removeFromRoom(conn: Conn) {
  const room = conn.room;
  if (!room) return;
  conn.room = null;

  const mark = room.marks.get(conn);
  if (mark) {
    room.marks.delete(conn);
    room.state = setConnected(room.state, mark, false);

    if (room.state.status === "playing") {
      // 대기 중이 아니라 진행 중이었다면 라운드를 종료 처리한다.
      room.state = { ...room.state, status: "ended" };
      broadcast(room, "opponent-left");
    } else {
      broadcast(room, null);
    }
  } else {
    room.spectators.delete(conn);
  }

  // 플레이어가 하나도 없으면 방을 정리한다.
  if (room.marks.size === 0) rooms.delete(room.code);
}

/* ----------------------------- 메시지 처리 ----------------------------- */

function handleMessage(conn: Conn, message: ClientMessage) {
  switch (message.type) {
    case "create": {
      if (conn.room) removeFromRoom(conn);

      const code = generateRoomCode();
      const room: Room = {
        code,
        marks: new Map(),
        spectators: new Set(),
        state: setConnected(createOnlineState(), "X", true),
      };
      rooms.set(code, room);
      conn.room = room;
      room.marks.set(conn, "X");

      send(conn, { type: "welcome", code, you: "X" });
      broadcast(room, "created");
      console.log(`[room] ${code} 생성됨`);
      break;
    }

    case "join": {
      if (conn.room) removeFromRoom(conn);

      const code = String(message.code ?? "")
        .trim()
        .toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        send(conn, { type: "error", message: "존재하지 않는 방 코드예요" });
        return;
      }

      conn.room = room;
      const taken = new Set(room.marks.values());

      if (!taken.has("X")) {
        room.marks.set(conn, "X");
      } else if (!taken.has("O")) {
        room.marks.set(conn, "O");
      } else {
        room.spectators.add(conn);
        send(conn, { type: "welcome", code, you: null });
        send(conn, { type: "notice", text: "인원이 꽉 차 관전자로 참여했어요" });
        broadcast(room, null);
        return;
      }

      const mark = room.marks.get(conn) as Player;
      room.state = setConnected(room.state, mark, true);

      let event: OnlineEvent | null = null;
      if (room.marks.size === 2 && room.state.status === "waiting") {
        room.state = { ...room.state, status: "playing" };
        event = "started";
      }

      send(conn, { type: "welcome", code, you: mark });
      broadcast(room, event);
      console.log(`[room] ${code} 참여 (${mark})`);
      break;
    }

    case "move": {
      const room = conn.room;
      const mark = room?.marks.get(conn);
      if (!room || !mark) {
        send(conn, { type: "error", message: "방에 참여한 뒤에 둘 수 있어요" });
        return;
      }
      // 서버 권위 판정: 진행 중이면서, 자신의 차례일 때만 허용한다.
      if (room.state.status !== "playing" || room.state.current !== mark) {
        send(conn, { type: "error", message: "지금은 그 칸에 둘 수 없어요" });
        return;
      }

      const outcome = applyOnlineMove(room.state, Number(message.index));
      if (!outcome) {
        send(conn, { type: "error", message: "지금은 그 칸에 둘 수 없어요" });
        return;
      }

      room.state = outcome.state;
      const event: OnlineEvent = outcome.rotated
        ? "rotated"
        : outcome.state.result
          ? "ended"
          : "moved";
      broadcast(room, event);
      break;
    }

    case "rematch": {
      const room = conn.room;
      const mark = room?.marks.get(conn);
      if (!room || !mark) {
        send(conn, { type: "error", message: "플레이어만 리매치를 요청할 수 있어요" });
        return;
      }
      if (room.state.status !== "ended" || room.state.rematch[mark]) return;

      const rematch =
        mark === "X"
          ? { ...room.state.rematch, X: true }
          : { ...room.state.rematch, O: true };
      room.state = { ...room.state, rematch };

      if (rematch.X && rematch.O) {
        // 양쪽 모두 수락하면 마크를 서로 바꾸고 새 라운드를 시작한다.
        room.marks = new Map(
          [...room.marks.entries()].map(([c, m]) => [c, m === "X" ? ("O" as Player) : ("X" as Player)]),
        );
        room.state = {
          ...resetOnlineState(room.state),
          connected: room.state.connected,
          status: "playing",
        };
        broadcast(room, "rematch");
      } else {
        broadcast(room, null);
      }
      break;
    }

    default:
      send(conn, { type: "error", message: "알 수 없는 요청이에요" });
  }
}

/* ------------------------------- 서버 시작 ------------------------------ */

async function main() {
  const app = next({ dev });
  const handle = app.getRequestHandler();
  await app.prepare();
  const upgradeHandler = app.getUpgradeHandler();

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  wss.on("connection", (ws: WebSocket) => {
    const conn: Conn = { ws, room: null, alive: true };
    conns.add(conn);

    ws.on("pong", () => {
      conn.alive = true;
    });

    ws.on("message", (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        send(conn, { type: "error", message: "잘못된 요청이에요" });
        return;
      }
      try {
        handleMessage(conn, message);
      } catch (error) {
        console.error("[error] 메시지 처리 실패:", error);
        send(conn, { type: "error", message: "서버 오류가 발생했어요" });
      }
    });

    ws.on("close", () => {
      conns.delete(conn);
      removeFromRoom(conn);
    });

    ws.on("error", () => {
      ws.close();
    });
  });

  // 30초마다 살아있는 연결인지 확인해 끊긴 소켓을 정리한다.
  const heartbeat = setInterval(() => {
    for (const conn of conns) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }, 30_000);
  heartbeat.unref();

  const server: Server = createServer((req, res) => {
    handle(req, res);
  });

  // /ws 는 게임 서버가, 나머지(HMR 등)는 Next.js가 처리한다.
  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } else {
      upgradeHandler(req, socket, head);
    }
  });

  const basePort = Number.parseInt(process.env.PORT ?? "3000", 10);

  // 포트가 사용 중이면 next dev처럼 다음 포트를 시도한다.
  for (let port = basePort; port < basePort + 10; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
          server.removeListener("error", onError);
          reject(err);
        };
        server.once("error", onError);
        server.listen(port, () => {
          server.removeListener("error", onError);
          resolve();
        });
      });
      console.log(
        `> 틱택토 서버 준비 완료: http://localhost:${port} (웹소켓: ws://localhost:${port}/ws) [${dev ? "dev" : "production"}]`,
      );
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE") throw error;
      console.log(`> 포트 ${port} 사용 중, 다음 포트를 시도합니다…`);
    }
  }
  throw new Error(`포트 ${basePort}~${basePort + 9}가 모두 사용 중입니다.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
