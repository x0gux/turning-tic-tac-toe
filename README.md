# 틱택토 배틀

친구와 실시간으로 대결하는 틱택토. 두 수를 둘 때마다 판이 회전하고 말이 중력에 이끌려 쏟아져요.

- ⚡ 방 만들기 / 4자리 코드로 참여 / 만석이면 관전
- 🔄 두 수마다 랜덤 ±90° 회전 + 중력 — 회전 후 새 라인이 만들어지면 그대로 승부
- 🔁 리매치 시 X/O 자리 교대
- 📱 서버 권위 판정: 자기 차례가 아니면 서버가 거부
- 🔌 끊겨도 안전: 연결이 끊기면 토큰으로 자동 재접속 (새로고침 포함, 60초 유예)

## 로컬 개발

```bash
npm install
npm run dev
```

http://localhost:3000 에서 실행됩니다. 로컬 서버는 방 상태를 메모리에 두고
(`src/lib/online/memory.ts`) Redis가 없어도 동작해요.

프로덕션 빌드를 로컬에서 확인하려면:

```bash
npm run build
npm start   # http://localhost:3000 (사용 중이면 다음 포트)
```

## Vercel 배포

Vercel Functions는 2026년부터 WebSocket을 지원합니다 (Fluid compute 필요).
이 프로젝트는 그에 맞춰 구성돼 있어요:

| 환경 | WebSocket 엔드포인트 | 방 상태 저장소 |
| --- | --- | --- |
| 로컬 dev | `ws://localhost:3000/ws` (커스텀 서버) | 프로세스 메모리 |
| Vercel | `wss://<도메인>/api/ws` (route handler) | Redis + pub/sub |

배포 순서:

1. GitHub에 푸시하고 Vercel에서 프로젝트를 Import 합니다.
2. 프로젝트 **Storage** 탭에서 **Redis**(Upstash, Marketplace)를 추가합니다.
   `REDIS_URL` 환경변수가 자동으로 주입돼요.
3. 함수가 **Fluid Compute**를 쓰는지 확인합니다 (2025-04-23 이후 만든 프로젝트는 기본 켜짐).
4. 배포합니다. 끝!

### 환경변수

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `REDIS_URL` | Vercel에서 필수 | Marketplace Redis 추가 시 자동 주입 |
| `NEXT_PUBLIC_WS_URL` | 아니오 | WS 주소를 직접 지정할 때. 기본은 같은 도메인의 `/api/ws` |

### 동작 방식과 한계

- **함수 최대 실행 시간에 연결이 끊깁니다** (Hobby 300초, Pro 최대 800초).
  클라이언트는 지수 백오프로 자동 재접속하고, 방 상태는 Redis에 살아 있어
  게임 도중에 끊겨도 자리와 보드가 그대로 복구돼요.
- 끊긴 플레이어는 60초간 유예됩니다 (`src/lib/online/server.ts`의
  `DEFAULT_AWAY_GRACE_MS`). 유예가 지나면 라운드가 종료 처리돼요.
- 방 데이터는 2시간 TTL로 자동 청소됩니다.

## 구조

```
src/lib/tic-tac-toe.ts        게임 엔진 + 온라인 프로토콜 타입 (서버/클라이언트 공유)
src/lib/online/
  room.ts                     방 상태 전이 규칙 (순수 함수)
  server.ts                   연결 처리기 공유 코어 (로컬/Vercel 공용)
  memory.ts                   메모리 저장소/버스 (로컬 개발)
  redis.ts                    Redis 저장소/버스 (Vercel, WATCH/MULTI + pub/sub)
src/app/api/ws/route.ts       Vercel WebSocket 엔드포인트
server/game-server.ts         로컬 개발 서버 (Next.js + ws를 한 프로세스로)
src/hooks/use-online-game.ts  클라이언트 훅 (재접속, 세션 토큰)
```

## 테스트

```bash
npx tsx scripts/engine-test.ts   # 회전+중력 엔진 단위 테스트
npm run lint
npx tsc --noEmit
```
