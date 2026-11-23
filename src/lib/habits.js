// Habit catalog. Legacy ids stay so old habit_log rows still mean what they meant.
// `protein` is the old "both meals" habit. The daily gram target is `protein_day`.

export const SCORED_HABITS = ['session', 'steps', 'sleep', 'protein_day', 'calories', 'water', 'sun', 'sugar', 'last_meal'];
export const LEGACY_HABITS = ['window', 'protein', 'carbs', 'walks', 'training', 'screens'];
export const ALL_HABITS = [...SCORED_HABITS, ...LEGACY_HABITS];

export const HABIT_LABELS = {
  session: "Today's session",
  steps: 'Steps',
  sleep: 'Sleep',
  protein_day: 'Protein',
  calories: 'Calories',
  water: 'Water',
  sun: 'Morning sun',
  sugar: 'No sugary drinks',
  last_meal: 'Kitchen closed',
  window: 'Eating window held',
  protein: 'Protein at both meals',
  carbs: 'Carbs under the cap',
  walks: 'Post-meal walks',
  training: 'Strength or HIIT',
  screens: 'Screens off before bed',
};

export const HABIT_CATALOG = ALL_HABITS.map((id) => ({
  id,
  label: HABIT_LABELS[id],
  legacy: LEGACY_HABITS.includes(id),
}));

export const DEFAULT_ACTIVE = [...SCORED_HABITS];
