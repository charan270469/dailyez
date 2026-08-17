// Static, hard-coded mock data used only by demo panels (the Daily Volume chart).
// Most views now pull real data from the backend; these exist for unsupported placeholders.

export const chartData = [
  { day: 'MON', value: 30 },
  { day: 'TUE', value: 45 },
  { day: 'WED', value: 35 },
  { day: 'THU', value: 70 },
  { day: 'FRI', value: 100, active: true },
  { day: 'SAT', value: 40 },
  { day: 'SUN', value: 25 },
];
