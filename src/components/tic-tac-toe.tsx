"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createEmptyBoard,
  getBestMove,
  getRandomMove,
  getWinner,
  isBoardFull,
  type Board,
  type Difficulty,
  type GameMode,
  type Player,
} from "@/lib/tic-tac-toe";
import { PLAYER_STYLES } from "@/components/player-styles";
import { Segmented } from "@/components/segmented";

type Scores = { X: number; O: number; draw: number };

const INITIAL_SCORES: Scores = { X: 0, O: 0, draw: 0 };

export default function TicTacToe() {
  const [board, setBoard] = useState<Board>(createEmptyBoard);
  const [current, setCurrent] = useState<Player>("X");
  const [mode, setMode] = useState<GameMode>("ai");
  const [difficulty, setDifficulty] = useState<Difficulty>("hard");
  const [scores, setScores] = useState<Scores>(INITIAL_SCORES);

  const result = useMemo(() => getWinner(board), [board]);
  const isDraw = !result && isBoardFull(board);
  const gameOver = result !== null || isDraw;
  const isAiTurn = mode === "ai" && current === "O";

  // 라운드가 끝나면 스코어를 기록한다.
  useEffect(() => {
    if (result) {
      const winner = result.player;
      setScores((prev) =>
        winner === "X" ? { ...prev, X: prev.X + 1 } : { ...prev, O: prev.O + 1 },
      );
    } else if (isDraw) {
      setScores((prev) => ({ ...prev, draw: prev.draw + 1 }));
    }
  }, [result, isDraw]);

  // 컴퓨터 차례: 잠시 뒤에 수를 둔다.
  useEffect(() => {
    if (mode !== "ai" || current !== "O" || gameOver) return;

    const timer = setTimeout(() => {
      const move =
        difficulty === "easy" ? getRandomMove(board) : getBestMove(board, "O");
      if (move === -1) return;

      setBoard((prev) => {
        if (prev[move] !== null) return prev;
        const next = prev.slice();
        next[move] = "O";
        return next;
      });
      setCurrent("X");
    }, 500);

    return () => clearTimeout(timer);
  }, [board, current, mode, difficulty, gameOver]);

  function play(index: number) {
    if (board[index] !== null || gameOver || isAiTurn) return;

    setBoard((prev) => {
      const next = prev.slice();
      next[index] = current;
      return next;
    });
    setCurrent((prev) => (prev === "X" ? "O" : "X"));
  }

  function resetRound() {
    setBoard(createEmptyBoard());
    setCurrent("X");
  }

  function handleModeChange(nextMode: GameMode) {
    setMode(nextMode);
    setScores(INITIAL_SCORES);
    resetRound();
  }

  function handleDifficultyChange(nextDifficulty: Difficulty) {
    setDifficulty(nextDifficulty);
    resetRound();
  }

  const status = result
    ? mode === "ai"
      ? result.player === "X"
        ? "🎉 승리했습니다!"
        : "😢 컴퓨터가 이겼어요"
      : `🎉 ${result.player} 승리!`
    : isDraw
      ? "🤝 무승부입니다"
      : isAiTurn
        ? "컴퓨터가 생각 중…"
        : mode === "ai"
          ? "당신 차례 — X"
          : `${current} 차례`;

  const playerLabels = {
    X: mode === "ai" ? "나 (X)" : "X",
    O: mode === "ai" ? "컴퓨터 (O)" : "O",
    draw: "무승부",
  } as const;

  return (
    <section className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 sm:p-8">
      <header className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          틱택토
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          가로, 세로, 대각선으로 3칸을 먼저 완성하세요!
        </p>
      </header>

      <div className="mt-6 flex items-center justify-center gap-6">
        <Segmented
          label="모드"
          value={mode}
          onChange={handleModeChange}
          options={[
            { value: "ai", label: "컴퓨터" },
            { value: "pvp", label: "2인 대전" },
          ]}
        />
        {mode === "ai" && (
          <Segmented
            label="난이도"
            value={difficulty}
            onChange={handleDifficultyChange}
            options={[
              { value: "easy", label: "쉬움" },
              { value: "hard", label: "어려움" },
            ]}
          />
        )}
      </div>

      <dl className="mt-6 grid grid-cols-3 gap-2 text-center">
        <ScoreCard label={playerLabels.X} value={scores.X} accent="text-sky-500 dark:text-sky-400" />
        <ScoreCard label={playerLabels.draw} value={scores.draw} accent="text-zinc-400" />
        <ScoreCard label={playerLabels.O} value={scores.O} accent="text-rose-500 dark:text-rose-400" />
      </dl>

      <p
        aria-live="polite"
        className="mt-6 h-6 text-center text-base font-medium text-zinc-700 dark:text-zinc-200"
      >
        {status}
      </p>

      <div
        role="grid"
        aria-label="틱택토 보드"
        className="mx-auto mt-3 grid w-full max-w-80 grid-cols-3 gap-2"
      >
        {board.map((cell, index) => {
          const isWinning = result?.line.includes(index) ?? false;
          const dimmed = result !== null && !isWinning;
          const showPreview = cell === null && !gameOver && !isAiTurn;

          return (
            <button
              key={index}
              type="button"
              role="gridcell"
              onClick={() => play(index)}
              disabled={cell !== null || gameOver || isAiTurn}
              aria-label={`${
                ["1행 1열", "1행 2열", "1행 3열", "2행 1열", "2행 2열", "2행 3열", "3행 1열", "3행 2열", "3행 3열"][index]
              }, ${cell ?? "빈 칸"}`}
              className={`group/cell flex aspect-square items-center justify-center rounded-xl bg-zinc-100 text-4xl font-bold transition-all dark:bg-zinc-800 sm:text-5xl ${
                isWinning && result
                  ? PLAYER_STYLES[result.player].win
                  : "hover:bg-zinc-200/80 dark:hover:bg-zinc-700/80"
              } ${dimmed ? "opacity-40" : ""} disabled:cursor-default`}
            >
              {cell ? (
                <span className={PLAYER_STYLES[cell].mark}>{cell}</span>
              ) : showPreview ? (
                <span
                  className={`opacity-0 transition-opacity group-hover/cell:opacity-25 ${PLAYER_STYLES[current].mark}`}
                >
                  {current}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={resetRound}
          className="flex h-10 items-center justify-center rounded-full bg-zinc-900 px-6 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {gameOver ? "새 라운드 시작" : "보드 초기화"}
        </button>
        <button
          type="button"
          onClick={() => setScores(INITIAL_SCORES)}
          className="text-xs text-zinc-400 underline underline-offset-2 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          스코어 초기화
        </button>
      </div>
    </section>
  );
}

function ScoreCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-xl bg-zinc-50 px-2 py-3 dark:bg-zinc-800/60">
      <dt className="truncate text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className={`text-2xl font-bold ${accent}`}>{value}</dd>
    </div>
  );
}
