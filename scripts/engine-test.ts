/**
 * 온라인 회전+중력 엔진 단위 테스트 — `npx tsx scripts/engine-test.ts` 로 실행.
 */
import {
  applyGravity,
  applyOnlineMove,
  createOnlineState,
  getOnlineWinner,
  resetOnlineState,
  rotateOnlineBoard,
  type OnlineState,
} from "../src/lib/tic-tac-toe";

let passed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.error(`  ✗ ${label}`);
  }
}

function playingState(): OnlineState {
  return { ...createOnlineState(), status: "playing" };
}

function move(state: OnlineState, index: number, dir?: -1 | 1) {
  const outcome = applyOnlineMove(state, index, dir);
  if (!outcome) throw new Error(`move(${index}) 가 규칙 위반으로 거부됨`);
  return outcome;
}

function idsOf(board: ReturnType<typeof createOnlineState>["board"]) {
  return board.filter(Boolean).map((c) => c!.id).sort();
}

function isSettled(board: ReturnType<typeof createOnlineState>["board"]) {
  // 모든 말 아래(같은 열)는 바닥이거나 다른 말이어야 한다
  for (let i = 0; i < 9; i++) {
    if (board[i] === null) continue;
    if (i + 3 < 9 && board[i + 3] === null) return false;
  }
  return true;
}

console.log("1) 회전 매핑 검증");
{
  const board = createOnlineState().board;
  board[0] = { id: "a", player: "X" };
  board[4] = { id: "b", player: "O" };
  board[8] = { id: "c", player: "X" };

  const cw = rotateOnlineBoard(board, 1);
  assert(cw[2]?.id === "a", "시계 회전: (0,0) → (0,2)");
  assert(cw[4]?.id === "b", "시계 회전: 중앙은 제자리");
  assert(cw[6]?.id === "c", "시계 회전: (2,2) → (2,0)");

  const ccw = rotateOnlineBoard(board, -1);
  assert(ccw[6]?.id === "a", "반시계 회전: (0,0) → (2,0)");
  assert(ccw[2]?.id === "c", "반시계 회전: (2,2) → (0,2)");
}

console.log("2) 중력 검증");
{
  const board = createOnlineState().board;
  board[0] = { id: "o", player: "O" }; // (0,0)
  board[3] = { id: "x1", player: "X" }; // (1,0)
  board[1] = { id: "x2", player: "X" }; // (0,1)
  board[5] = { id: "x3", player: "X" }; // (1,2)

  assert(getOnlineWinner(board) === null, "중력 적용 전에는 승부 없음");

  const settled = applyGravity(board);
  assert(settled[3]?.id === "o", "0열: O가 (1,0)으로 한 칸 낙하");
  assert(settled[6]?.id === "x1", "0열: X는 바닥 유지 (순서 보존)");
  assert(settled[7]?.id === "x2", "1열: X가 바닥으로 낙하");
  assert(settled[8]?.id === "x3", "2열: X가 바닥으로 낙하");
  assert(settled[0] === null && settled[1] === null && settled[2] === null, "윗칸 비움");

  // 중력으로 X 바닥 줄 완성 → 새 승리!
  const winner = getOnlineWinner(settled);
  assert(
    winner?.player === "X" && JSON.stringify(winner.line) === JSON.stringify([6, 7, 8]),
    "중력 덕에 X가 6,7,8 바닥 줄 완성 → X 승리",
  );
}

console.log("3) 회전+중력 8수 시나리오 (고정 dir)");
{
  let state = playingState();
  state = move(state, 4, 1).state; // X 중앙
  state = move(state, 0, 1).state; // O (0,0) → 회전+중력
  assert(state.rotations === 1, "첫 회전 기록");
  assert(
    state.board[7]?.player === "X" && state.board[8]?.player === "O" &&
      state.board[4] === null && state.board[0] === null,
    "1차 회전+중력: 중앙 X@4 → X@7 낙하, O@0 → O@8 낙하",
  );
  state = move(state, 3, 1).state; // X (1,0)
  state = move(state, 2, 1).state; // O (0,2) → 회전+중력
  assert(
    JSON.stringify(state.board.map((c) => c?.player ?? null)) ===
      JSON.stringify([null, null, null, "X", null, null, "O", "X", "O"]),
    `2차 회전 후 배치: X@3, X@7, O@6, O@8 (got ${state.board.map((c) => c?.player ?? "-").join("")})`,
  );
  state = move(state, 5, 1).state; // X (1,2)
  state = move(state, 1, 1).state; // O (0,1) → 회전+중력
  assert(state.rotations === 3, "6수째 회전까지 총 3회");
  assert(
    JSON.stringify(state.board.map((c) => c?.player ?? null)) ===
      JSON.stringify(["O", null, null, "X", "X", null, "O", "X", "O"]),
    `3차 회전 후 배치 (got ${state.board.map((c) => c?.player ?? "-").join("")})`,
  );

  const outcome = move(state, 1); // X가 (0,1)에 두면 1열 완성
  assert(
    outcome.state.result?.type === "win" &&
      outcome.state.result.player === "X" &&
      JSON.stringify(outcome.state.result.line) === JSON.stringify([1, 4, 7]),
    "X가 1,4,7 세로 라인으로 승리",
  );
  assert(outcome.rotated === false && outcome.state.status === "ended", "홀수 수엔 회전 없이 종료");
}

console.log("4) 규칙 위반 거부");
{
  let state = playingState();
  state = move(state, 4).state;
  assert(applyOnlineMove(state, 4) === null, "이미 찬 칸 거부");
  assert(applyOnlineMove(state, 9) === null, "범위 밖 거부");
  assert(applyOnlineMove(state, -1) === null, "음수 거부");
  assert(applyOnlineMove(state, 1.5) === null, "정수 아님 거부");
  const ended = { ...state, status: "ended" as const };
  assert(applyOnlineMove(ended, 0) === null, "종료된 게임 거부");
}

console.log("5) 무작위 게임 시뮬레이션 (150판)");
{
  let wins = 0;
  let draws = 0;
  let gravityWins = 0;
  let maxTurns = 0;

  for (let game = 0; game < 150; game++) {
    let state = playingState();
    let guard = 0;
    while (state.status === "playing" && guard++ < 20) {
      const empty = state.board
        .map((cell, i) => (cell === null ? i : -1))
        .filter((i) => i >= 0);
      const index = empty[Math.floor(Math.random() * empty.length)];
      const outcome = move(state, index); // 서버와 동일: dir 미지정 → 랜덤
      state = outcome.state;
      // 회전이 일어난 직후에는 반드시 말이 바닥에 안착해 있어야 한다
      if (outcome.rotated) {
        assert(isSettled(state.board), `게임 ${game + 1}: 회전 후 말 안착`);
        if (state.result?.type === "win") gravityWins++;
      }
    }
    if (state.result?.type === "win") wins++;
    else if (state.result?.type === "draw") draws++;
    maxTurns = Math.max(maxTurns, state.turnCount);
  }

  assert(wins + draws === 150, `모든 게임 종료 (승 ${wins} / 무 ${draws})`);
  assert(maxTurns <= 9, `수 제한 준수 (최대 ${maxTurns}수)`);
  assert(gravityWins > 0, `회전+중력으로 승부가 뒤집힌 게임 ${gravityWins}판 존재`);
}

console.log("6) 리매치 초기화");
{
  let state = playingState();
  state = move(state, 0).state;
  state = move(state, 3).state;
  const reset = resetOnlineState(state);
  assert(reset.board.every((cell) => cell === null), "보드 초기화");
  assert(reset.midBoard === null, "midBoard 초기화");
  assert(reset.turnCount === 0 && reset.rotations === state.rotations, "turnCount 초기화, rotations 누적 유지");
  assert(reset.status === "waiting" && reset.current === "X", "대기 상태로 초기화");
}

console.log(`\n${passed}개 통과, ${failures.length}개 실패`);
if (failures.length > 0) {
  console.error("실패:", failures.join(" | "));
  process.exit(1);
}
