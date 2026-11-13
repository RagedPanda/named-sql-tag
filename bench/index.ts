// Compares named-sql-tag with sql-template-strings, sql-template-tag and @databases/sql on the time it takes to
// build a query and render it to pg's {text, values}.
//
//   npm run bench
//   BENCH_ITERATIONS=200000 BENCH_RUNS=9 npm run bench
//
// Each run builds and renders the same query `BENCH_ITERATIONS` times in a loop. Every library must produce the
// same text and values, which is checked before timing. The median time per query of the timed runs is reported.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import templateTag, {join as templateTagJoin, Sql as TemplateTagSql} from 'sql-template-tag';
import {sql, toPg} from '../src/index.ts';

const iterations = Number(process.env['BENCH_ITERATIONS'] ?? 100_000);
const runs = Number(process.env['BENCH_RUNS'] ?? 7);
const warmups = 2;

type Rendered = {readonly text: string; readonly values: readonly unknown[]};
type SqlStatement = {text: string; values: unknown[]; append: (statement: SqlStatement | string) => SqlStatement};
type DatabasesQuery = {format: (config: {escapeIdentifier: (name: string) => string; formatValue: (value: unknown, index: number) => {placeholder: string; value: unknown}}) => {text: string; values: unknown[]}};
type DatabasesSql = ((strings: TemplateStringsArray, ...values: unknown[]) => DatabasesQuery) & {
	readonly join: (queries: DatabasesQuery[], separator: DatabasesQuery) => DatabasesQuery;
};

// Both are CommonJS packages.
const require = createRequire(import.meta.url);
const SQL = require('sql-template-strings') as (strings: TemplateStringsArray, ...values: unknown[]) => SqlStatement;
const databasesSql = require('@databases/sql') as DatabasesSql;
const pgFormat = {
	escapeIdentifier: (name: string) => `"${name.replaceAll('"', '""')}"`,
	formatValue: (value: unknown, index: number) => ({placeholder: `$${index + 1}`, value}),
};

const userId = 42;
const teams = ['core', 'kernel', 'docs', 'infra', 'web', 'mobile', 'data', 'ml', 'ops', 'security'];
const searchText = '%ada%';

type Scenario = {readonly name: string; readonly libraries: Readonly<Record<string, () => Rendered>>};

const scenarios: readonly Scenario[] = [
	{
		name: 'Simple: 2 values',
		libraries: {
			'named-sql-tag': () => toPg(sql`SELECT * FROM users WHERE id = ${userId} AND name LIKE ${searchText}`),
			'sql-template-strings': () => {
				const statement = SQL`SELECT * FROM users WHERE id = ${userId} AND name LIKE ${searchText}`;
				return {text: statement.text, values: statement.values};
			},
			'sql-template-tag': () => {
				const query = templateTag`SELECT * FROM users WHERE id = ${userId} AND name LIKE ${searchText}`;
				return {text: query.text, values: query.values};
			},
			'@databases/sql': () => databasesSql`SELECT * FROM users WHERE id = ${userId} AND name LIKE ${searchText}`.format(pgFormat),
		},
	},
	{
		name: 'Composed: 3 conditions, IN list of 10, ORDER BY',
		libraries: {
			'named-sql-tag': () => {
				const conditions = [sql`owner = ${userId}`, sql`team IN ${sql.in(teams)}`, sql`name LIKE ${searchText}`];
				return toPg(sql`SELECT * FROM users WHERE ${sql.join(conditions, sql` AND `)} ORDER BY id`);
			},
			'sql-template-strings': () => {
				const statement = SQL`SELECT * FROM users WHERE owner = ${userId} AND team IN (`;
				teams.forEach((team, index) => statement.append(index === 0 ? SQL`${team}` : SQL`, ${team}`));
				statement.append(SQL`) AND name LIKE ${searchText}`).append(' ORDER BY id');
				return {text: statement.text, values: statement.values};
			},
			'sql-template-tag': () => {
				const conditions = [templateTag`owner = ${userId}`, templateTag`team IN (${templateTagJoin(teams, ", ")})`, templateTag`name LIKE ${searchText}`];
				const query: TemplateTagSql = templateTag`SELECT * FROM users WHERE ${templateTagJoin(conditions, ' AND ')} ORDER BY id`;
				return {text: query.text, values: query.values};
			},
			'@databases/sql': () => {
				const conditions = [databasesSql`owner = ${userId}`, databasesSql`team IN (${databasesSql.join(teams.map(team => databasesSql`${team}`), databasesSql`, `)})`, databasesSql`name LIKE ${searchText}`];
				return databasesSql`SELECT * FROM users WHERE ${databasesSql.join(conditions, databasesSql` AND `)} ORDER BY id`.format(pgFormat);
			},
		},
	},
	{
		name: 'Reused value: one user id in 3 places',
		libraries: {
			'named-sql-tag': () => toPg(sql`SELECT * FROM posts WHERE author = ${sql.param('user')} OR editor = ${sql.param('user')} OR reviewer = ${sql.param('user')}`, {user: userId}),
			'sql-template-strings': () => {
				const statement = SQL`SELECT * FROM posts WHERE author = ${userId} OR editor = ${userId} OR reviewer = ${userId}`;
				return {text: statement.text, values: statement.values};
			},
			'sql-template-tag': () => {
				const query = templateTag`SELECT * FROM posts WHERE author = ${userId} OR editor = ${userId} OR reviewer = ${userId}`;
				return {text: query.text, values: query.values};
			},
			'@databases/sql': () => databasesSql`SELECT * FROM posts WHERE author = ${userId} OR editor = ${userId} OR reviewer = ${userId}`.format(pgFormat),
		},
	},
];

const median = (values: readonly number[]): number => {
	const sorted = values.toSorted((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** Nanoseconds per query for one run. The sum of text lengths keeps the work from being optimized away. */
const timeRun = (build: () => Rendered): number => {
	let checksum = 0;
	const start = performance.now();
	for (let index = 0; index < iterations; index++) {
		checksum += build().text.length;
	}

	const elapsed = performance.now() - start;
	assert.ok(checksum > 0);
	return (elapsed * 1e6) / iterations;
};

const measure = (build: () => Rendered): number => {
	const times = [];
	for (let run = 0; run < warmups + runs; run++) {
		const time = timeRun(build);
		if (run >= warmups) {
			times.push(time);
		}
	}

	return median(times);
};

/** The reused-value scenario is the one place outputs differ: named-sql-tag sends the value once, as $1. */
const normalize = (rendered: Rendered): Rendered => ({text: rendered.text.replaceAll(/\$\d+/g, '$n'), values: [...new Set(rendered.values)]});

const libraryNames = Object.keys(scenarios[0]!.libraries);
console.log(`Node.js ${process.version}, ${os.cpus()[0]?.model ?? os.arch()} (${os.cpus().length} cores), ${os.platform()} ${os.release()}`);
console.log(`${iterations.toLocaleString('en')} queries built and rendered to {text, values} per run, median of ${runs} runs after ${warmups} warmups\n`);
console.log(`| Query | ${libraryNames.join(' | ')} |`);
console.log(`| --- |${libraryNames.map(() => ' ---: |').join('')}`);
for (const scenario of scenarios) {
	const expected = normalize(scenario.libraries['named-sql-tag']!());
	const times = libraryNames.map(name => {
		const build = scenario.libraries[name]!;
		assert.deepEqual(normalize(build()), expected, `${name} renders "${scenario.name}" differently`);
		return measure(build);
	});
	console.log(`| ${scenario.name} | ${times.map(time => `${time.toFixed(0)} ns`).join(' | ')} |`);
}

