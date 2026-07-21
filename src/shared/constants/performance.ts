export const performanceBudgets = {
  reactFirstLayoutMs: 1200,
  sessionReadyMs: 1800,
  firstUsefulContentMs: 2500,
  cachedScreenReadyMs: 300,
  networkScreenReadyMs: 1000,
  tabCommitMs: 300,
  pressFeedbackMs: 50,
} as const;

export type PerformanceBudgetName = keyof typeof performanceBudgets;
