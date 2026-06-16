import { cn } from "@/lib/utils/cn";
import { getScoreColor, getScoreBgColor } from "@/lib/scoring/verdicts";

interface ScoreDisplayProps {
  score: number;
  size?: "sm" | "md" | "lg" | "xl";
  showBar?: boolean;
  className?: string;
}

const SIZE_CLASSES = {
  sm: "text-sm font-bold",
  md: "text-lg font-bold",
  lg: "text-2xl font-bold",
  xl: "text-3xl font-extrabold",
};

export function ScoreDisplay({ score, size = "md", showBar = false, className }: ScoreDisplayProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className={cn(SIZE_CLASSES[size], "tabular-nums", getScoreColor(score))}>
        {score.toFixed(1)}
      </span>
      {showBar && (
        <div className="flex-1 score-bar">
          <div
            className={cn("score-bar-fill", getScoreBgColor(score))}
            style={{ width: `${Math.min(score * 10, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

interface ScoreBarCompactProps {
  score: number;
  label: string;
}

export function ScoreBarCompact({ score, label }: ScoreBarCompactProps) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-semibold tabular-nums", getScoreColor(score))}>{score.toFixed(0)}</span>
      </div>
      <div className="score-bar">
        <div className={cn("score-bar-fill", getScoreBgColor(score))} style={{ width: `${score * 10}%` }} />
      </div>
    </div>
  );
}
