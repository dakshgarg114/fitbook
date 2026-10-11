// Types (and a few constants) shared by server/ and web/.

export type Point = [number, number];

export interface StrokeItem {
  type: 'stroke';
  id: string;
  points: Point[];
  size: number;
  color: string;
}

export interface TextItem {
  type: 'text';
  id: string;
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
}

// A coloured doodle: SVG markup drawn in a DOODLE_W x DOODLE_H frame, placed at x,y with the given size.
export interface DoodleItem {
  type: 'doodle';
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  svg: string;
}

export const DOODLE_W = 360;
export const DOODLE_H = 270;

export type CanvasItem = StrokeItem | TextItem | DoodleItem;

export interface Canvas {
  width: number;
  height: number;
  items: CanvasItem[];
}

export interface Macros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
}

export const FOOD_GROUPS = [
  'berries',
  'leafy_greens',
  'vegetables',
  'fruits',
  'spices_herbs',
  'tea_coffee',
  'nuts_seeds',
  'legumes',
  'whole_grains',
  'dark_chocolate',
  'dairy',
  'meat_fish_egg',
  'refined_grains',
  'sweets',
  'fried',
  'other',
] as const;
export type FoodGroup = (typeof FOOD_GROUPS)[number];

export interface LogEntry extends Macros {
  id: number;
  name: string;
  grams: number;
  foodGroup: FoodGroup;
  source: 'usda' | 'estimate';
  usdaDescription: string | null;
}

export interface Meal {
  id: number;
  heading: string;
  time: string; // HH:MM, 24h, local to the user
  note: string;
  totals: Macros;
  foods: LogEntry[];
}

export type Goal = 'lose' | 'maintain' | 'gain';

export interface Profile {
  age: number | null;
  sex: 'male' | 'female' | null;
  weightKg: number | null;
  heightCm: number | null;
  goal: Goal | null;
  units: 'metric' | 'imperial';
  theme: Theme;
  // Daily goals the user set themselves; anything missing is worked out from the profile.
  customTargets: Partial<Targets>;
  // Their usual day in their own words (wake, meals, workouts, work, sleep); 'skipped' if they passed.
  routine: string | null;
}

export const THEMES = ['paper', 'midnight', 'sage', 'dusk'] as const;
export type Theme = (typeof THEMES)[number];

export interface Targets {
  calories: number;
  protein: number;
  fiber: number;
  carbsMin: number;
  carbsMax: number;
}

export interface Scores {
  carbs: number;
  fiber: number;
  protein: number;
  antioxidants: number;
  overall: number;
}

export interface Me {
  email: string;
  name: string | null;
  registeredOn: string; // YYYY-MM-DD
  profile: Profile;
  profileComplete: boolean;
  targets: Targets | null;
  guideSeen: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  hasPhoto: boolean;
  createdAt: string;
  suggestions?: string[]; // quick replies offered with an assistant message
}

export interface DayView {
  date: string;
  version: number;
  canvas: Canvas;
  meals: Meal[];
  totals: Macros;
  scores: Scores | null; // null until the profile is complete
  tips: string | null; // cached tips for this version, if written
  messages: ChatMessage[];
}

export interface ChatResponse {
  reply: string;
  day: DayView;
  me: Me;
}

export interface CalendarDay {
  date: string;
  overall: number | null; // null when nothing was logged
}
