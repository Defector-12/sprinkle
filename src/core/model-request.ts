export {
  buildModelRequest,
  buildTranslationRequest,
} from './prompts.ts';
export type {
  BuildModelRequestInput,
  BuildTranslationRequestInput,
} from './prompts.ts';

export function shouldRetryUnchangedTranslation(
  source: string,
  translation: string,
): boolean {
  const selected = source.replace(/\s+/g, ' ').trim();
  const output = translation.replace(/\s+/g, ' ').trim();
  return (
    selected.length > 1 &&
    selected === selected.toLowerCase() &&
    /^[a-z][a-z '-]*$/.test(selected) &&
    selected.toLowerCase() === output.toLowerCase()
  );
}
