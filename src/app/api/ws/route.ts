/**
 * 온라인 대전 WebSocket 엔드포인트 (Vercel Functions).
 *
 * Vercel은 커스텀 Node 서버를 실행하지 못하므로, WS 로직은 이 route handler가 맡는다.
 * 방 상태는 Redis에 두고 여러 함수 인스턴스가 pub/sub으로 동기화한다.
 * 연결은 함수 최대 실행 시간(maxDuration)에 도달하면 끊기며,
 * 클라이언트는 토큰으로 자동 재접속한다.
 */
import { connection } from "next/server";
import { upgradeWebSocket } from "@vercel/functions";
import type { WebSocket } from "ws";
import { createRedisBus, createRedisClient, createRedisStore } from "@/lib/online/redis";
import { createOnlineServer, type OnlineServer } from "@/lib/online/server";

/** 무료(Hobby) 플랜 최대치. Pro 이상은 800까지 올릴 수 있다. */
export const maxDuration = 300;

// 함수 인스턴스가 살아 있는 동안 서버·Redis 연결을 재사용한다.
let onlinePromise: Promise<OnlineServer> | null = null;

function getOnlineServer(): Promise<OnlineServer> {
  onlinePromise ??= (async () => {
    const client = createRedisClient();
    client.on("error", (error) => {
      console.error("[error] Redis 연결 오류:", error.message);
    });
    const server = createOnlineServer({
      store: createRedisStore(client),
      bus: createRedisBus(client),
      log: (line) => console.log(line),
    });
    // pub/sub 구독이 잡힌 뒤에 브로드캐스트를 받도록 보장한다.
    await server.ready;
    return server;
  })();
  return onlinePromise;
}

export async function GET() {
  // cacheComponents 환경에서 이 route는 빌드 타임 prerender 대상이 아니다 —
  // 웹소켓 업그레이드는 반드시 실제 요청 시점에 실행돼야 한다.
  await connection();

  let server: OnlineServer;
  try {
    server = await getOnlineServer();
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "게임 서버 초기화에 실패했어요",
      { status: 503 },
    );
  }

  return upgradeWebSocket(
    (ws: WebSocket) => {
      server.attach(ws);
    },
    { maxPayload: 16 * 1024 },
  );
}
