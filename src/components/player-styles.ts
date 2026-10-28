import type { Player } from "@/lib/tic-tac-toe";

export const PLAYER_STYLES: Record<Player, { mark: string; win: string }> = {
  X: {
    mark: "text-sky-500 dark:text-sky-400",
    win: "bg-sky-500/15 ring-2 ring-inset ring-sky-500/40",
  },
  O: {
    mark: "text-rose-500 dark:text-rose-400",
    win: "bg-rose-500/15 ring-2 ring-inset ring-rose-500/40",
  },
};
