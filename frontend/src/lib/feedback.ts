export interface FeedbackCreate {
  rating: number;
  decoration_rating: number;
  information_rating: number;
  project_name?: string;
  suggestion?: string;
}

export interface FeedbackReceipt {
  id: string;
  rating: number;
}

export interface RatingCount {
  rating: number;
  count: number;
}

export interface FeedbackSuggestion {
  project_name: string;
  suggestion: string;
}

export interface FeedbackSummary {
  total: number;
  average_rating: number | null;
  criteria_averages: FeedbackCriteriaAverages;
  rating_counts: RatingCount[];
  suggestions: FeedbackSuggestion[];
}

export interface FeedbackCriteriaAverages {
  decoration: number | null;
  information: number | null;
}