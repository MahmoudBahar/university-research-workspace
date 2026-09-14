/**
 * SQL fragments that decide whether a row belongs to one university.
 *
 * Every fragment uses only positional `?` placeholders (portable across
 * better-sqlite3 and node:sqlite) and reports how many of them it contains, so
 * a caller binds the same university id `params` times with `bind()`. When no
 * university filter is requested, callers add nothing and the SQL is unchanged.
 */
export interface SqlFragment {
  sql: string;
  /** Number of `?` placeholders, all bound to the university id. */
  params: number;
}

/** A person belongs through an affiliation with one of the university's units, or through a lab it owns. */
export function personInUniversity(col: string): SqlFragment {
  return {
    sql:
      `(EXISTS (SELECT 1 FROM relationships ra JOIN academic_units au ON au.entity_id = ra.to_id ` +
      `WHERE ra.from_id = ${col} AND ra.rel_type = 'affiliated_with' AND au.university_id = ?) ` +
      `OR EXISTS (SELECT 1 FROM relationships rl JOIN labs l ON l.entity_id = rl.to_id ` +
      `WHERE rl.from_id = ${col} AND rl.rel_type IN ('member_of_lab','directs_lab') AND l.university_id = ?))`,
    params: 2,
  };
}

/** A lab belongs through its own column, or, when that was never recorded, through an affiliated member. */
export function labInUniversity(col: string): SqlFragment {
  return {
    sql:
      `(EXISTS (SELECT 1 FROM labs l WHERE l.entity_id = ${col} AND (l.university_id = ? OR (l.university_id IS NULL AND EXISTS (` +
      `SELECT 1 FROM relationships rm JOIN relationships ra ON ra.from_id = rm.from_id AND ra.rel_type = 'affiliated_with' ` +
      `JOIN academic_units au ON au.entity_id = ra.to_id ` +
      `WHERE rm.to_id = l.entity_id AND rm.rel_type IN ('member_of_lab','directs_lab') AND au.university_id = ?)))))`,
    params: 2,
  };
}

/** A draft belongs through its program, or through its recipient. `alias` is the outreach table alias. */
export function outreachInUniversity(alias: string): SqlFragment {
  const person = personInUniversity(`${alias}.person_id`);
  return {
    sql: `(EXISTS (SELECT 1 FROM programs pg WHERE pg.entity_id = ${alias}.program_id AND pg.university_id = ?) OR ${person.sql})`,
    params: 1 + person.params,
  };
}

/** Any entity id: the university itself, a unit, a program, a lab or a person. */
export function entityInUniversity(col: string): SqlFragment {
  const lab = labInUniversity(col);
  const person = personInUniversity(col);
  return {
    sql:
      `(${col} = ? OR EXISTS (SELECT 1 FROM academic_units au WHERE au.entity_id = ${col} AND au.university_id = ?) ` +
      `OR EXISTS (SELECT 1 FROM programs pg WHERE pg.entity_id = ${col} AND pg.university_id = ?) OR ${lab.sql} OR ${person.sql})`,
    params: 3 + lab.params + person.params,
  };
}

/** A task belongs through the scope that governs it, or by targeting the university directly. */
export function taskInUniversity(alias: string): SqlFragment {
  return {
    sql: `(${alias}.scope_id IN (SELECT id FROM scopes WHERE university_id = ?) OR (${alias}.target_kind = 'university' AND ${alias}.target_id = ?))`,
    params: 2,
  };
}

export function bind(fragment: SqlFragment, universityId: string): string[] {
  return Array.from({ length: fragment.params }, () => universityId);
}
