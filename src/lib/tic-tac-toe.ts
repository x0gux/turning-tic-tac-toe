export type Player = "X" | "O";
export type Cell = Player | null;
export type Board = Cell[];
export type GameMode = "pvp" | "ai";
export type Difficulty = "easy" | "hard";
export type GameResult = {
  player: Player;
  line: readonly [number, number, number];
};

const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], // 가로
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6], // 세로
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8], // 대각선
  [2, 4, 6],
];

export function createEmptyBoard(): Board {
  return Array(9).fill(null);
}

export function getWinner(board: Board): GameResult | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    const cell = board[a];
    if (cell && cell === board[b] && cell === board[c]) {
      return { player: cell, line };
    }
  }
  return null;
}

export function isBoardFull(board: readonly unknown[]): boolean {
  return board.every((cell) => cell !== null);
}

export function getEmptyCells(board: Board): number[] {
  return board.reduce<number[]>(
    (acc, cell, index) => (cell === null ? [...acc, index] : acc),
    [],
  );
}

/** 무작위 수 (쉬움 난이도용) */
export function getRandomMove(board: Board): number {
  const empty = getEmptyCells(board);
  if (empty.length === 0) return -1;
  return empty[Math.floor(Math.random() * empty.length)];
}

/**
 * 미니맥스로 완전히 최적의 수를 찾는다.
 * 동점인 최선의 수가 여러 개면 무작위로 골라 항상 같은 수만 두지 않게 한다.
 */
export function getBestMove(board: Board, ai: Player): number {
  const opponent: Player = ai === "X" ? "O" : "X";
  let bestScore = -Infinity;
  let bestMoves: number[] = [];

  for (const index of getEmptyCells(board)) {
    const next = board.slice();
    next[index] = ai;
    const score = minimax(next, ai, opponent, opponent);
    if (score > bestScore) {
      bestScore = score;
      bestMoves = [index];
    } else if (score === bestScore) {
      bestMoves.push(index);
    }
  }

  if (bestMoves.length === 0) return -1;
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

function minimax(
  board: Board,
  ai: Player,
  human: Player,
  turn: Player,
): number {
  const winner = getWinner(board);
  if (winner) return winner.player === ai ? 1 : -1;

  const empty = getEmptyCells(board);
  if (empty.length === 0) return 0; // 무승부

  const isMaximizing = turn === ai;
  let bestScore = isMaximizing ? -Infinity : Infinity;

  for (const index of empty) {
    const next = board.slice();
    next[index] = turn;
    const score = minimax(next, ai, human, turn === ai ? human : ai);
    bestScore = isMaximizing
      ? Math.max(bestScore, score)
      : Math.min(bestScore, score);
  }

  return bestScore;
}

/* ------------------------------------------------------------------ */
/* 온라인 대전: 회전 보드 엔진 (서버와 클라이언트가 함께 사용)           */
/* ------------------------------------------------------------------ */

/** 말은 고유 id를 가진다. 회전해도 id가 유지되어 클라이언트가 이동을 애니메이션할 수 있다. */
export type OnlineCell = { id: string; player: Player };
export type OnlineBoard = (OnlineCell | null)[];

export type OnlineResult =
  | { type: "win"; player: Player; line: number[] }
  | { type: "draw" }
  | null;

export type OnlineStatus = "waiting" | "playing" | "ended";

export type OnlineState = {
  status: OnlineStatus;
  board: OnlineBoard;
  current: Player;
  /** 지금까지 둔 수 (양쪽 합계). 2수마다 회전한다. */
  turnCount: number;
  /** 누적 회전 횟수 (애니메이션 이벤트 키로 사용) */
  rotations: number;
  lastDir: -1 | 1 | null;
  /** 마지막 회전 직후(중력 적용 전) 보드 — 클라이언트 2단 애니메이션용 */
  midBoard: OnlineBoard | null;
  result: OnlineResult;
  rematch: Record<Player, boolean>;
  connected: Record<Player, boolean>;
};

/** 서버가 방 상태가 바뀔 때마다 알려주는 이벤트 종류 */
export type OnlineEvent =
  | "created"
  | "started"
  | "moved"
  | "rotated"
  | "ended"
  | "rematch"
  | "opponent-left";

export type ClientMessage =
  | { type: "create" }
  | { type: "join"; code: string }
  | { type: "resume"; code: string; token: string }
  | { type: "move"; index: number }
  | { type: "rematch" }
  | { type: "leave" };

export type ServerMessage =
  | { type: "welcome"; code: string; you: Player | null; token: string | null }
  | { type: "state"; event: OnlineEvent | null; state: OnlineState; you: Player | null }
  | { type: "notice"; text: string }
  | { type: "error"; message: string };

export const ROTATE_EVERY = 2;

export function createOnlineState(): OnlineState {
  return {
    status: "waiting",
    board: Array(9).fill(null),
    current: "X",
    turnCount: 0,
    rotations: 0,
    lastDir: null,
    midBoard: null,
    result: null,
    rematch: { X: false, O: false },
    connected: { X: false, O: false },
  };
}

/** 리매치: 보드·결과는 초기화하되 rotations 카운터는 유지한다. */
export function resetOnlineState(prev: OnlineState): OnlineState {
  return { ...createOnlineState(), rotations: prev.rotations };
}

export function getOnlineWinner(
  board: OnlineBoard,
): { player: Player; line: number[] } | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    const cell = board[a];
    if (
      cell &&
      board[b]?.player === cell.player &&
      board[c]?.player === cell.player
    ) {
      return { player: cell.player, line: [...line] };
    }
  }
  return null;
}

/**
 * 보드를 90° 회전한다. 말은 id를 유지한 채 새 칸으로 "밀려난다".
 * dir = 1 (시계 방향):  old (r, c) → new (c, 2 - r)  →  new[r][c] = old[2 - c][r]
 * dir = -1 (반시계):    old (r, c) → new (2 - c, r)  →  new[r][c] = old[c][2 - r]
 */
export function rotateOnlineBoard(
  board: OnlineBoard,
  dir: -1 | 1,
): OnlineBoard {
  const rotated: OnlineBoard = Array(9).fill(null);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      rotated[r * 3 + c] =
        dir === 1 ? board[(2 - c) * 3 + r] : board[c * 3 + (2 - r)];
    }
  }
  return rotated;
}

/**
 * 중력: 각 열의 말들이 아래로 미끄러져 바닥부터 차곡차곡 쌓인다 (위→아래 순서 유지).
 * 회전만으로는 라인 시스템이 대칭이라 전략이 변하지 않지만,
 * 중력으로 말이 내려앉으며 가로/대각선 라인이 새로 만들어지거나 무너진다.
 */
export function applyGravity(board: OnlineBoard): OnlineBoard {
  const settled: OnlineBoard = Array(9).fill(null);
  for (let c = 0; c < 3; c++) {
    const column: OnlineCell[] = [];
    for (let r = 0; r < 3; r++) {
      const cell = board[r * 3 + c];
      if (cell) column.push(cell);
    }
    // 맨 아래 칸부터 채운다
    column.forEach((cell, i) => {
      settled[(3 - column.length + i) * 3 + c] = cell;
    });
  }
  return settled;
}

export type MoveOutcome = { state: OnlineState; rotated: boolean };

/**
 * 수를 두고 상태를 새로 만든다. 규칙 위반이면 null.
 * 두 수가 모두 놓일 때마다(짝수 turnCount) 판이 랜덤 ±90° 회전하고,
 * 이어서 중력이 적용되어 말들이 아래로 밀려난다.
 * 회전+중력 결과로 새 승리 라인이 만들어지면 그대로 승부가 난다.
 */
export function applyOnlineMove(
  state: OnlineState,
  index: number,
  dir?: -1 | 1,
): MoveOutcome | null {
  if (state.status !== "playing") return null;
  if (!Number.isInteger(index) || index < 0 || index > 8) return null;
  if (state.board[index] !== null) return null;

  const board: OnlineBoard = state.board.slice();
  board[index] = { id: crypto.randomUUID(), player: state.current };
  let next: OnlineState = {
    ...state,
    board,
    turnCount: state.turnCount + 1,
    midBoard: null,
  };

  const winner = getOnlineWinner(board);
  if (winner) {
    return {
      state: {
        ...next,
        status: "ended",
        result: { type: "win", player: winner.player, line: winner.line },
      },
      rotated: false,
    };
  }
  if (isBoardFull(board)) {
    return { state: { ...next, status: "ended", result: { type: "draw" } }, rotated: false };
  }

  // 두 수가 놓일 때마다 판이 회전하고, 말들이 중력에 이끌려 아래로 밀려난다.
  if (next.turnCount % ROTATE_EVERY === 0) {
    const rolled: -1 | 1 = dir ?? (Math.random() < 0.5 ? -1 : 1);
    const midBoard = rotateOnlineBoard(board, rolled);
    const settled = applyGravity(midBoard);
    next = {
      ...next,
      board: settled,
      midBoard,
      rotations: next.rotations + 1,
      lastDir: rolled,
    };

    const afterRotation = getOnlineWinner(settled);
    if (afterRotation) {
      return {
        state: {
          ...next,
          status: "ended",
          result: {
            type: "win",
            player: afterRotation.player,
            line: afterRotation.line,
          },
        },
        rotated: true,
      };
    }
  }

  return {
    state: { ...next, current: next.current === "X" ? "O" : "X" },
    rotated: next.rotations !== state.rotations,
  };
}
