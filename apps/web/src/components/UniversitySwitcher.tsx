import { useUniversity } from '../lib/university';

/** The global university filter. Hidden until a university exists. */
export function UniversitySwitcher() {
  const { selection, universities, setSelection } = useUniversity();
  if (universities.length === 0) return null;
  return (
    <div className="university-switcher">
      <label className="visually-hidden" htmlFor="university-switcher">
        University
      </label>
      <select id="university-switcher" value={selection} onChange={(event) => setSelection(event.target.value)}>
        <option value="all">All universities</option>
        {universities.map((university) => (
          <option key={university.id} value={university.id}>
            {university.name}
          </option>
        ))}
      </select>
    </div>
  );
}
