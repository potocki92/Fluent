import { abilityToCefr, bandProgress } from "@/lib/cefr";
import { cn } from "@/lib/utils";

/**
 * Circular progress ring showing the learner's CEFR level and progress towards
 * the next band.
 */
export function LevelRing({
  ability,
  size = 120,
  stroke = 10,
  className,
}: {
  ability: number;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  const level = abilityToCefr(ability);
  const progress = bandProgress(ability);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * progress;

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#374151"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#d4a574"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-bold text-gold">{level}</span>
        <span className="text-xs text-muted2">{Math.round(ability)}</span>
      </div>
    </div>
  );
}
