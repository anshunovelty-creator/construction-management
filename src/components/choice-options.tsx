import type { Choice } from '@/lib/masters/registry';

/** The <option>s of a dropdown: ungrouped choices first, then one <optgroup> per group, in the order they appear. */
export function ChoiceOptions({ choices }: { choices: Choice[] }) {
  const groups = [...new Set(choices.flatMap((c) => (c.group ? [c.group] : [])))];
  const option = (c: Choice) => <option key={c.value} value={c.value}>{c.label}</option>;
  return (
    <>
      {choices.filter((c) => !c.group).map(option)}
      {groups.map((group) => (
        <optgroup key={group} label={group}>
          {choices.filter((c) => c.group === group).map(option)}
        </optgroup>
      ))}
    </>
  );
}
