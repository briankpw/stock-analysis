declare module "vader-sentiment" {
  export interface VaderScores {
    neg: number;
    neu: number;
    pos: number;
    compound: number;
  }

  export const SentimentIntensityAnalyzer: {
    polarity_scores(text: string): VaderScores;
  };

  const _default: {
    SentimentIntensityAnalyzer: typeof SentimentIntensityAnalyzer;
  };
  export default _default;
}
