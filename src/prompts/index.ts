/**
 * Prompt template barrel. The pane should import from here, never from
 * the individual files, so the version metadata stays in one observable
 * place.
 */
export { MATH_READ_PROMPT, MATH_READ_PROMPT_VERSION } from './mathRead';
export {
  MATH_V12_SYSTEM,
  MATH_V12_PROMPT_VERSION,
  buildMathV12UserMessage,
} from './mathV12';
export {
  GENERAL_VISION_PROMPT,
  GENERAL_VISION_PROMPT_VERSION,
} from './generalVision';
