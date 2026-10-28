/**
 * 웹소켓 통합 스모크 테스트 — 서버를 띄운 뒤 실행.
 *   PORT=3300 npx tsx server/game-server.ts &
 *   node scripts/smoke-test.mjs 3300
 */
import WebSocket from "ws";

const PORT = process.argv[2] ?? "3000";
const URL = `ws://localhost:${PORT}/ws`;

let passed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.error(`  ✗ ${label}`);
  }
}

class TestClient {
  constructor(name, initMessage = null) {
    this.name = name;
    this.ws = new WebSocket(URL);
    this.queue = [];
    this.waiters = [];
    this.code = "";
    this.you = null;
    this.state = null;
    this.lastEvent = null;
    this.errors = [];

    this.ws.on("open", () => {
      if (initMessage) this.send(initMessage);
    });

    this.ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "welcome") {
        this.code = msg.code;
        this.you = msg.you;
      } else if (msg.type === "state") {
        this.state = msg.state;
        this.you = msg.you;
        this.lastEvent = msg.event;
      } else if (msg.type === "error") {
        this.errors.push(msg.message);
      }
      this.#dispatch(msg);
    });

    this.ws.on("close", () => this.#dispatch({ type: "__closed" }));
    this.ws.on("error", () => {});
  }

  #dispatch(msg) {
    const idx = this.waiters.findIndex((w) => w.predicate(msg));
    if (idx !== -1) {
      const [w] = this.waiters.splice(idx, 1);
      clearTimeout(w.timer);
      w.resolve(msg);
    } else {
      this.queue.push(msg);
    }
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }

  /** 조건에 맞는 메시지가 올 때까지 대기 (조건 불일치 메시지는 큐에 적립) */
  waitFor(label, predicate, timeoutMs = 3000) {
    const queuedIdx = this.queue.findIndex(predicate);
    if (queuedIdx !== -1) {
      const [msg] = this.queue.splice(queuedIdx, 1);
      return Promise.resolve(msg);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== entry);
        reject(new Error(`${this.name}: ${label} 대기 시간 초과`));
      }, timeoutMs);
      const entry = { predicate, resolve, timer };
      this.waiters.push(entry);
    });
  }

  waitState(label, predicate, timeoutMs = 3000) {
    return this.waitFor(
      label,
      (m) => m.type === "state" && (!predicate || predicate(m)),
      timeoutMs,
    );
  }

  /** 다음 수가 반영된 상태(turnCount 증가 또는 종료) 대기 */
  waitNextTurn(prevTurnCount) {
    return this.waitState(
      "다음 수",
      (m) => m.state.turnCount > prevTurnCount || m.state.status === "ended",
    );
  }

  close() {
    this.ws.close();
  }
}

function marksOf(state) {
  return state.board.map((cell, index) =>
    cell ? { id: cell.id, player: cell.player, index } : null,
  );
}

function firstEmpty(state) {
  return state.board.findIndex((cell) => cell === null);
}

const run = async () => {
  console.log("1) 방 생성 & 코드 참여");
  const A = new TestClient("A", { type: "create" });
  await A.waitState("created", (m) => m.event === "created");
  assert(A.you === "X", "방장은 X");
  assert(A.state.status === "waiting", "대기 상태");
  assert(/^[A-Z2-9]{4}$/.test(A.code), `방 코드 형식 (${A.code})`);

  const B = new TestClient("B", { type: "join", code: "ZZZZ" });
  await B.waitFor("없는 방 에러", (m) => m.type === "error");
  assert(B.errors.at(-1) === "존재하지 않는 방 코드예요", "잘못된 코드 에러 메시지");

  B.send({ type: "join", code: A.code });
  await B.waitState("started", (m) => m.event === "started");
  await A.waitState("A started", (m) => m.event === "started");
  assert(B.you === "O", "두 번째 참가자는 O");
  assert(B.state.status === "playing", "게임 시작");
  assert(A.state.connected.X && A.state.connected.O, "양쪽 접속 표시");

  console.log("2) 수 두기 & 규칙 위반");
  A.send({ type: "move", index: 4 });
  await A.waitNextTurn(0);
  await B.waitNextTurn(0);
  assert(A.state.board[4]?.player === "X" && A.state.current === "O", "중앙에 X 배치, O 차례");
  assert(B.state.board[4]?.player === "X", "B에게도 동일 상태 동기화");

  A.send({ type: "move", index: 0 }); // O 차례인데 A가 둠
  await A.waitFor("차례 위반 에러", (m) => m.type === "error");
  assert(A.errors.at(-1) === "지금은 그 칸에 둘 수 없어요", "차례 위반 거부");

  B.send({ type: "move", index: 4 }); // 이미 찬 칸
  await B.waitFor("중복 에러", (m) => m.type === "error");
  assert(B.errors.at(-1) === "지금은 그 칸에 둘 수 없어요", "중복 수 거부");

  console.log("3) 두 수째 회전+중력 — 말이 밀려남");
  const xId = A.state.board.find((c) => c !== null)?.id; // A가 둔 X 말의 id
  B.send({ type: "move", index: 0 });
  await A.waitState("회전", (m) => m.event === "rotated");
  const after = marksOf(A.state);
  assert(A.state.rotations === 1 && A.state.lastDir !== null, `회전 기록 (dir=${A.state.lastDir})`);
  assert(A.state.midBoard !== null, "중력 적용 전(mid) 보드 동봉 — 2단 애니메이션용");
  assert(after.filter(Boolean).length === 2, "말 2개 유지");
  const xAfter = after.find((m) => m !== null && m.id === xId);
  assert(xAfter !== undefined && xAfter.player === "X", "회전해도 기존 말(id) 보존");
  const xIdx = after.find((m) => m?.player === "X")?.index;
  const oIdx = after.find((m) => m?.player === "O")?.index;
  assert(
    xIdx === 7 && (oIdx === 6 || oIdx === 8),
    `말 이동+낙하: X@4→@${xIdx}, O@0→@${oIdx}`,
  );
  assert(
    after.every((m) => m === null || m.index + 3 >= 9 || A.state.board[m.index + 3] !== null),
    "중력 적용: 모든 말이 바닥에 안착",
  );
  await B.waitState("B 동기화", (m) => m.state.rotations === 1);
  assert(B.state.rotations === 1, "B도 회전 상태 수신");

  console.log("4) 게임 끝까지 진행");
  let rotationsDuringGame = 1;
  let guard = 0;
  while (A.state.status === "playing" && guard++ < 20) {
    const prevTurn = A.state.turnCount;
    const mover = A.state.current === A.you ? A : B;
    mover.send({ type: "move", index: firstEmpty(mover.state) });
    await A.waitNextTurn(prevTurn);
    await B.waitState("B 동기화", (m) => m.state.turnCount >= A.state.turnCount || m.state.status === "ended");
    rotationsDuringGame = Math.max(rotationsDuringGame, A.state.rotations);
  }
  assert(A.state.status === "ended", `게임 종료 (turnCount=${A.state.turnCount}, result=${JSON.stringify(A.state.result)})`);
  assert(A.state.turnCount === B.state.turnCount, "A/B 상태 일치");
  assert(rotationsDuringGame >= 1, `게임 중 회전 ${rotationsDuringGame}회`);

  console.log("5) 리매치 — 마크 교체");
  A.send({ type: "rematch" });
  await A.waitState("리매치 요청", (m) => m.state.rematch?.[A.you] === true || m.event === "rematch");
  if (A.state.status !== "playing") {
    B.send({ type: "rematch" });
    await A.waitState("리매치 시작", (m) => m.event === "rematch");
  }
  assert(A.state.status === "playing" && A.state.turnCount === 0, "새 라운드 시작");
  assert(A.state.board.every((c) => c === null), "보드 초기화");
  await B.waitState("B 리매치", (m) => m.event === "rematch");
  assert(A.you === "O" && B.you === "X", `마크 교체 (A=${A.you}, B=${B.you})`);

  console.log("6) 상대 끊김 처리");
  B.close();
  await A.waitState("상대 종료", (m) => m.event === "opponent-left");
  assert(
    A.state.status === "ended" &&
      A.state.connected[A.you] === true &&
      A.state.connected[B.you] === false,
    "상대 오프라인 표시 + 라운드 종료",
  );

  A.close();
  console.log(`\n${passed}개 통과, ${failures.length}개 실패`);
  if (failures.length > 0) {
    console.error("실패:", failures.join(" | "));
    process.exit(1);
  }
  process.exit(0);
};

run().catch((error) => {
  console.error("스모크 테스트 실패:", error.message);
  process.exit(1);
});
