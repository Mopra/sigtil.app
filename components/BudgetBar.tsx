import type { Budget } from '@/lib/budget';
import { t } from '@/lib/strings';

const kroner = (n: number) => n.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** What the AI has cost this month against the site's budget, above the chat. */
export default function BudgetBar({ budget }: { budget: Budget }) {
  const share = budget.limit > 0 ? Math.min(1, budget.spent / budget.limit) : 1;
  const usedUp = budget.spent >= budget.limit;
  const near = !usedUp && share >= 0.8;
  const resets = new Date(budget.resets).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const fill = usedUp ? 'bg-danger' : near ? 'bg-amber-500' : 'bg-accent';

  return (
    <div className="shrink-0 border-b border-line px-5 py-3" title={t.budgetTitle(resets)}>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="font-medium text-ink-soft">{t.budgetLabel}</span>
        <span className="tabular-nums text-ink-faint">
          <span className={usedUp ? 'font-semibold text-danger' : 'font-semibold text-ink'}>{kroner(budget.spent)}</span>{' '}
          {t.budgetOf(kroner(budget.limit))}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t.budgetLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line"
      >
        <div className={`h-full rounded-full transition-[width] duration-500 ${fill}`} style={{ width: `${share * 100}%` }} />
      </div>
      {(usedUp || near) && (
        <p className={`mt-2 text-[13px] leading-snug ${usedUp ? 'text-danger' : 'text-ink-soft'}`}>
          {usedUp ? t.budgetUsedUp(resets) : t.budgetNear}
        </p>
      )}
    </div>
  );
}
