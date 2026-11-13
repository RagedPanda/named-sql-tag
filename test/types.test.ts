import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sql, toMysql, toPg, toSqlite, type Fragment, type PgQuery, type PlaceholderQuery} from '../src/index.ts';

// These checks run when `npm run typecheck` compiles this file; the test only makes sure the code runs.
const typeChecks = () => {
	// No named parameters: the params object is optional.
	const plain = sql`SELECT * FROM users WHERE id = ${1}`;
	const plainFragment: Fragment = plain;
	const pgQuery: PgQuery = toPg(plainFragment);
	const sqliteQuery: PlaceholderQuery = toSqlite(plain);
	const mysqlQuery: PlaceholderQuery = toMysql(plain, {});

	// Named parameters are collected from nested fragments, joins and IN lists.
	const named = sql`SELECT * FROM t WHERE a = ${sql.param('a')} AND ${sql`b = ${sql.param('b')}`} AND c IN ${sql.in([sql.param('c'), 1])} AND ${sql.join([sql`d = ${sql.param('d')}`], sql` OR ${sql.param('e')} `)}`;
	const namedFragment: Fragment<'a' | 'b' | 'c' | 'd' | 'e'> = named;
	toPg(named, {a: 1, b: 2, c: 3, d: 4, e: 5});
	// @ts-expect-error the params object is required
	toPg(named);
	// @ts-expect-error "e" is missing
	toSqlite(named, {a: 1, b: 2, c: 3, d: 4});
	// @ts-expect-error a fragment with open names is not a plain Fragment
	const notPlain: Fragment = named;

	// bind removes the names it binds.
	const partly: Fragment<'d' | 'e'> = named.bind({a: 1, b: 2, c: 3});
	const done: Fragment = partly.bind({d: 4, e: 5});
	toMysql(done);
	// @ts-expect-error "z" is not a parameter of this fragment
	named.bind({z: 1});

	// Untyped values never demand params.
	const loose: any = 5;
	toPg(sql`SELECT ${loose}`);
	const unknownValue: unknown = 5;
	toPg(sql`SELECT ${unknownValue}`);

	// sql.id, sql.raw and sql.empty have no names.
	const identifiers: Fragment = sql`${sql.id('a', 'b')} ${sql.raw('x')} ${sql.empty}`;
	return [pgQuery, sqliteQuery, mysqlQuery, namedFragment, notPlain, identifiers];
};

test('type checks compile and run', () => {
	assert.throws(typeChecks, /Missing a value/);
});
