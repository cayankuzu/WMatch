export const performanceBudgets = {
  reactFirstLayoutMs: 900,
  sessionReadyMs: 1200,
  firstUsefulContentMs: 1800,
  warmResumeMs: 500,
  apiRequestMs: 600,
  tabCommitMs: 150,
} as const;

export type PerformanceBudgetName = keyof typeof performanceBudgets;
