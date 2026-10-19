export type PenaltyType = 'none' | 'retee' | 'drop';
// 'abandoned' = an unfinished round the golfer explicitly set aside to start a new one.
export type RoundStatus = 'active' | 'completed' | 'abandoned';

export interface Round {
  round_id: string;
  course_name: string;
  round_date: string; // YYYY-MM-DD, local
  hole_count: 9 | 18;
  starting_nine: 'front' | 'back';
  status: RoundStatus;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

export interface Hole {
  hole_id: string; // `${round_id}_${hole_number}` so a round/hole pair can only exist once
  round_id: string;
  hole_number: number;
  par: number;
  distance_yards: number | null;
  strokes: number;
  putts: number;
  tee_penalty_type: PenaltyType;
  note?: string; // free-text thought on the hole; blind like everything else until the round ends
  updated_at: string;
}

// In-progress entry for the hole currently on screen.
export interface Draft {
  round_id: string;
  hole_number: number;
  par: number | null;
  distance: string;
  strokes: number | null;
  strokesTouched: boolean;
  putts: number;
  puttsTouched: boolean;
  penalty: PenaltyType;
  note?: string;
}

export interface OutboxItem {
  key: string;
  kind: 'round' | 'hole';
  id: string;
  seq: number;
}
