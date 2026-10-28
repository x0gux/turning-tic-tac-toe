"use client";

import { useState } from "react";
import TicTacToe from "@/components/tic-tac-toe";
import TicTacToeOnline from "@/components/tic-tac-toe-online";

const TABS = [
  { id: "online", label: "🌐 온라인 대전" },
  { id: "practice", label: "🎮 연습" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function GameTabs() {
  const [tab, setTab] = useState<TabId>("online");

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div className="flex rounded-full bg-zinc-100 p-1 dark:bg-zinc-800" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              tab === item.id
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-white"
                : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "online" ? <TicTacToeOnline /> : <TicTacToe />}
    </div>
  );
}
