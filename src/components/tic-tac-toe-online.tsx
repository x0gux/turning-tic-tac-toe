"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type {
  OnlineBoard,
  OnlineResult,
  Player,
} from "@/lib/tic-tac-toe";
import { ROTATE_EVERY } from "@/lib/tic-tac-toe";
import { useOnlineGame, type SpinEvent } from "@/hooks/use-online-game";
import { PLAYER_STYLES } from "@/components/player-styles";

export default function TicTacToeOnline() {
  const game = useOnlineGame();
  const [codeInput, setCodeInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [rotationToast, setRotationToast] = useState<string | null>(null);

  // 판 회전 이벤트가 오면 잠깐 안내 문구를 보여준다.
  useEffect(() => {
    if (!game.spin) return;
    setRotationToast(
      game.spin.dir === 1
        ? "🔄 판이 시계 방향으로 돌아 말이 쏟아졌어요!"
        : "🔄 판이 반시계 방향으로 돌아 말이 쏟아졌어요!",
    );
    const timer = window.setTimeout(() => setRotationToast(null), 2000);
    return () => window.clearTimeout(timer);
  }, [game.spin]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(game.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  /* --------------------------- 로비 (방 만들기/참여) --------------------------- */

  if (game.phase !== "in-room" && game.phase !== "reconnecting") {
    const connecting = game.phase === "connecting";
    return (
      <section className="flex w-full max-w-md flex-col items-center gap-7 rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 sm:p-8">
        <header className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            틱택토 배틀
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            친구와 실시간 대전! 두 수마다 판이 회전하고 말이 아래로 쏟아져요.
          </p>
        </header>

        <button
          type="button"
          onClick={game.createRoom}
          disabled={connecting}
          className="h-12 w-full rounded-full bg-zinc-900 text-base font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          ⚡ 방 만들기
        </button>

        <div className="flex w-full items-center gap-3 text-xs text-zinc-400">
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
          또는 코드로 참여
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
        </div>

        <form
          className="flex w-full gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (codeInput.length === 4) game.joinRoom(codeInput);
          }}
        >
          <input
            value={codeInput}
            onChange={(event) =>
              setCodeInput(
                event.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "")
                  .slice(0, 4),
              )
            }
            placeholder="ABCD"
            inputMode="text"
            autoCapitalize="characters"
            maxLength={4}
            disabled={connecting}
            aria-label="방 코드"
            className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-transparent px-3 py-2.5 text-center font-mono text-xl uppercase tracking-[0.35em] text-zinc-900 placeholder:text-zinc-300 focus:border-zinc-500 focus:outline-none disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100 dark:placeholder:text-zinc-600"
          />
          <button
            type="submit"
            disabled={connecting || codeInput.length !== 4}
            className="rounded-xl bg-zinc-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            참여하기
          </button>
        </form>

        {game.error && (
          <p className="text-sm font-medium text-red-500" role="alert">
            {game.error}
          </p>
        )}
        {game.phase === "disconnected" && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            연결이 끊어졌어요. 다시 방을 만들거나 참여해주세요.
          </p>
        )}
      </section>
    );
  }

  const state = game.state;
  if (!state) {
    return (
      <section className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white p-8 text-center shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <p className="animate-pulse text-sm text-zinc-500 dark:text-zinc-400">
          연결 중…
        </p>
      </section>
    );
  }

  const you = game.you;
  const opponentMark: Player | null = you === "X" ? "O" : you === "O" ? "X" : null;
  const isMyTurn =
    state.status === "playing" && you !== null && state.current === you;
  const canPlay =
    isMyTurn && state.connected[you] && game.phase === "in-room";

  /* ------------------------------ 대기 화면 ------------------------------ */

  if (state.status === "waiting") {
    return (
      <section className="flex w-full max-w-md flex-col items-center gap-6 rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 sm:p-8">
        <div className="flex w-full items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            {you === null ? "관전 중" : "방 코드"}
          </span>
          <button
            type="button"
            onClick={game.leave}
            className="text-xs text-zinc-400 underline underline-offset-2 transition-colors hover:text-red-500"
          >
            나가기
          </button>
        </div>

        <button
          type="button"
          onClick={copyCode}
          className="group rounded-2xl border-2 border-dashed border-zinc-300 px-10 py-6 transition-colors hover:border-zinc-400 dark:border-zinc-600 dark:hover:border-zinc-500"
          aria-label={`방 코드 ${game.code} 복사`}
        >
          <span className="font-mono text-5xl font-bold tracking-[0.25em] text-zinc-900 dark:text-zinc-50">
            {game.code}
          </span>
          <span className="mt-1 block text-xs text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300">
            {copied ? "✓ 복사됨" : "클릭해서 복사"}
          </span>
        </button>

        <p className="animate-pulse text-sm font-medium text-zinc-500 dark:text-zinc-400">
          친구를 기다리는 중…
        </p>

        {game.phase === "reconnecting" && <ReconnectingBanner />}

        <p className="text-center text-xs leading-5 text-zinc-400">
          친구에게 4자리 코드를 알려주세요.
          <br />
          두 사람이 모이면 대전이 시작됩니다!
        </p>
      </section>
    );
  }

  /* ------------------------------ 대전 화면 ------------------------------ */

  const statusText = getStatusText(state, you);
  const myRequest = you !== null && state.rematch[you];
  const oppRequest = opponentMark !== null && state.rematch[opponentMark];
  const oppConnected = opponentMark !== null && state.connected[opponentMark];

  return (
    <section className="flex w-full max-w-md flex-col items-center gap-4 rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 sm:p-8">
      <div className="flex w-full items-center justify-between">
        <button
          type="button"
          onClick={copyCode}
          className="rounded-full bg-zinc-100 px-3 py-1.5 font-mono text-xs font-bold tracking-widest text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          aria-label={`방 코드 ${game.code} 복사`}
        >
          {copied ? "✓ 복사됨" : `#${game.code}`}
        </button>
        <button
          type="button"
          onClick={game.leave}
          className="text-xs text-zinc-400 underline underline-offset-2 transition-colors hover:text-red-500"
        >
          나가기
        </button>
      </div>

      <div className="flex w-full items-center gap-1.5 rounded-2xl bg-zinc-50 p-1.5 dark:bg-zinc-800/60">
        <PlayerBadge
          mark="X"
          label={playerLabel(you, "X")}
          connected={state.connected.X}
          active={state.status === "playing" && state.current === "X"}
        />
        <span className="px-0.5 text-[10px] font-bold text-zinc-300 dark:text-zinc-600">
          VS
        </span>
        <PlayerBadge
          mark="O"
          label={playerLabel(you, "O")}
          connected={state.connected.O}
          active={state.status === "playing" && state.current === "O"}
        />
      </div>

      <div className="flex h-6 items-center justify-center gap-2 text-center">
        {game.phase === "reconnecting" ? (
          <ReconnectingBanner />
        ) : rotationToast ? (
          <p className="animate-fade-up text-sm font-semibold text-amber-600 dark:text-amber-400">
            {rotationToast}
          </p>
        ) : state.status === "playing" ? (
          <p className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
            {statusText}
          </p>
        ) : (
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
            {statusText}
          </p>
        )}
      </div>

      {state.status === "playing" && (
        <RotationIndicator turnCount={state.turnCount} />
      )}

      <RotatingBoard
        board={state.board}
        midBoard={state.midBoard}
        result={state.result}
        current={state.current}
        canPlay={canPlay}
        spin={game.spin}
        onPlay={game.play}
      />

      {state.status === "ended" && (
        <div className="flex h-12 items-center">
          {you !== null && oppConnected ? (
            <button
              type="button"
              onClick={game.requestRematch}
              disabled={myRequest}
              className={`flex h-10 items-center justify-center rounded-full px-6 text-sm font-medium transition-colors ${
                oppRequest && !myRequest
                  ? "bg-amber-500 text-white hover:bg-amber-600"
                  : "bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              }`}
            >
              {oppRequest && !myRequest
                ? "리매치 수락"
                : myRequest
                  ? "상대 수락 대기 중…"
                  : "리매치 하기"}
            </button>
          ) : (
            <p className="text-xs text-zinc-400">
              상대가 나갔어요. 새 방을 만들어 다시 대전해보세요!
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/* --------------------------- 회전하는 보드 --------------------------- */

function cellPosition(index: number): string {
  return `translate(${(index % 3) * 100}%, ${Math.floor(index / 3) * 100}%)`;
}

function RotatingBoard({
  board,
  midBoard,
  result,
  current,
  canPlay,
  spin,
  onPlay,
}: {
  board: OnlineBoard;
  midBoard: OnlineBoard | null;
  result: OnlineResult;
  current: Player;
  canPlay: boolean;
  spin: SpinEvent | null;
  onPlay: (index: number) => void;
}) {
  // 회전 직후에는 중력 적용 전(mid) 위치에 말을 보여주고, 이후 낙하시킨다.
  const [falling, setFalling] = useState(false);

  useEffect(() => {
    if (!spin || !midBoard) {
      setFalling(false);
      return;
    }
    setFalling(true);
    const timer = window.setTimeout(() => setFalling(false), 900);
    return () => window.clearTimeout(timer);
  }, [spin, midBoard]);

  const marks = board.flatMap((cell, index) =>
    cell ? [{ ...cell, index }] : [],
  );

  const displayIndex = (mark: { id: string; index: number }): number => {
    if (falling && midBoard) {
      const mid = midBoard.findIndex((cell) => cell?.id === mark.id);
      if (mid !== -1) return mid;
    }
    return mark.index;
  };

  return (
    <div
      role="grid"
      aria-label="틱택토 보드"
      className="relative mx-auto aspect-square w-full max-w-80"
    >
      {/* 칸 레이어: 회전 이벤트마다 통째로 스윙하며 돈다 */}
      <div
        key={spin ? `spin-${spin.seq}` : "static"}
        className={`absolute inset-0 ${spin ? "animate-board-spin" : ""}`}
        style={
          spin
            ? ({ "--spin-deg": `${spin.dir * 90}deg` } as CSSProperties)
            : undefined
        }
      >
        {board.map((cell, index) => (
          <div
            key={index}
            className="absolute left-0 top-0 h-1/3 w-1/3 p-1 sm:p-1.5"
            style={{ transform: cellPosition(index) }}
          >
            <button
              type="button"
              onClick={() => onPlay(index)}
              disabled={!canPlay || cell !== null}
              aria-label={`${
                ["1행 1열", "1행 2열", "1행 3열", "2행 1열", "2행 2열", "2행 3열", "3행 1열", "3행 2열", "3행 3열"][index]
              }, ${cell?.player ?? "빈 칸"}`}
              className="group/cell flex h-full w-full items-center justify-center rounded-xl bg-white ring-1 ring-zinc-200 transition-colors hover:bg-zinc-50 disabled:cursor-default dark:bg-zinc-800 dark:ring-zinc-700 dark:hover:bg-zinc-800"
            >
              {cell === null && canPlay && (
                <span
                  className={`text-4xl font-bold opacity-0 transition-opacity group-hover/cell:opacity-25 sm:text-5xl ${PLAYER_STYLES[current].mark}`}
                >
                  {current}
                </span>
              )}
            </button>
          </div>
        ))}
      </div>

      {/* 말 레이어: 회전 후 새 위치로 미끄러진다 */}
      <div className="pointer-events-none absolute inset-0">
        {marks.map((mark) => {
          const isWinner =
            result?.type === "win" && result.line.includes(mark.index);
          const dimmed = result !== null && !isWinner;
          return (
            <div
              key={mark.id}
              className="absolute left-0 top-0 flex h-1/3 w-1/3 items-center justify-center"
              style={{
                transform: cellPosition(displayIndex(mark)),
                transition: falling
                  ? "transform 850ms cubic-bezier(0.3, 1.1, 0.5, 1)"
                  : "transform 620ms cubic-bezier(0.34, 1.35, 0.64, 1)",
              }}
            >
              <span
                className={`flex h-[78%] w-[78%] items-center justify-center rounded-2xl text-4xl font-bold transition-all duration-300 sm:text-5xl ${
                  PLAYER_STYLES[mark.player].mark
                } ${isWinner ? `${PLAYER_STYLES[mark.player].win} scale-110` : ""} ${
                  dimmed ? "opacity-40" : ""
                }`}
              >
                {mark.player}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RotationIndicator({ turnCount }: { turnCount: number }) {
  const filled = turnCount % ROTATE_EVERY;
  const remaining = ROTATE_EVERY - filled;
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
      <span aria-hidden>🔄</span>
      <span>판 회전까지</span>
      <span
        className="flex gap-1"
        role="status"
        aria-label={`회전까지 ${remaining}수 남음`}
      >
        {Array.from({ length: ROTATE_EVERY }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 w-1.5 rounded-full transition-colors ${
              i < filled
                ? "bg-amber-500"
                : "bg-zinc-300 dark:bg-zinc-600"
            }`}
          />
        ))}
      </span>
      <span>{remaining}수</span>
    </div>
  );
}

function PlayerBadge({
  mark,
  label,
  connected,
  active,
}: {
  mark: Player;
  label: string;
  connected: boolean;
  active: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-xl px-2.5 py-2 transition-colors ${
        active
          ? "bg-white ring-1 ring-zinc-300 dark:bg-zinc-700/70 dark:ring-zinc-600"
          : ""
      }`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          connected ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
        } ${connected && active ? "animate-pulse" : ""}`}
        aria-label={connected ? "접속 중" : "오프라인"}
      />
      <span className={`text-lg font-bold ${PLAYER_STYLES[mark].mark}`}>
        {mark}
      </span>
      <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
    </div>
  );
}

function playerLabel(you: Player | null, mark: Player): string {
  if (you === null) return `플레이어 ${mark}`;
  return you === mark ? "나" : "상대";
}

function ReconnectingBanner() {
  return (
    <p
      className="animate-pulse text-xs font-medium text-amber-600 dark:text-amber-400"
      role="status"
    >
      연결이 잠시 끊겨 자동으로 다시 접속하는 중…
    </p>
  );
}

function getStatusText(
  state: NonNullable<ReturnType<typeof useOnlineGame>["state"]>,
  you: Player | null,
): string {
  if (state.status === "waiting") return "플레이어를 기다리는 중…";
  if (state.status === "playing") {
    if (you === null) return `${state.current} 차례`;
    return state.current === you ? `당신 차례 — ${you}` : "상대 차례…";
  }
  if (state.result?.type === "win") {
    if (you === null) return `🎉 ${state.result.player} 승리!`;
    return state.result.player === you
      ? "🎉 승리했습니다!"
      : "😢 아쉽네요, 패배…";
  }
  if (state.result?.type === "draw") return "🤝 무승부입니다";
  return "상대방이 방을 나갔어요";
}
