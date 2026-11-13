// Checks the migration guide in the README: the same templates give the same text and values as
// sql-template-strings, and its open issues have an answer here.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {sql, toPg} from '../src/index.ts';

type SqlStatement = {text: string; sql: string; values: unknown[]; append: (statement: SqlStatement | string) => SqlStatement};
const SQL = createRequire(import.meta.url)('sql-template-strings') as (strings: TemplateStringsArray, ...values: unknown[]) => SqlStatement;

test('plain templates give the same text, sql and values as sql-template-strings', () => {
	const book = 'harry potter';
	const author = 'J. K. Rowling';
	const theirs = SQL`SELECT author FROM books WHERE name = ${book} AND author = ${author}`;
	const ours = sql`SELECT author FROM books WHERE name = ${book} AND author = ${author}`;
	assert.equal(ours.text, theirs.text);
	assert.equal(ours.sql, theirs.sql);
	assert.deepEqual(ours.values, theirs.values);
});

test('append becomes nesting, and the base query is not changed', () => {
	const theirBase = SQL`SELECT * FROM books`;
	const theirs = theirBase.append(SQL` WHERE name = ${'x'}`).append(' LIMIT 1');
	const ourBase = sql`SELECT * FROM books`;
	const ours = sql`${ourBase} WHERE name = ${'x'}${sql.raw(' LIMIT 1')}`;
	assert.equal(ours.text, theirs.text);
	assert.deepEqual(ours.values, theirs.values);
	// sql-template-strings changed its base query in place (issues #71 and #164); ours is unchanged.
	assert.equal(theirBase.text, theirs.text);
	assert.equal(ourBase.text, 'SELECT * FROM books');
});

test('a nested statement is a value in sql-template-strings and a subquery here (issue #184)', () => {
	const theirs = SQL`SELECT * FROM t WHERE c = (${SQL`SELECT c FROM u WHERE id = ${1}`})`;
	assert.equal(theirs.text, 'SELECT * FROM t WHERE c = ($1)');
	const ours = sql`SELECT * FROM t WHERE c = (${sql`SELECT c FROM u WHERE id = ${1}`})`;
	assert.deepEqual(toPg(ours), {text: 'SELECT * FROM t WHERE c = (SELECT c FROM u WHERE id = $1)', values: [1]});
});

test('an array is one value in sql-template-strings, and sql.in expands it (issue #96)', () => {
	const statuses = ['Completed', 'In Progress'];
	assert.equal(SQL`WHERE status IN (${statuses})`.text, 'WHERE status IN ($1)');
	assert.deepEqual(toPg(sql`WHERE status IN ${sql.in(statuses)}`), {text: 'WHERE status IN ($1, $2)', values: statuses});
});
