/**
 * 로컬 개발용 서버. Next.js와 게임 WebSocket을 한 프로세스에서 띄운다.
 *
 * 방 로직은 src/lib/online/server.ts (공유 코어)에 있고,
 * 여기서는 메모리 저장소를 쓴다 — Redis 없이 `npm run dev`가 동작한다.
 * 배포(Vercel)에서는 src/app/api/ws/route.ts가 같은 코어를 Redis와 함께 쓴다.
 */
import { createServer, type Server } from "node:http";
import next from "next";
import { WebSocketServer, type WebSocket } from "ws";
import { createMemoryBus, createMemoryStore } from "../src/lib/online/memory";
import { createOnlineServer } from "../src/lib/online/server";

const dev = process.env.NODE_ENV !== "production";

/** 30초마다 살아있는 연결인지 확인해 끊긴 소켓을 정리한다. */
function startHeartbeat(sockets: Set<WebSocket>) {
  const alive = new WeakSet<WebSocket>();
  const heartbeat = setInterval(() => {
    for (const ws of sockets) {
      if (alive.has(ws)) {
        alive.delete(ws);
        ws.ping();
        continue;
      }
      ws.terminate();
      sockets.delete(ws);
    }
    for (const ws of sockets) {
      alive.add(ws);
    }
  }, 30_000);
  heartbeat.unref();
}

async function main() {
  const app = next({ dev });
  const handle = app.getRequestHandler();
  await app.prepare();
  const upgradeHandler = app.getUpgradeHandler();

  const online = createOnlineServer({
    store: createMemoryStore(),
    bus: createMemoryBus(),
    log: (line) => console.log(line),
  });
  await online.ready;

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const sockets = new Set<WebSocket>();

  wss.on("connection", (ws: WebSocket) => {
    sockets.add(ws);
    ws.on("close", () => {
      sockets.delete(ws);
    });
    online.attach(ws);
  });
  startHeartbeat(sockets);

  const server: Server = createServer((req, res) => {
    handle(req, res);
  });

  // /ws (로컬 개발)와 /api/ws (배포와 동일한 경로) 모두 게임 서버가 처리한다.
  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname === "/ws" || pathname === "/api/ws") {
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
