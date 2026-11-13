# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The `sql` tagged template: every `${value}` becomes a bound parameter, and nested fragments are composed in and renumbered. Fragments are frozen, so a base query can be shared safely.
- `toPg` renders `{text, values}` with `$1` placeholders for pg and PGlite; `toSqlite` and `toMysql` render `{sql, values}` with `?` placeholders for node:sqlite, better-sqlite3 and mysql2. A fragment also has `text`, `sql` and `values` getters, so it can be passed to pg directly, as with sql-template-strings.
- Named parameters with `sql.param(name)`, bound at render time or with `fragment.bind()`. In TypeScript a missing name is a compile error, and with pg a name used twice is one placeholder.
- `sql.in(list)` for `IN` lists. An empty list throws a `RangeError` instead of sending `IN ()`.
- `sql.id(...names)` quotes identifiers for each dialect: double quotes for PostgreSQL and SQLite, backticks for MySQL.
- `sql.join(items, separator)`, `sql.empty`, `sql.raw(text)` (marked unsafe) and `isFragment(value)`.
- ESM and CommonJS builds with TypeScript types, and no runtime dependencies.

[Unreleased]: https://github.com/RagedPanda/named-sql-tag/commits/main
