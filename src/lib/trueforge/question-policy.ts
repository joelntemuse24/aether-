/** Shared by session config and every tool note. */
export const ASK_USER_QUESTIONS_ENABLED = true;

export function userQuestionPolicy(enabled = ASK_USER_QUESTIONS_ENABLED): string {
  return enabled
    ? "For minor missing details, make a reasonable assumption and state it. Use ask_user_question when a choice materially changes the outcome and the options are clear."
    : "If a detail is missing, make a reasonable assumption and state it. Do not stop to ask the user to choose.";
}
